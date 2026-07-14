/**
 * CRUD-тесты репозитория telegram_channels на in-memory SQLite.
 *
 * Стратегия: vi.mock("~/db") подменяет синглтон db на in-memory соединение
 * (createDb(":memory:") + накат миграций). Каждое тестовое подключение — свежая БД.
 *
 * Паттерн — tests/resume-templates.test.ts.
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

const { telegramChannelsRepo, sourcesRepo } = await import(
  "~/db/repositories"
);
const { sources } = await import("~/db/schema");
const { eq } = await import("drizzle-orm");

/** Создать source (kind=telegram) — FK-зависимость канала. */
function makeSource(): number {
  return sourcesRepo.create({ kind: "telegram", name: "Telegram", config: {} }).id;
}

describe("telegramChannelsRepo", () => {
  beforeEach(() => {
    currentDb = makeDb();
  });

  describe("create + validation", () => {
    it("создаёт канал с дефолтами (last_message_id=0, is_active=true)", () => {
      const sourceId = makeSource();
      const ch = telegramChannelsRepo.create({
        source_id: sourceId,
        username: "jobsinit",
      });
      expect(ch.username).toBe("jobsinit");
      expect(ch.last_message_id).toBe(0);
      expect(ch.is_active).toBe(true);
      expect(ch.title).toBeNull();
    });

    it("сохраняет title", () => {
      const sourceId = makeSource();
      const ch = telegramChannelsRepo.create({
        source_id: sourceId,
        username: "jobsinit",
        title: "Jobs in IT",
      });
      expect(ch.title).toBe("Jobs in IT");
    });

    it("валидирует username (минимум 5 символов)", () => {
      const sourceId = makeSource();
      expect(() =>
        telegramChannelsRepo.create({ source_id: sourceId, username: "abc" }),
      ).toThrow();
    });

    it("валидирует username (цифра в начале недопустима)", () => {
      const sourceId = makeSource();
      expect(() =>
        telegramChannelsRepo.create({ source_id: sourceId, username: "1jobs" }),
      ).toThrow();
    });

    it("валидирует username (допустимые символы a-zA-Z0-9_)", () => {
      const sourceId = makeSource();
      expect(() =>
        telegramChannelsRepo.create({ source_id: sourceId, username: "jobs-in-it" }),
      ).toThrow(); // дефис недопустим
    });

    it("уникальность username", () => {
      const sourceId = makeSource();
      telegramChannelsRepo.create({ source_id: sourceId, username: "jobsinit" });
      expect(() =>
        telegramChannelsRepo.create({ source_id: sourceId, username: "jobsinit" }),
      ).toThrow();
    });
  });

  describe("findById / findByUsername", () => {
    it("находит по id и по username", () => {
      const sourceId = makeSource();
      const ch = telegramChannelsRepo.create({
        source_id: sourceId,
        username: "jobsinit",
      });
      expect(telegramChannelsRepo.findById(ch.id)?.username).toBe("jobsinit");
      expect(telegramChannelsRepo.findByUsername("jobsinit")?.id).toBe(ch.id);
    });

    it("undefined при отсутствии", () => {
      expect(telegramChannelsRepo.findById(999)).toBeUndefined();
      expect(telegramChannelsRepo.findByUsername("nope")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("фильтрация по sourceId", () => {
      const s1 = makeSource();
      const s2 = sourcesRepo.create({ kind: "telegram", name: "TG2", config: {} }).id;
      telegramChannelsRepo.create({ source_id: s1, username: "alpha1" });
      telegramChannelsRepo.create({ source_id: s1, username: "beta123" });
      telegramChannelsRepo.create({ source_id: s2, username: "gamma1" });

      expect(telegramChannelsRepo.list({ sourceId: s1 })).toHaveLength(2);
      expect(telegramChannelsRepo.list({ sourceId: s2 })).toHaveLength(1);
    });

    it("фильтрация по active", () => {
      const sourceId = makeSource();
      telegramChannelsRepo.create({ source_id: sourceId, username: "alpha1", is_active: true });
      telegramChannelsRepo.create({ source_id: sourceId, username: "beta23", is_active: false });

      expect(telegramChannelsRepo.list({ active: true })).toHaveLength(1);
      expect(telegramChannelsRepo.list({ active: false })).toHaveLength(1);
    });
  });

  describe("updateCursor", () => {
    it("обновляет last_message_id", () => {
      const sourceId = makeSource();
      const ch = telegramChannelsRepo.create({ source_id: sourceId, username: "jobsinit" });
      telegramChannelsRepo.updateCursor(ch.id, 12345);
      expect(telegramChannelsRepo.findById(ch.id)?.last_message_id).toBe(12345);
    });

    it("no-op для несуществующего id (не падает)", () => {
      expect(() => telegramChannelsRepo.updateCursor(999, 1)).not.toThrow();
    });
  });

  describe("update / remove", () => {
    it("update меняет поля", () => {
      const sourceId = makeSource();
      const ch = telegramChannelsRepo.create({ source_id: sourceId, username: "jobsinit" });
      telegramChannelsRepo.update(ch.id, { title: "Renamed", is_active: false });
      const updated = telegramChannelsRepo.findById(ch.id);
      expect(updated?.title).toBe("Renamed");
      expect(updated?.is_active).toBe(false);
    });

    it("remove удаляет", () => {
      const sourceId = makeSource();
      const ch = telegramChannelsRepo.create({ source_id: sourceId, username: "jobsinit" });
      telegramChannelsRepo.remove(ch.id);
      expect(telegramChannelsRepo.findById(ch.id)).toBeUndefined();
    });
  });

  describe("cascade с source", () => {
    it("удаление source каскадно удаляет каналы", () => {
      const sourceId = makeSource();
      const ch = telegramChannelsRepo.create({ source_id: sourceId, username: "jobsinit" });
      // sourcesRepo.remove отсутствует — удаляем напрямую через db (cascade ON DELETE).
      currentDb.delete(sources).where(eq(sources.id, sourceId)).run();
      expect(telegramChannelsRepo.findById(ch.id)).toBeUndefined();
    });
  });
});
