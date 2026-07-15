/**
 * Тесты батч-оркестратора generateDrafts (фаза 09).
 *
 * In-memory SQLite (накат миграций) + vi.mock zai.chat (без сети).
 * Зеркало generate-cover-letter.test.ts / matcher-match.test.ts.
 *
 * Проверяем: one успех/ошибка/нет application, батч candidates/дедуп/
 * threshold/continue-on-error/не-draft/пусто.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { schema } from "~/db/schema";

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

// Мок провайдера zai — без сети.
const chatMock = vi.fn();
vi.mock("~/ai/providers/zai", () => ({
  zai: { chat: (...args: unknown[]) => chatMock(...args) },
}));

const { generateDraftsOne, generateDraftsAll } = await import(
  "~/ai/generateDrafts"
);
const {
  sourcesRepo,
  vacanciesRepo,
  applicationsRepo,
  resumeTemplatesRepo,
  coverLettersRepo,
} = await import("~/db/repositories");

/** Создаёт полный граф и возвращает applicationId (status='draft' по умолчанию). */
async function seedApplication(opts: {
  status?: "draft" | "pending_review" | "approved" | "sent" | "failed" | "rejected";
  matchScore?: number;
  withLetter?: boolean;
} = {}): Promise<number> {
  const source = sourcesRepo.create({ kind: "hh", name: "hh", config: {} });
  const vacancy = vacanciesRepo.create({
    source_id: source.id,
    external_id: `e${Math.random().toString(36).slice(2)}`,
    title: "Senior Backend",
    description: "Ищем Node.js разработчика с PostgreSQL и Docker.",
    url: "u",
    raw: {},
    collected_at: new Date(),
  });
  const resume = resumeTemplatesRepo.create({
    name: "Иван Иванов",
    role: "Backend Developer",
    summary: "5 лет опыта",
    skills: ["Node.js", "PostgreSQL", "Docker"],
    experience: [],
    content_md: "# Иван Иванов\n\nBackend-разработчик.",
  });
  const app = applicationsRepo.create({
    vacancy_id: vacancy.id,
    resume_template_id: resume.id,
    match_score: opts.matchScore,
    status: opts.status ?? "draft",
  });
  if (opts.withLetter) {
    coverLettersRepo.upsert({
      application_id: app.id,
      body_md: "уже есть письмо",
      ai_provider: "zai",
      model: "glm-5.2",
    });
  }
  return app.id;
}

const mockLetter = (body = "Здравствуйте! Пишу по поводу вакансии...") =>
  chatMock.mockResolvedValueOnce({
    content: body,
    model: "glm-5.2",
    provider: "zai",
  });

describe("generateDraftsOne", () => {
  beforeEach(() => {
    currentDb = makeDb();
    chatMock.mockReset();
  });

  it("успех: письмо записано, result.success=true, bodyLength>0", async () => {
    const applicationId = await seedApplication();
    mockLetter();

    const result = await generateDraftsOne(applicationId);

    expect(result.success).toBe(true);
    expect(result.applicationId).toBe(applicationId);
    expect(result.bodyLength).toBeGreaterThan(0);
    expect(chatMock).toHaveBeenCalledTimes(1);

    const letter = coverLettersRepo.findByApplicationId(applicationId);
    expect(letter).toBeDefined();
    expect(letter?.body_md).toContain("Здравствуйте");
  });

  it("несуществующий application → бросает", async () => {
    await expect(generateDraftsOne(999)).rejects.toThrow(
      "application 999 not found",
    );
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("ошибка AI → проброс, БД не тронута", async () => {
    const applicationId = await seedApplication();
    chatMock.mockRejectedValueOnce(new Error("z.ai HTTP 429"));

    await expect(generateDraftsOne(applicationId)).rejects.toThrow("429");
    expect(
      coverLettersRepo.findByApplicationId(applicationId),
    ).toBeUndefined();
  });
});

describe("generateDraftsAll", () => {
  beforeEach(() => {
    currentDb = makeDb();
    chatMock.mockReset();
  });

  it("батчит candidates (draft без письма)", async () => {
    const a1 = await seedApplication({ matchScore: 80 });
    const a2 = await seedApplication({ matchScore: 70 });
    mockLetter();
    mockLetter();

    const stats = await generateDraftsAll();

    expect(stats.candidates).toBe(2);
    expect(stats.generated).toBe(2);
    expect(stats.skipped).toBe(0);
    expect(stats.errors).toHaveLength(0);
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(coverLettersRepo.list()).toHaveLength(2);
  });

  it("пропускает applications УЖЕ с письмом (дедуп)", async () => {
    const a1 = await seedApplication({ matchScore: 80, withLetter: true });
    const a2 = await seedApplication({ matchScore: 70 });
    mockLetter();

    const stats = await generateDraftsAll();

    // a1 уже имеет письмо → пропущен; a2 — кандидат.
    expect(stats.candidates).toBe(1);
    expect(stats.generated).toBe(1);
    expect(stats.skipped).toBe(1); // a1 пропущен (есть письмо)
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it("minScore отсекает слабые скоры (skipped считается)", async () => {
    await seedApplication({ matchScore: 80 });
    await seedApplication({ matchScore: 40 }); // ниже порога
    mockLetter();

    const stats = await generateDraftsAll({ minScore: 60 });

    expect(stats.candidates).toBe(1);
    expect(stats.generated).toBe(1);
    expect(stats.skipped).toBe(1); // score=40 отсечён minScore
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it("continue-on-error: mid-batch ошибка → в errors[], батч продолжается", async () => {
    const a1 = await seedApplication({ matchScore: 80 });
    const a2 = await seedApplication({ matchScore: 70 });
    // a1 успех, a2 transient-ошибка.
    mockLetter();
    chatMock.mockRejectedValueOnce(new Error("429 mid-batch"));

    const stats = await generateDraftsAll();

    expect(stats.candidates).toBe(2);
    expect(stats.generated).toBe(1);
    expect(stats.errors).toHaveLength(1);
    expect(stats.errors[0]?.applicationId).toBe(a2);
    expect(stats.errors[0]?.message).toContain("429");
    // a1 получил письмо; a2 — нет.
    expect(coverLettersRepo.findByApplicationId(a1)).toBeDefined();
    expect(coverLettersRepo.findByApplicationId(a2)).toBeUndefined();
  });

  it("игнорирует applications не-'draft' статуса", async () => {
    await seedApplication({ status: "pending_review", matchScore: 90 });
    await seedApplication({ status: "approved", matchScore: 90 });

    const stats = await generateDraftsAll();

    expect(stats.candidates).toBe(0);
    expect(stats.generated).toBe(0);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("нет candidates → stats.candidates=0, errors=[]", async () => {
    const stats = await generateDraftsAll();

    expect(stats.candidates).toBe(0);
    expect(stats.generated).toBe(0);
    expect(stats.skipped).toBe(0);
    expect(stats.errors).toEqual([]);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("max ограничивает число кандидатов", async () => {
    await seedApplication({ matchScore: 80 });
    await seedApplication({ matchScore: 70 });
    await seedApplication({ matchScore: 60 });
    mockLetter();
    mockLetter();

    const stats = await generateDraftsAll({ max: 2 });

    expect(stats.candidates).toBe(2); // ограничено max
    expect(stats.generated).toBe(2);
    expect(chatMock).toHaveBeenCalledTimes(2);
  });
});
