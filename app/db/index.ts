import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-sqlite";
import { env } from "~/env.server";

/**
 * ЕДИНСТВЕННОЕ место открытия SQLite-соединения.
 *
 * Feature-код НЕ открывает соединения напрямую — только импортирует `db`
 * отсюда (правило проекта + must_have из PLAN.md). Используется встроенный
 * `node:sqlite` (доступен в Node ≥ 22, стабилен в 24) через Drizzle ORM.
 */

const dbPath = resolve(env.DATABASE_URL);
const dir = dirname(dbPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

/** Drizzle-соединение. Схема пока пустая — расширится в фазе 2. */
export const db = drizzle({ connection: { source: dbPath } });

export { dbPath };
