/**
 * Интеграционный тест оркестратора сбора Telegram (collectVacancies).
 *
 * In-memory SQLite (накат миграций) + внедряемый фейковый client (мок gramjs —
 * без реальной сети) + мок AI-зарплаты через vi.mock salary-модуля.
 *
 * Проверяем: запись вакансий со статусом matched/rejected, дедупликация по
 * (source_id, message_id), обновление курсора канала, find-or-create компании,
 * детект FloodWait (досрочный выход с flood:true).
 *
 * Паттерн — tests/wellfound-collect.test.ts. Отличия: client внедряется через
 * opts.client (не vi.mock session), AI мокается через vi.mock salary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { schema } from "~/db/schema";
import { Api } from "telegram";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function makeDb() {
  const db = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: path.join(projectRoot, "drizzle") });
  return db;
}

let currentDb: ReturnType<typeof makeDb>;

vi.mock("~/db", () => ({
  get db() {
    return currentDb;
  },
}));

// Мок AI-зарплаты: НЕ зовём z.ai, возвращаем предсказуемые значения по тексту.
vi.mock("~/telegram/salary", () => ({
  parseSalaryAi: vi.fn(async (text: string) => {
    if (text.includes("$120k")) return { from: 120000, currency: "USD" };
    if (text.includes("250-350")) return { from: 250000, to: 350000, currency: "RUB" };
    return null;
  }),
}));

// --- Фейковый gramjs-client -------------------------------------------------

/** Сделать Api.Message из текста + опций. */
function makeMessage(
  id: number,
  text: string,
  extra: { entities?: Api.TypeMessageEntity[] } = {},
): Api.Message {
  return new Api.Message({
    id,
    peerId: new Api.PeerChannel({ channelId: 1n }),
    date: 1700000000,
    message: text,
    entities: extra.entities ?? [],
  });
}

type FetchBehavior = (username: string, minId: number) => Api.Message[];

function makeClient(behavior: FetchBehavior) {
  return {
    getMessages: vi.fn(async (username: string, opts: { minId: number }) => {
      return behavior(username, opts.minId);
    }),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  };
}

const { collectVacancies } = await import("~/telegram/collect");
const { sourcesRepo, searchProfilesRepo, telegramChannelsRepo, vacanciesRepo } =
  await import("~/db/repositories");

function seed(): { sourceId: number; profileId: number; channelId: number } {
  const source = sourcesRepo.create({
    kind: "telegram",
    name: "Telegram",
    config: {},
  });
  const profile = searchProfilesRepo.create({
    name: "Backend (Telegram)",
    query: "backend",
    areas: [],
    employment_types: ["full"],
    include_keywords: ["backend", "node", "разработчик"],
    exclude_keywords: ["frontend", "стажёр", "новости"],
  });
  const channel = telegramChannelsRepo.create({
    source_id: source.id,
    username: "jobschannel",
    title: "Jobs Channel",
  });
  return { sourceId: source.id, profileId: profile.id, channelId: channel.id };
}

describe("collectVacancies (Telegram)", () => {
  beforeEach(() => {
    currentDb = makeDb();
  });

  it("собирает посты и выставляет status matched/rejected", async () => {
    const { sourceId, profileId } = seed();
    const client = makeClient(() => [
      makeMessage(101, "Senior Backend Engineer\n\nNode.js, PostgreSQL. Remote. $120k"),
      makeMessage(102, "Frontend стажёр\n\nReact, новости компании"),
    ]);

    const stats = await collectVacancies({
      sourceId,
      profileId,
      client: client as never,
    });

    // 101 → matched (backend/node/разработчик в include).
    // 102 → rejected (frontend/стажёр/новости в exclude).
    expect(stats.collected).toBe(2);
    expect(stats.matched).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.channels).toBe(1);
  });

  it("записывает вакансию с external_id=message_id и url", async () => {
    const { sourceId, profileId } = seed();
    const client = makeClient(() => [
      makeMessage(777, "Backend разработчик\nNode.js"),
    ]);

    await collectVacancies({ sourceId, profileId, client: client as never });

    const all = await vacanciesRepo.list({});
    expect(all).toHaveLength(1);
    expect(all[0]!.external_id).toBe("777");
    expect(all[0]!.url).toBe("https://t.me/jobschannel/777");
    expect(all[0]!.salary_from).toBeNull(); // нет признаков зарплаты в тексте
  });

  it("дедупликация: повторный collect с тем же курсором → 0 новых", async () => {
    const { sourceId, profileId } = seed();
    const client = makeClient(() => [
      makeMessage(100, "Backend разработчик\nNode.js"),
    ]);

    await collectVacancies({ sourceId, profileId, client: client as never });
    // Второй прогон: те же посты (курсор обновился, но fetch мок отдаёт то же).
    const stats2 = await collectVacancies({
      sourceId,
      profileId,
      client: client as never,
    });

    expect(stats2.collected).toBe(0);
    expect(stats2.duplicates).toBe(1);
  });

  it("обновляет курсор канала на max прочитанный message_id", async () => {
    const { sourceId, profileId, channelId } = seed();
    const client = makeClient(() => [
      makeMessage(100, "Backend разработчик"),
      makeMessage(150, "Node.js разработчик"),
      makeMessage(120, "Python разработчик"),
    ]);

    await collectVacancies({ sourceId, profileId, client: client as never });

    const ch = telegramChannelsRepo.findById(channelId);
    expect(ch?.last_message_id).toBe(150); // maxId из прочитанных
  });

  it("курсор не двигается, если новых постов нет", async () => {
    const { sourceId, profileId, channelId } = seed();
    // Установим курсор вручную и отдадим пустой fetch.
    telegramChannelsRepo.updateCursor(channelId, 500);
    const client = makeClient(() => []);

    await collectVacancies({ sourceId, profileId, client: client as never });

    expect(telegramChannelsRepo.findById(channelId)?.last_message_id).toBe(500);
  });

  it("find-or-create компании по имени канала", async () => {
    const { sourceId, profileId } = seed();
    const client = makeClient(() => [
      makeMessage(1, "Backend разработчик"),
    ]);

    await collectVacancies({ sourceId, profileId, client: client as never });

    const all = await vacanciesRepo.list({});
    expect(all[0]!.company?.name).toBe("Jobs Channel");
  });

  it("FloodWait → досрочный выход с flood:true, без паники", async () => {
    const { sourceId, profileId } = seed();
    const client = {
      getMessages: vi.fn(async () => {
        throw new Error("A wait of 300 seconds is required before making another request");
      }),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
    };

    const stats = await collectVacancies({
      sourceId,
      profileId,
      client: client as never,
    });

    expect(stats.flood).toBe(true);
    expect(stats.collected).toBe(0);
  });

  it("ошибка: source не kind=telegram", async () => {
    const other = sourcesRepo.create({ kind: "hh", name: "HH", config: {} });
    const profile = searchProfilesRepo.create({
      name: "P",
      query: "x",
      areas: [],
      employment_types: [],
      include_keywords: [],
      exclude_keywords: [],
    });
    const client = makeClient(() => []);

    await expect(
      collectVacancies({
        sourceId: other.id,
        profileId: profile.id,
        client: client as never,
      }),
    ).rejects.toThrow(/not kind="telegram"/);
  });

  it("raw_json хранит contacts/channel_username/message_id", async () => {
    const { sourceId, profileId } = seed();
    const client = makeClient(() => [
      makeMessage(5, "Backend разработчик\nКонтакты: @hr_team, jobs@x.com"),
    ]);

    await collectVacancies({ sourceId, profileId, client: client as never });

    const all = await vacanciesRepo.list({});
    expect(all[0]!.raw.channel_username).toBe("jobschannel");
    expect(all[0]!.raw.message_id).toBe(5);
    expect(all[0]!.raw.contacts).toEqual(
      expect.arrayContaining(["@hr_team", "jobs@x.com"]),
    );
  });
});
