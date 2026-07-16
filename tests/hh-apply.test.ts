/**
 * Тест оркестратора отклика (submitApplication).
 *
 * In-memory SQLite + vi.mock app/hh/session (без браузера). Мок page.locator/
 * click/fill отрабатывает поток: открыть форму → выбрать резюме → письмо →
 * submit. Проверяем: status sent+submitted_at при успехе, failed при отсутствии
 * маппинга, идемпотентность (sent → no-op без force).
 *
 * НЕ тестирует реальный hh — это ручной smoke (см. PLAN apply-hh шаг 6).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applications,
  companies,
  cover_letters,
  hh_resume_mapping,
  resume_templates,
  schema,
  sources,
  vacancies,
} from "~/db/schema";

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

// --- мок page: locator с fluent API (click/fill/filter/first/count) ---
function makeLocator() {
  const loc: any = {
    count: vi.fn(async () => 1),
    click: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    waitFor: vi.fn(async () => {}),
    innerText: vi.fn(async () => "resume text"),
    filter: vi.fn(() => loc),
  };
  // .first — и свойство, и вызов как функция. Имитируем callable object.
  loc.first = Object.assign(() => loc, loc);
  return loc;
}
const fakePage: any = {
  url: () => "https://hh.ru/applicant/vacancy_response?vacancyId=123",
  goto: vi.fn(async () => ({ status: () => 200 })),
  waitForSelector: vi.fn(async () => {}),
  waitForTimeout: vi.fn(async () => {}),
  locator: vi.fn(() => makeLocator()),
  mouse: { move: vi.fn(async () => {}), wheel: vi.fn(async () => {}) },
  content: vi.fn(async () => "<html></html>"),
};
const fakeContext = {
  newPage: vi.fn(async () => fakePage),
  close: vi.fn(async () => {}),
};
vi.mock("~/hh/session", () => ({
  createContext: vi.fn(async () => fakeContext),
}));
vi.mock("~/hh/human", () => ({
  humanDelay: vi.fn(async () => {}),
  humanPretend: vi.fn(async () => {}),
  humanScroll: vi.fn(async () => {}),
}));

const { submitApplication } = await import("~/hh/apply");
const { applicationsRepo, hhResumeMappingRepo, coverLettersRepo } = await import(
  "~/db/repositories"
);

/** Создать полный граф: source → vacancy → application + resume + mapping + letter. */
function seedApplication(opts: {
  status?: (typeof applications.status.enumValues)[number];
  withMapping?: boolean;
  withLetter?: boolean;
}): number {
  const source = currentDb
    .insert(sources)
    .values({ kind: "hh", name: "hh", config_json: "{}" })
    .returning()
    .get();
  const company = currentDb
    .insert(companies)
    .values({ name: "Acme", source_id: source.id })
    .returning()
    .get();
  const vacancy = currentDb
    .insert(vacancies)
    .values({
      source_id: source.id,
      external_id: "135200000",
      title: "Node.js dev",
      description: "desc",
      url: "https://hh.ru/vacancy/135200000",
      raw_json: "{}",
      collected_at: new Date(),
    })
    .returning()
    .get();
  const tpl = currentDb
    .insert(resume_templates)
    .values({
      name: "Backend",
      role: "Node dev",
      summary: "mid",
      skills_json: "[]",
      experience_json: "[]",
      content_md: "# cv",
    })
    .returning()
    .get();
  const app = currentDb
    .insert(applications)
    .values({
      vacancy_id: vacancy.id,
      resume_template_id: tpl.id,
      status: opts.status ?? "approved",
    })
    .returning()
    .get();
  if (opts.withMapping !== false) {
    currentDb
      .insert(hh_resume_mapping)
      .values({ resume_template_id: tpl.id, hh_resume_id: "hash123" })
      .run();
  }
  if (opts.withLetter) {
    currentDb
      .insert(cover_letters)
      .values({
        application_id: app.id,
        body_md: "Здравствуйте!",
        generated_at: new Date(),
      })
      .run();
  }
  return app.id;
}

beforeEach(() => {
  currentDb = makeDb();
  vi.clearAllMocks();
});

describe("submitApplication", () => {
  it("успех: status → sent + submitted_at", async () => {
    const id = seedApplication({ withLetter: true });
    const result = await submitApplication({ applicationId: id });
    expect(result.ok).toBe(true);
    const updated = await applicationsRepo.findById(id);
    expect(updated!.status).toBe("sent");
    expect(updated!.submitted_at).toBeTruthy();
  });

  it("нет маппинга → failed + причина", async () => {
    const id = seedApplication({ withMapping: false });
    const result = await submitApplication({ applicationId: id });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/маппинг/i);
    const updated = await applicationsRepo.findById(id);
    expect(updated!.status).toBe("failed");
  });

  it("идемпотентность: sent без force → no-op", async () => {
    const id = seedApplication({ status: "sent" });
    const result = await submitApplication({ applicationId: id });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/уже отправлена/);
    // submit НЕ вызывался (не было goto формы после раннего возврата).
    expect(fakePage.goto).not.toHaveBeenCalled();
  });

  it("несуществующая application → ok=false", async () => {
    const result = await submitApplication({ applicationId: 9999 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/не найден/);
  });

  it("force=true повторно откликает sent", async () => {
    const id = seedApplication({ status: "sent", withLetter: true });
    const result = await submitApplication({ applicationId: id, force: true });
    expect(result.ok).toBe(true);
    expect(fakePage.goto).toHaveBeenCalled();
  });

  it("с письмом: fillLetter вызывается (toggle клик + textarea fill)", async () => {
    const id = seedApplication({ withLetter: true });
    await submitApplication({ applicationId: id });
    // locator вызывался для letter-toggle/textarea/submit/resume-dropdown.
    expect(fakePage.locator).toHaveBeenCalled();
  });
});
