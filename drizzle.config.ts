import { defineConfig } from "drizzle-kit";

/**
 * Конфигурация drizzle-kit.
 *
 * dialect: "sqlite" → drizzle-kit автоматически использует встроенный
 * node:sqlite драйвер (без better-sqlite3 / node-gyp). Схема живёт в
 * app/db/schema.ts, миграции — в ./drizzle.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./app/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: "./data/job_hunter.sqlite",
  },
});
