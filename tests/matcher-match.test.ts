/**
 * Интеграционные тесты matcher (фаза 08).
 *
 * In-memory SQLite (накат миграций) + vi.mock zai.chat (без сети). Покрывает:
 *  - префильтр отсёк → нет AI-вызова, нет application, score=0;
 *  - AI дал score≥threshold → application создан, vacancy→matched;
 *  - score<threshold → нет application, vacancy остаётся 'new';
 *  - идемпотентность: повторный match обновляет score, не создаёт дубль;
 *  - AiProviderError пробрасывается, БД не тронута;
 *  - matchAll батч по status='new' × активные шаблоны.
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

const { matchVacancy, matchAll } = await import("~/matcher/match");
const { sourcesRepo, vacanciesRepo, applicationsRepo, resumeTemplatesRepo } =
  await import("~/db/repositories");

type SeedOpts = {
  /** Текст вакансии. */
  title?: string;
  description?: string;
  /** Навыки резюме. */
  skills?: string[];
  resumeActive?: boolean;
};

/** Создаёт source + vacancy + resume и возвращает их id. */
async function seed(opts: SeedOpts = {}): Promise<{
  vacancyId: number;
  resumeId: number;
}> {
  const source = sourcesRepo.create({ kind: "hh", name: "hh test", config: {} });
  const vacancy = vacanciesRepo.create({
    source_id: source.id,
    external_id: `ext-${Math.random().toString(36).slice(2)}`,
    title: opts.title ?? "Senior Backend",
    description:
      opts.description ?? "Ищем Node.js разработчика с PostgreSQL и Docker.",
    url: "https://hh.ru/v/1",
    raw: {},
    collected_at: new Date(),
  });
  const resume = resumeTemplatesRepo.create({
    name: "Иван Иванов",
    role: "Backend Developer",
    summary: "5 лет опыта",
    skills: opts.skills ?? ["Node.js", "PostgreSQL", "Docker"],
    experience: [],
    content_md: "# Иван",
    is_active: opts.resumeActive ?? true,
  });
  return { vacancyId: vacancy.id, resumeId: resume.id };
}

function mockScore(score: number, rationale = "хорошее совпадение"): void {
  chatMock.mockResolvedValueOnce({
    content: JSON.stringify({ score, rationale }),
    model: "glm-5.2",
    provider: "zai",
  });
}

describe("matchVacancy", () => {
  beforeEach(() => {
    currentDb = makeDb();
    chatMock.mockReset();
  });

  it("префильтр отсёк → нет AI-вызова, нет application, score=0", async () => {
    const { vacancyId, resumeId } = await seed({
      skills: ["React", "Vue"], // не пересекается с backend-вакансией
    });

    const result = await matchVacancy(vacancyId, resumeId);

    expect(chatMock).not.toHaveBeenCalled();
    expect(result.aiCalled).toBe(false);
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.applicationId).toBeUndefined();
    // application НЕ создан.
    expect(applicationsRepo.findByVacancyAndResume(vacancyId, resumeId)).toBeUndefined();
    // вакансия осталась 'new'.
    const vac = await vacanciesRepo.findById(vacancyId);
    expect(vac?.status).toBe("new");
  });

  it("AI дал score≥threshold → application создан, vacancy→matched", async () => {
    const { vacancyId, resumeId } = await seed();
    mockScore(85);

    const result = await matchVacancy(vacancyId, resumeId);

    expect(result.aiCalled).toBe(true);
    expect(result.score).toBe(85);
    expect(result.passed).toBe(true);
    expect(result.applicationId).toBeDefined();

    const app = applicationsRepo.findByVacancyAndResume(vacancyId, resumeId);
    expect(app).toBeDefined();
    expect(app?.match_score).toBe(85);
    expect(app?.status).toBe("draft"); // matcher создаёт как draft

    const vac = await vacanciesRepo.findById(vacancyId);
    expect(vac?.status).toBe("matched");
  });

  it("score<threshold → нет application, vacancy остаётся 'new'", async () => {
    const { vacancyId, resumeId } = await seed();
    mockScore(30); // ниже дефолтного порога 50

    const result = await matchVacancy(vacancyId, resumeId);

    expect(result.aiCalled).toBe(true);
    expect(result.score).toBe(30);
    expect(result.passed).toBe(false);
    expect(result.applicationId).toBeUndefined();
    expect(applicationsRepo.findByVacancyAndResume(vacancyId, resumeId)).toBeUndefined();
    const vac = await vacanciesRepo.findById(vacancyId);
    expect(vac?.status).toBe("new");
  });

  it("custom threshold отсекает средние скоры", async () => {
    const { vacancyId, resumeId } = await seed();
    mockScore(60);

    const result = await matchVacancy(vacancyId, resumeId, { threshold: 70 });

    expect(result.passed).toBe(false);
    expect(result.applicationId).toBeUndefined();
  });

  it("идемпотентность: повторный match обновляет score, не создаёт дубль", async () => {
    const { vacancyId, resumeId } = await seed();
    mockScore(85);
    mockScore(72);

    const r1 = await matchVacancy(vacancyId, resumeId);
    const r2 = await matchVacancy(vacancyId, resumeId);

    expect(r1.applicationId).toBeDefined();
    expect(r2.applicationId).toBe(r1.applicationId); // тот же application
    expect(await applicationsRepo.list()).toHaveLength(1);
    const app = applicationsRepo.findByVacancyAndResume(vacancyId, resumeId);
    expect(app?.match_score).toBe(72); // обновлён
    expect(app?.status).toBe("draft"); // lifecycle не тронут
  });

  it("AiProviderError пробрасывается, БД не тронута", async () => {
    const { vacancyId, resumeId } = await seed();
    const err = new Error("z.ai HTTP 429");
    chatMock.mockRejectedValueOnce(err);

    await expect(matchVacancy(vacancyId, resumeId)).rejects.toThrow("429");

    expect(applicationsRepo.findByVacancyAndResume(vacancyId, resumeId)).toBeUndefined();
    const vac = await vacanciesRepo.findById(vacancyId);
    expect(vac?.status).toBe("new");
  });

  it("несуществующая вакансия → бросает", async () => {
    const { resumeId } = await seed();
    await expect(matchVacancy(999, resumeId)).rejects.toThrow("vacancy 999 not found");
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("несуществующее резюме → бросает", async () => {
    const { vacancyId } = await seed();
    await expect(matchVacancy(vacancyId, 999)).rejects.toThrow(
      "resume_template 999 not found",
    );
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("промпт получает компанию и навыки из relations", async () => {
    const { vacancyId, resumeId } = await seed();
    mockScore(80);

    await matchVacancy(vacancyId, resumeId);

    const messages = chatMock.mock.calls[0][0].messages;
    const user = messages.find((m: { role: string }) => m.role === "user").content;
    expect(user).toContain("Senior Backend");
    expect(user).toContain("Node.js");
    expect(user).toContain("Backend Developer");
  });

  it("невалидный JSON ответа → бросок, БД не тронута", async () => {
    const { vacancyId, resumeId } = await seed();
    chatMock.mockResolvedValueOnce({
      content: "это не JSON",
      model: "glm-5..2",
      provider: "zai",
    });

    await expect(matchVacancy(vacancyId, resumeId)).rejects.toThrow(
      /не является JSON|parseMatchResponse/,
    );
    expect(applicationsRepo.findByVacancyAndResume(vacancyId, resumeId)).toBeUndefined();
  });

  it("strip markdown-обёртки ```json из ответа", async () => {
    const { vacancyId, resumeId } = await seed();
    chatMock.mockResolvedValueOnce({
      content: "```json\n{\"score\": 90, \"rationale\": \"идеально\"}\n```",
      model: "glm-5.2",
      provider: "zai",
    });

    const result = await matchVacancy(vacancyId, resumeId);
    expect(result.score).toBe(90);
    expect(result.passed).toBe(true);
  });

  it("score ровно = threshold (граница ≥) → passed", async () => {
    const { vacancyId, resumeId } = await seed();
    mockScore(50); // = DEFAULT_MATCH_THRESHOLD

    const result = await matchVacancy(vacancyId, resumeId);

    expect(result.passed).toBe(true);
    expect(result.applicationId).toBeDefined();
  });

  it("score=100 (макс) → passed, не падает", async () => {
    const { vacancyId, resumeId } = await seed();
    mockScore(100);

    const result = await matchVacancy(vacancyId, resumeId);

    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
  });

  it("score=0 от AI (полностью нерелевантно) → passed=false, без application", async () => {
    const { vacancyId, resumeId } = await seed();
    mockScore(0);

    const result = await matchVacancy(vacancyId, resumeId);

    expect(result.passed).toBe(false);
    expect(result.applicationId).toBeUndefined();
    expect(
      applicationsRepo.findByVacancyAndResume(vacancyId, resumeId),
    ).toBeUndefined();
  });

  it("неактивное резюме (is_active=false) → отсекается без AI, без application", async () => {
    const { vacancyId, resumeId } = await seed({ resumeActive: false });

    const result = await matchVacancy(vacancyId, resumeId);

    expect(chatMock).not.toHaveBeenCalled();
    expect(result.aiCalled).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(
      applicationsRepo.findByVacancyAndResume(vacancyId, resumeId),
    ).toBeUndefined();
  });
});

describe("matchAll", () => {
  beforeEach(() => {
    currentDb = makeDb();
    chatMock.mockReset();
  });

  it("батчит вакансии status='new' × активные шаблоны", async () => {
    // 2 вакансии, обе new.
    const s1 = sourcesRepo.create({ kind: "hh", name: "hh", config: {} });
    const v1 = vacanciesRepo.create({
      source_id: s1.id,
      external_id: "e1",
      title: "Backend",
      description: "Node.js, PostgreSQL",
      url: "u1",
      raw: {},
      collected_at: new Date(),
    });
    const v2 = vacanciesRepo.create({
      source_id: s1.id,
      external_id: "e2",
      title: "Frontend",
      description: "React, Vue",
      url: "u2",
      raw: {},
      collected_at: new Date(),
    });
    // 2 активных шаблона: backend (матчит v1) и frontend (матчит v2).
    const rBackend = resumeTemplatesRepo.create({
      name: "A",
      role: "Backend",
      summary: "",
      skills: ["Node.js", "PostgreSQL"],
      experience: [],
      content_md: "",
    });
    const rFrontend = resumeTemplatesRepo.create({
      name: "B",
      role: "Frontend",
      summary: "",
      skills: ["React", "Vue"],
      experience: [],
      content_md: "",
    });
    // 1 неактивный — НЕ должен участвовать.
    resumeTemplatesRepo.create({
      name: "C",
      role: "DevOps",
      summary: "",
      skills: ["Docker"],
      experience: [],
      content_md: "",
      is_active: false,
    });

    // 4 AI-ответа: (v1×rBackend:80)(v1×rFrontend:prefilter-cut)(v2×rBackend:prefilter-cut)(v2×rFrontend:80)
    // Префильтр отсечёт кросс-пары, оставит 2 AI-вызова.
    mockScore(80);
    mockScore(80);

    const stats = await matchAll();

    expect(stats.vacancies).toBe(2);
    expect(stats.scanned).toBe(4); // 2 vacancies × 2 active resumes
    expect(stats.aiCalls).toBe(2);
    expect(stats.matched).toBe(2);
    expect(chatMock).toHaveBeenCalledTimes(2);
    // Каждая вакансия получила application от своего подходящего шаблона.
    expect(applicationsRepo.findByVacancyAndResume(v1.id, rBackend.id)).toBeDefined();
    expect(applicationsRepo.findByVacancyAndResume(v2.id, rFrontend.id)).toBeDefined();
  });

  it("max ограничивает число вакансий", async () => {
    const s = sourcesRepo.create({ kind: "hh", name: "hh", config: {} });
    for (let i = 0; i < 3; i++) {
      vacanciesRepo.create({
        source_id: s.id,
        external_id: `e${i}`,
        title: "Backend",
        description: "Node.js",
        url: `u${i}`,
        raw: {},
        collected_at: new Date(),
      });
    }
    resumeTemplatesRepo.create({
      name: "A",
      role: "Backend",
      summary: "",
      skills: ["Node.js"],
      experience: [],
      content_md: "",
    });
    mockScore(70);
    mockScore(70);

    const stats = await matchAll({ max: 2 });

    expect(stats.vacancies).toBe(2);
    expect(stats.scanned).toBe(2);
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it("берёт вакансии 'new' И 'matched' (кандидаты matcher'а), исключает 'rejected'", async () => {
    const s = sourcesRepo.create({ kind: "hh", name: "hh", config: {} });
    // new — попадает.
    const newVac = vacanciesRepo.create({
      source_id: s.id,
      external_id: "e-new",
      title: "Backend",
      description: "Node.js",
      url: "u",
      raw: {},
      collected_at: new Date(),
    });
    // matched (прошёл source-фильтр фаз 05–07) — тоже попадает: это валидный
    // кандидат для AI-скора. Без этого батч никогда бы не взял уже собранные
    // вакансии (сборщики не оставляют 'new').
    const matchedVac = vacanciesRepo.create({
      source_id: s.id,
      external_id: "e-matched",
      title: "Backend",
      description: "Node.js",
      url: "u2",
      raw: {},
      collected_at: new Date(),
    });
    vacanciesRepo.update(matchedVac.id, { status: "matched" });
    // rejected (отсечён source-фильтром) — НЕ попадает.
    const rejectedVac = vacanciesRepo.create({
      source_id: s.id,
      external_id: "e-rejected",
      title: "Backend",
      description: "Node.js",
      url: "u3",
      raw: {},
      collected_at: new Date(),
    });
    vacanciesRepo.update(rejectedVac.id, { status: "rejected" });

    resumeTemplatesRepo.create({
      name: "A",
      role: "Backend",
      summary: "",
      skills: ["Node.js"],
      experience: [],
      content_md: "",
    });
    mockScore(70);
    mockScore(70);

    const stats = await matchAll();

    // new + matched = 2 вакансии-кандидата; rejected исключён.
    expect(stats.vacancies).toBe(2);
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it("mid-batch ошибка провайдера → continue-on-error, частичный результат сохранён", async () => {
    const s = sourcesRepo.create({ kind: "hh", name: "hh", config: {} });
    const v1 = vacanciesRepo.create({
      source_id: s.id,
      external_id: "e1",
      title: "Backend",
      description: "Node.js",
      url: "u1",
      raw: {},
      collected_at: new Date(),
    });
    const v2 = vacanciesRepo.create({
      source_id: s.id,
      external_id: "e2",
      title: "Backend",
      description: "Node.js",
      url: "u2",
      raw: {},
      collected_at: new Date(),
    });
    const resume = resumeTemplatesRepo.create({
      name: "A",
      role: "Backend",
      summary: "",
      skills: ["Node.js"],
      experience: [],
      content_md: "",
    });
    // v1 успех, v2 transient-ошибка (429).
    mockScore(80);
    chatMock.mockRejectedValueOnce(new Error("429 mid-batch"));

    const stats = await matchAll();

    // Прогон НЕ упал: v1 обработан, v2 в errors.
    expect(stats.scanned).toBe(1); // только v1 дал результат
    expect(stats.matched).toBe(1);
    expect(stats.errors).toHaveLength(1);
    expect(stats.errors[0]?.vacancyId).toBe(v2.id);
    expect(stats.errors[0]?.message).toContain("429");
    // v1 получил application; v2 — не тронут.
    expect(
      applicationsRepo.findByVacancyAndResume(v1.id, resume.id),
    ).toBeDefined();
    const v2vac = await vacanciesRepo.findById(v2.id);
    expect(v2vac?.status).toBe("new");
  });
});
