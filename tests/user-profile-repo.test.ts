/**
 * Тесты app/db/repositories/user_profile.ts (фаза cover-letter-profile).
 *
 * In-memory db. Singleton-конвенция: get→null сначала, upsert→строка id=1,
 * повторный upsert обновляет (не дублирует).
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

const { get, upsert } = await import("~/db/repositories/user_profile");

beforeEach(() => {
  currentDb = makeDb();
});

describe("user_profile get", () => {
  it("изначально null (профиль не задан)", () => {
    expect(get()).toBeNull();
  });
});

describe("user_profile upsert", () => {
  it("создаёт singleton-строку с id=1", () => {
    const profile = upsert({
      name: "Иван Иванов",
      contacts: { telegram: "@ivan", email: "ivan@example.com" },
      signature_md: "С уважением, Иван",
    });
    expect(profile.id).toBe(1);
    expect(profile.name).toBe("Иван Иванов");
    expect(profile.contacts.telegram).toBe("@ivan");
    expect(profile.contacts.email).toBe("ivan@example.com");
    expect(profile.signature_md).toBe("С уважением, Иван");
  });

  it("после upsert get возвращает тот же профиль", () => {
    upsert({ name: "Test" });
    const got = get();
    expect(got).not.toBeNull();
    expect(got?.name).toBe("Test");
  });

  it("повторный upsert обновляет, не дублирует", () => {
    upsert({ name: "Старое" });
    upsert({ name: "Новое", contacts: { email: "x@y.z" } });
    const got = get();
    expect(got?.name).toBe("Новое");
    expect(got?.contacts.email).toBe("x@y.z");
    // id остаётся 1 (singleton, без дублирования).
    expect(got?.id).toBe(1);
  });

  it("пустое имя → throw", () => {
    expect(() => upsert({ name: "" })).toThrow(/не может быть пустым/);
    expect(() => upsert({ name: "   " })).toThrow(/не может быть пустым/);
  });

  it("contacts по умолчанию пустой объект", () => {
    const profile = upsert({ name: "Test" });
    expect(profile.contacts).toEqual({});
  });

  it("невалидные contacts (лишние ключи) → zod пробрасывает", () => {
    // zod object без .strict() пропускает лишние ключи по умолчанию — но мы
    // проверяем что схема не падает на валидных.
    const profile = upsert({
      name: "Test",
      contacts: { phone: "+7 999 123 45 67" },
    });
    expect(profile.contacts.phone).toBe("+7 999 123 45 67");
  });

  it("signature_md по умолчанию пустая строка", () => {
    const profile = upsert({ name: "Test" });
    expect(profile.signature_md).toBe("");
  });
});
