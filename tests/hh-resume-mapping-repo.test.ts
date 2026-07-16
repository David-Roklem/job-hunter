/**
 * CRUD-тесты репозитория hh_resume_mapping на in-memory SQLite.
 *
 * Стратегия та же, что в resume-templates.test.ts: vi.mock("~/db") подменяет
 * синглтон db на in-memory + накат миграций. Для FK нужен родительский
 * resume_template — создаём его напрямую insert'ом (без валидации репозитория).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resume_templates, schema } from "~/db/schema";

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

const { upsert, findByTemplateId, list, removeByTemplateId } = await import(
  "~/db/repositories/hh_resume_mapping"
);

/** Создать шаблон резюме напрямую (для FK). */
function seedTemplate(): number {
  const row = currentDb
    .insert(resume_templates)
    .values({
      name: "Backend",
      role: "Node.js dev",
      summary: "mid",
      skills_json: "[]",
      experience_json: "[]",
      content_md: "# cv",
    })
    .returning()
    .get();
  return row.id;
}

beforeEach(() => {
  currentDb = makeDb();
});

describe("hh_resume_mapping.upsert + findByTemplateId", () => {
  it("создаёт маппинг и находит по template_id", () => {
    const tplId = seedTemplate();
    const created = upsert({
      resume_template_id: tplId,
      hh_resume_id: "abc123hash",
    });
    expect(created.id).toBeTypeOf("number");
    expect(created.hh_resume_id).toBe("abc123hash");

    const found = findByTemplateId(tplId);
    expect(found).toBeDefined();
    expect(found!.hh_resume_id).toBe("abc123hash");
    expect(found!.resume_template_id).toBe(tplId);
  });

  it("findByTemplateId несуществующего → undefined", () => {
    expect(findByTemplateId(9999)).toBeUndefined();
  });

  it("upsert обновляет hh_resume_id если маппинг уже есть (1:1)", () => {
    const tplId = seedTemplate();
    upsert({ resume_template_id: tplId, hh_resume_id: "old-hash" });
    const updated = upsert({
      resume_template_id: tplId,
      hh_resume_id: "new-hash",
    });
    expect(updated.hh_resume_id).toBe("new-hash");
    // не должно быть дубликата — по-прежнему одна строка
    expect(list()).toHaveLength(1);
  });
});

describe("hh_resume_mapping.list + removeByTemplateId", () => {
  it("list возвращает все маппинги", () => {
    const t1 = seedTemplate();
    const t2 = seedTemplate();
    upsert({ resume_template_id: t1, hh_resume_id: "h1" });
    upsert({ resume_template_id: t2, hh_resume_id: "h2" });
    expect(list()).toHaveLength(2);
  });

  it("removeByTemplateId удаляет маппинг", () => {
    const tplId = seedTemplate();
    upsert({ resume_template_id: tplId, hh_resume_id: "h" });
    expect(findByTemplateId(tplId)).toBeDefined();
    removeByTemplateId(tplId);
    expect(findByTemplateId(tplId)).toBeUndefined();
  });
});
