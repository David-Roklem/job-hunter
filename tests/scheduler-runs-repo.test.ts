/**
 * CRUD-тесты репозитория scheduler_runs (циклы планировщика, фаза 12).
 *
 * in-memory better-sqlite3 + migrator + vi.mock("~/db"). Паттерн как
 * в hh-resume-mapping-repo.test.ts / jobs-repo.test.ts.
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

const {
  start,
  finish,
  mergeStats,
  pushError,
  findById,
  list,
  emptyStats,
} = await import("~/db/repositories/scheduler_runs");

beforeEach(() => {
  currentDb = makeDb();
});

describe("scheduler_runs repo", () => {
  it("start создаёт строку с started_at, без finished_at", () => {
    const beforeSec = Math.floor(Date.now() / 1000);
    const id = start();
    const run = findById(id);
    expect(run).toBeDefined();
    expect(Math.floor(run!.started_at.getTime() / 1000)).toBeGreaterThanOrEqual(beforeSec);
    expect(run!.finished_at).toBeNull();
    expect(run!.stats_json).toBeNull();
    expect(run!.last_error).toBeNull();
  });

  it("mergeStats накапливает stats, не затирая существующие поля", () => {
    const id = start();
    mergeStats(id, { collected: 5 });
    mergeStats(id, { matched_pairs: 3 });
    const run = findById(id);
    const stats = JSON.parse(run!.stats_json!);
    expect(stats.collected).toBe(5);
    expect(stats.matched_pairs).toBe(3);
    expect(stats.drafted).toBe(0); // дефолт
  });

  it("mergeStats.errors накапливает, не затирая", () => {
    const id = start();
    mergeStats(id, { errors: ["a"] });
    mergeStats(id, { errors: ["b"] });
    const run = JSON.parse(findById(id)!.stats_json!);
    expect(run.errors).toEqual(["a", "b"]);
  });

  it("pushError добавляет сообщение в errors[]", () => {
    const id = start();
    mergeStats(id, { collected: 1 });
    pushError(id, "ой");
    const stats = JSON.parse(findById(id)!.stats_json!);
    expect(stats.errors).toContain("ой");
    expect(stats.collected).toBe(1); // не затёрто
  });

  it("finish ставит finished_at + финальные stats + last_error", () => {
    const id = start();
    const stats = emptyStats();
    stats.collected = 10;
    finish(id, stats, { lastError: "упало в конце" });
    const run = findById(id);
    expect(run!.finished_at).toBeTruthy();
    const parsed = JSON.parse(run!.stats_json!);
    expect(parsed.collected).toBe(10);
    expect(run!.last_error).toBe("упало в конце");
  });

  it("list возвращает строки (свежие — последние через offset)", () => {
    start();
    start();
    expect(list().length).toBe(2);
  });

  it("emptyStats возвращает структуру с дефолтами", () => {
    const s = emptyStats();
    expect(s.collected).toBe(0);
    expect(s.errors).toEqual([]);
    expect(Array.isArray(s.errors)).toBe(true);
  });
});
