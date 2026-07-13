/**
 * Интеграционный тест оркестратора сбора Wellfound (collectVacancies).
 *
 * In-memory SQLite (накат миграций) + vi.mock app/wellfound/session (без
 * реального браузера). Мок page.goto/page.content отдаёт фикстуры HTML.
 * Проверяем: запись вакансий со статусом matched/rejected, дедупликация,
 * детект анти-бот блокировки, company find-or-create.
 *
 * Паттерн — tests/hh-collect.test.ts. Отличия: мок включает waitForSelector
 * (Wellfound — SPA, collect ждёт рендера), мокается ~/wellfound/session.
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
const searchHtml = readFileSync(
  path.join(fixturesDir, "wellfound-search.html"),
  "utf8",
);
const vacancyHtml = readFileSync(
  path.join(fixturesDir, "wellfound-vacancy.html"),
  "utf8",
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

/**
 * Мок app/wellfound/session: подменяет createContext на фейковый context+page,
 * который при goto отдаёт фикстуры. visitedUrls — для определения типа страницы
 * в content(). waitForSelector — resolved (SPA-ожидание в моке не блокирует).
 */
const visitedUrls: string[] = [];
const fakePage = {
  url: () => "https://wellfound.com/jobs",
  viewportSize: () => ({ width: 1280, height: 720 }),
  goto: vi.fn(async (url: string) => {
    visitedUrls.push(url);
    return { status: () => 200 };
  }),
  content: vi.fn(async () => {
    // Определяем тип по последнему goto: /jobs/<id> → детальная, иначе поиск.
    const last = visitedUrls[visitedUrls.length - 1] ?? "";
    if (/\/jobs\/\d+/.test(last)) return vacancyHtml;
    return searchHtml;
  }),
  waitForSelector: vi.fn(async () => {}),
  mouse: {
    move: vi.fn(async () => {}),
    wheel: vi.fn(async () => {}),
  },
};
const fakeContext = {
  newPage: vi.fn(async () => fakePage),
  close: vi.fn(async () => {}),
};
vi.mock("~/wellfound/session", () => ({
  createContext: vi.fn(async () => fakeContext),
  PROFILE_DIR: "/tmp/test-wf-profile",
}));

// Мок human-хелперов: убираем реальные задержки (тесты быстрые).
vi.mock("~/hh/human", () => ({
  humanDelay: vi.fn(async () => {}),
  humanPretend: vi.fn(async () => {}),
  humanMouseMove: vi.fn(async () => {}),
  humanScroll: vi.fn(async () => {}),
}));

const { collectVacancies, WellfoundBlockError } = await import(
  "~/wellfound/collect"
);
const { sourcesRepo, searchProfilesRepo, vacanciesRepo } = await import(
  "~/db/repositories"
);

function seed(): { sourceId: number; profileId: number } {
  const source = sourcesRepo.create({
    kind: "aggregator",
    name: "Wellfound",
    config: { remote_only: true, location: "Remote" },
  });
  const profile = searchProfilesRepo.create({
    name: "Backend (Wellfound)",
    query: "backend engineer",
    areas: [],
    employment_types: ["full"],
    include_keywords: ["backend", "node", "python", "api"],
    exclude_keywords: ["frontend", "intern"],
  });
  return { sourceId: source.id, profileId: profile.id };
}

describe("collectVacancies (Wellfound)", () => {
  beforeEach(() => {
    currentDb = makeDb();
    visitedUrls.length = 0;
    fakePage.goto.mockClear();
    fakePage.content.mockClear();
    fakePage.waitForSelector.mockClear();
    fakeContext.newPage.mockClear();
    fakeContext.close.mockClear();
  });

  it("собирает вакансии и выставляет status matched/rejected", async () => {
    const { sourceId, profileId } = seed();

    const stats = await collectVacancies({ sourceId, profileId, maxVacancies: 3 });

    // 3 валидные карточки в фикстуре (promo пропадает).
    // Все 3 карточки в моке получают ОДНУ детальную фикстуру (см. fakePage.content),
    // в описании которой есть "backend" и Node.js → все 3 матчатся по include.
    // exclude (frontend/intern) ни в title, ни в skills детальной нет → matched.
    // (В реальном Wellfound детальные различаются → статусы будут разнообразнее.)
    expect(stats.collected).toBe(3);
    expect(stats.matched).toBe(3);
    expect(stats.rejected).toBe(0);
    expect(stats.duplicates).toBe(0);

    const all = await vacanciesRepo.list({});
    expect(all).toHaveLength(3);
    expect(all.every((v) => v.status === "matched")).toBe(true);
  });

  it("создаёт company для вакансий с компанией (find-or-create)", async () => {
    const { sourceId, profileId } = seed();
    await collectVacancies({ sourceId, profileId, maxVacancies: 3 });

    const all = await vacanciesRepo.list({});
    // 2 первые карточки имеют company_name (Acme Corp, Another Co); 3-я — null.
    const withCompany = all.filter((v) => v.company_id !== null);
    expect(withCompany.length).toBe(2);
    // 3-я (Full Stack) — без компании.
    const noCompany = all.find((v) => v.title === "Full Stack Engineer");
    expect(noCompany?.company_id).toBeNull();
  });

  it("exclude-слово в title → rejected (фильтр работает)", async () => {
    // Отдельная проверка: профиль с exclude="full" отфильтрует Full Stack.
    const source = sourcesRepo.create({
      kind: "aggregator",
      name: "Wellfound",
      config: { remote_only: true },
    });
    const profile = searchProfilesRepo.create({
      name: "Exclude test",
      query: "backend",
      areas: [],
      employment_types: ["full"],
      include_keywords: ["backend"],
      exclude_keywords: ["full"], // Full Stack содержит "full"
    });

    const stats = await collectVacancies({
      sourceId: source.id,
      profileId: profile.id,
      maxVacancies: 3,
    });

    // exclude приоритетнее include → Full Stack rejected, остальные matched.
    expect(stats.collected).toBe(3);
    expect(stats.rejected).toBe(1);
    const all = await vacanciesRepo.list({});
    expect(all.find((v) => v.title === "Full Stack Engineer")?.status).toBe(
      "rejected",
    );
  });

  it("повторный сбор → дубликаты не пересоздаются", async () => {
    const { sourceId, profileId } = seed();
    await collectVacancies({ sourceId, profileId, maxVacancies: 3 });
    const stats2 = await collectVacancies({ sourceId, profileId, maxVacancies: 3 });

    expect(stats2.collected).toBe(0);
    expect(stats2.duplicates).toBeGreaterThan(0);
    expect(await vacanciesRepo.list({})).toHaveLength(3);
  });

  it("несуществующий source → ошибка", async () => {
    const { profileId } = seed();
    await expect(
      collectVacancies({ sourceId: 999, profileId }),
    ).rejects.toThrow("source 999 not found");
  });

  it("source не kind=aggregator → ошибка", async () => {
    const source = sourcesRepo.create({ kind: "hh", name: "hh", config: {} });
    const { profileId } = seed();
    await expect(
      collectVacancies({ sourceId: source.id, profileId }),
    ).rejects.toThrow('is not kind="aggregator"');
  });

  it("анти-бот (URL /cdn-cgi/challenge) → WellfoundBlockError, ничего не записано", async () => {
    const { sourceId, profileId } = seed();
    fakePage.url = () => "https://wellfound.com/cdn-cgi/challenge";
    fakePage.goto.mockResolvedValueOnce({ status: () => 403 });

    await expect(
      collectVacancies({ sourceId, profileId, maxVacancies: 1 }),
    ).rejects.toBeInstanceOf(WellfoundBlockError);

    expect(await vacanciesRepo.list({})).toHaveLength(0);
    // Восстановить для следующих тестов.
    fakePage.url = () => "https://wellfound.com/jobs";
  });
});
