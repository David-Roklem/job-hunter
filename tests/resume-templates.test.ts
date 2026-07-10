/**
 * CRUD-тесты репозитория resume_templates на in-memory SQLite.
 *
 * Стратегия: vi.mock("~/db") подменяет синглтон db на in-memory соединение
 * (createDb(":memory:") + накат миграций из ./drizzle). Каждое тестовое
 * подключение — свежая БД (beforeEach).
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

// In-memory соединение с накатом схемы. Создаётся напрямую через better-sqlite3
// + drizzle + schema, без зависимости от синглтона в ~/db (он замокан).
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

const { create, findById, list, update, remove } = await import(
  "~/db/repositories/resume_templates"
);

const validInput = {
  name: "Frontend",
  role: "React Developer",
  summary: "Middle frontend",
  skills: ["React", "TypeScript"],
  experience: [
    {
      company: "Acme",
      role: "Frontend",
      period: { from: "2022-01", to: null },
      description: "UI development",
    },
  ],
  content_md: "# Resume\nReact dev.",
};

beforeEach(() => {
  currentDb = makeDb();
});

describe("resume_templates.create + findById", () => {
  it("создаёт и находит по id с распарсенными skills/experience", () => {
    const created = create(validInput);
    expect(created.id).toBeTypeOf("number");
    expect(created.is_active).toBe(true);

    const dto = findById(created.id);
    expect(dto).toBeDefined();
    expect(dto!.skills).toEqual(["React", "TypeScript"]);
    expect(dto!.experience).toHaveLength(1);
    expect(dto!.experience[0]!.company).toBe("Acme");
    expect(dto!.experience[0]!.period.to).toBeNull();
    expect(dto!.content_md).toBe("# Resume\nReact dev.");
  });

  it("findById несуществующего → undefined", () => {
    expect(findById(9999)).toBeUndefined();
  });

  it("is_active=false уважается", () => {
    const created = create({ ...validInput, is_active: false });
    expect(created.is_active).toBe(false);
  });
});

describe("resume_templates.create — zod validation", () => {
  it("бросает на невалидный experience (нет company)", () => {
    expect(() =>
      create({
        ...validInput,
        experience: [
          { role: "X", period: { from: "2022", to: null }, description: "y" },
        ],
      }),
    ).toThrow();
  });
});

describe("resume_templates.list", () => {
  it("возвращает все шаблоны, сортировка updated_at desc", async () => {
    const a = create({ ...validInput, name: "A" });
    // Небольшая задержка, чтобы updated_at разнились (unix-секунды).
    await new Promise((r) => setTimeout(r, 1100));
    const b = create({ ...validInput, name: "B" });

    const all = list();
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe(b.id); // b свежее — первым
    expect(all[1]!.id).toBe(a.id);
  });

  it("пагинация limit/offset", () => {
    create({ ...validInput, name: "A" });
    create({ ...validInput, name: "B" });
    create({ ...validInput, name: "C" });

    const page = list({ limit: 1, offset: 1 });
    expect(page).toHaveLength(1);
  });
});

describe("resume_templates.update", () => {
  it("обновляет поля name + skills, experience без изменений", () => {
    const created = create(validInput);
    const updated = update(created.id, {
      name: "Frontend v2",
      skills: ["React", "TypeScript", "Vite"],
    });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Frontend v2");

    const dto = findById(created.id)!;
    expect(dto.skills).toEqual(["React", "TypeScript", "Vite"]);
    expect(dto.experience).toHaveLength(1); // не тронут
  });

  it("пустой patch — no-op, возвращает текущую строку", () => {
    const created = create(validInput);
    const before = findById(created.id)!;
    const result = update(created.id, {});
    expect(result).toBeDefined();
    expect(result!.name).toBe(before.name);
  });

  it("zod-guard на невалидный experience", () => {
    const created = create(validInput);
    expect(() =>
      update(created.id, {
        experience: [
          // нет обязательного поля company
          { role: "x", period: { from: "2022", to: null }, description: "y" },
        ],
      }),
    ).toThrow();
  });

  it("update несуществующего → undefined", () => {
    expect(update(9999, { name: "x" })).toBeUndefined();
  });
});

describe("resume_templates.remove", () => {
  it("удаляет существующий, возвращает true", () => {
    const created = create(validInput);
    expect(remove(created.id)).toBe(true);
    expect(findById(created.id)).toBeUndefined();
  });

  it("remove несуществующего → false", () => {
    expect(remove(9999)).toBe(false);
  });
});
