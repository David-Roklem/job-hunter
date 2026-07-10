/**
 * Интеграционный тест оркестратора сбора (collectVacancies).
 *
 * In-memory SQLite (накат миграций) + vi.mock app/hh/session (без реального
 * браузера). Мок page.goto/page.content отдаёт фикстуры HTML. Проверяем:
 * запись вакансий со статусом matched/rejected, дедупликацию, детект капчи.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { schema } from "~/db/schema";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fixturesDir = path.join(projectRoot, "tests", "fixtures");
const searchHtml = readFileSync(path.join(fixturesDir, "hh-search.html"), "utf8");
const vacancyHtml = readFileSync(path.join(fixturesDir, "hh-vacancy.html"), "utf8");

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

/**
 * Мок app/hh/session: подменяет createContext на фейковый context+page,
 * который при goto отдаёт фикстуры. visitedUrls — для проверки навигации.
 */
const visitedUrls: string[] = [];
const fakePage = {
  url: () => "https://hh.ru/search/vacancy",
  viewportSize: () => ({ width: 1280, height: 720 }),
  goto: vi.fn(async (url: string) => {
    visitedUrls.push(url);
    return { status: () => 200 };
  }),
  content: vi.fn(async (requestedUrl?: string) => {
    // content() вызывается без аргумента; определяем тип по последнему goto.
    const last = visitedUrls[visitedUrls.length - 1] ?? "";
    if (last.includes("/vacancy/")) return vacancyHtml;
    return searchHtml;
  }),
  mouse: {
    move: vi.fn(async () => {}),
    wheel: vi.fn(async () => {}),
  },
};
const fakeContext = {
  newPage: vi.fn(async () => fakePage),
  close: vi.fn(async () => {}),
};
vi.mock("~/hh/session", () => ({
  createContext: vi.fn(async () => fakeContext),
  PROFILE_DIR: "/tmp/test-profile",
}));

// Мок human-хелперов: убираем реальные задержки (тесты быстрые).
vi.mock("~/hh/human", () => ({
  humanDelay: vi.fn(async () => {}),
  humanPretend: vi.fn(async () => {}),
  humanMouseMove: vi.fn(async () => {}),
  humanScroll: vi.fn(async () => {}),
}));

const { collectVacancies, HhCaptchaError } = await import("~/hh/collect");
const { sourcesRepo, searchProfilesRepo, vacanciesRepo } = await import(
  "~/db/repositories"
);

function seed(): { sourceId: number; profileId: number } {
  const source = sourcesRepo.create({
    kind: "hh",
    name: "hh.ru",
    config: {},
  });
  const profile = searchProfilesRepo.create({
    name: "Backend",
    query: "Node.js backend",
    areas: ["1"], // Москва
    employment_types: ["full"],
    include_keywords: ["node.js"],
    exclude_keywords: ["frontend"],
  });
  return { sourceId: source.id, profileId: profile.id };
}

describe("collectVacancies", () => {
  beforeEach(() => {
    currentDb = makeDb();
    visitedUrls.length = 0;
    fakePage.goto.mockClear();
    fakePage.content.mockClear();
    fakeContext.newPage.mockClear();
    fakeContext.close.mockClear();
  });

  it("собирает вакансии и выставляет status matched/rejected", async () => {
    const { sourceId, profileId } = seed();

    const stats = await collectVacancies({ sourceId, profileId, maxVacancies: 3 });

    // 3 карточки в фикстуре (promo пропадает). Node.js → matched, Backend без "node.js"? —
    // Backend-карточка: title "Backend Developer", description/skills из detail (Node.js есть) → matched.
    // Frontend → попадает в exclude "frontend" → rejected.
    expect(stats.collected).toBe(3);
    expect(stats.matched).toBe(2); // Senior Node.js + Backend (skills содержат Node.js)
    expect(stats.rejected).toBe(1); // Frontend → exclude
    expect(stats.duplicates).toBe(0);

    // В БД — 3 вакансии с правильными статусами.
    const all = await vacanciesRepo.list({});
    expect(all).toHaveLength(3);
    const matched = all.filter((v) => v.status === "matched");
    const rejected = all.filter((v) => v.status === "rejected");
    expect(matched.length).toBe(2);
    expect(rejected.length).toBe(1);
    expect(rejected[0].title).toBe("Frontend Developer");
  });

  it("повторный сбор → дубликаты не пересоздаются", async () => {
    const { sourceId, profileId } = seed();
    await collectVacancies({ sourceId, profileId, maxVacancies: 3 });
    const stats2 = await collectVacancies({ sourceId, profileId, maxVacancies: 3 });

    // Второй прогон: все 3 карточки уже в БД → collected=0, дубликаты>0.
    expect(stats2.collected).toBe(0);
    expect(stats2.duplicates).toBeGreaterThan(0);
    // В БД всё ещё 3, не больше (дубли не пересоздаются).
    expect(await vacanciesRepo.list({})).toHaveLength(3);
  });

  it("несуществующий source → ошибка", async () => {
    const { profileId } = seed();
    await expect(
      collectVacancies({ sourceId: 999, profileId }),
    ).rejects.toThrow("source 999 not found");
  });

  it("source не kind=hh → ошибка", async () => {
    const source = sourcesRepo.create({ kind: "telegram", name: "tg", config: {} });
    const { profileId } = seed();
    await expect(
      collectVacancies({ sourceId: source.id, profileId }),
    ).rejects.toThrow('is not kind="hh"');
  });

  it("капча (URL /checks/captcha) → HhCaptchaError, ничего не записано", async () => {
    const { sourceId, profileId } = seed();
    fakePage.url = () => "https://hh.ru/checks/captcha";
    fakePage.goto.mockResolvedValueOnce({ status: () => 200 });

    await expect(
      collectVacancies({ sourceId, profileId, maxVacancies: 1 }),
    ).rejects.toBeInstanceOf(HhCaptchaError);

    expect(await vacanciesRepo.list({})).toHaveLength(0);
    // Восстановить для следующих тестов.
    fakePage.url = () => "https://hh.ru/search/vacancy";
  });
});
