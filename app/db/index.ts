import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { schema } from "~/db/schema";
import { env } from "~/env.server";

/**
 * ЕДИНСТВЕННОЕ место открытия SQLite-соединения.
 *
 * Feature-код НЕ открывает соединения напрямую — только импортирует `db`
 * отсюда (правило проекта + must_have из PLAN.md). Драйвер — better-sqlite3
 * (нативный, стабилен на Windows; поддерживает и рантайм, и drizzle-kit migrate).
 */

const dbPath = resolve(env.DATABASE_URL);
const dir = dirname(dbPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

/** Drizzle-соединение со схемой (relations доступны через with: {...}). */
export const db = drizzle(new Database(dbPath), { schema });

/**
 * Фабрика Drizzle-соединения. Feature-код использует синглтон `db` выше;
 * эта функция нужна тестам для создания изолированного in-memory соединения
 * (drizzle + better-sqlite3 ":memory:").
 */
export function createDb(path: string | ":memory:") {
  return drizzle(new Database(path), { schema });
}

export { dbPath };
