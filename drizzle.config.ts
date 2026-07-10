import { defineConfig } from "drizzle-kit";

/**
 * Конфигурация drizzle-kit.
 *
 * dialect: "sqlite" + установленный better-sqlite3 — drizzle-kit использует его
 * и для генерации миграций, и для `db:migrate` (node:sqlite драйвера в
 * drizzle-orm 0.45.2 нет — см. решение в .agents/STATE.md). Схема живёт в
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
