/**
 * Интеграционный тест generateCoverLetter.
 *
 * In-memory SQLite (накат миграций) + vi.mock zai.chat (без сети).
 * Проверяем end-to-end: ввод из БД → промпт → LLM-мок → запись в cover_letters.
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

const { generateCoverLetter } = await import("~/ai/generateCoverLetter");
const { sourcesRepo, vacanciesRepo, applicationsRepo, resumeTemplatesRepo, coverLettersRepo } =
  await import("~/db/repositories");

/** Создаёт полный граф записей и возвращает applicationId. */
async function seedApplication(): Promise<number> {
  const source = sourcesRepo.create({
    kind: "hh",
    name: "hh.ru test",
    config: {},
  });
  const company = currentDb
    .insert(schema.companies)
    .values({ name: "Тест-Компания" })
    .returning()
    .get() as unknown as { id: number };
  const companyId = company.id;

  const vacancy = vacanciesRepo.create({
    source_id: source.id,
    external_id: "ext-1",
    company_id: companyId,
    title: "Senior Backend",
    description: "Ищем Node.js разработчика с опытом PostgreSQL и Docker.",
    employment_type: "full",
    url: "https://hh.ru/vacancy/1",
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

  const application = applicationsRepo.create({
    vacancy_id: vacancy.id,
    resume_template_id: resume.id,
  });
  return application.id;
}

describe("generateCoverLetter", () => {
  beforeEach(() => {
    currentDb = makeDb();
    chatMock.mockReset();
  });

  it("генерирует письмо и записывает в cover_letters", async () => {
    const applicationId = await seedApplication();
    chatMock.mockResolvedValueOnce({
      content: "Здравствуйте! Пишу по поводу вакансии...",
      model: "glm-5.2",
      provider: "zai",
    });

    const result = await generateCoverLetter(applicationId);

    expect(result.body_md).toContain("Здравствуйте");
    expect(result.provider).toBe("zai");

    // Письмо записано в БД.
    const letter = coverLettersRepo.findByApplicationId(applicationId);
    expect(letter).toBeDefined();
    expect(letter?.body_md).toContain("Здравствуйте");
    expect(letter?.ai_provider).toBe("zai");
    expect(letter?.model).toBe("glm-5.2");
  });

  it("повторная генерация → upsert (одна запись, body обновлён)", async () => {
    const applicationId = await seedApplication();
    chatMock
      .mockResolvedValueOnce({
        content: "первая версия",
        model: "glm-5.2",
        provider: "zai",
      })
      .mockResolvedValueOnce({
        content: "вторая версия",
        model: "glm-5.2",
        provider: "zai",
      });

    await generateCoverLetter(applicationId);
    await generateCoverLetter(applicationId);

    // Одна запись по UNIQUE(application_id).
    const letters = coverLettersRepo.list();
    expect(letters).toHaveLength(1);
    expect(letters[0].body_md).toBe("вторая версия");
  });

  it("несуществующий application → бросает", async () => {
    await expect(generateCoverLetter(999)).rejects.toThrow(
      "application 999 not found",
    );
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("провайдер бросает → generate пробрасывает, БД не тронута", async () => {
    const applicationId = await seedApplication();
    const err = new Error("z.ai HTTP 429");
    chatMock.mockRejectedValueOnce(err);

    await expect(generateCoverLetter(applicationId)).rejects.toThrow("429");

    // Письмо НЕ записано.
    expect(coverLettersRepo.findByApplicationId(applicationId)).toBeUndefined();
  });

  it("промпт получает company name и skills из relations", async () => {
    const applicationId = await seedApplication();
    chatMock.mockResolvedValueOnce({
      content: "ok",
      model: "glm-5.2",
      provider: "zai",
    });

    await generateCoverLetter(applicationId);

    // Проверяем, что в user-сообщение попали компания и навыки.
    const passedMessages = chatMock.mock.calls[0][0].messages;
    const userContent = passedMessages.find(
      (m: { role: string }) => m.role === "user",
    ).content;
    expect(userContent).toContain("Тест-Компания");
    expect(userContent).toContain("Node.js");
    expect(userContent).toContain("Senior Backend");
  });
});
