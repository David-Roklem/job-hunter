/**
 * Загрузка .env для standalone tsx-скриптов (без зависимости dotenv).
 *
 * dev-сервер RR7/Vite грузит .env сам; для scripts/*.ts (запуск через tsx)
 * нужен ручной загрузчик. env.server.ts парсит process.env при первом импорте,
 * поэтому вызывать loadEnv() ДО динамического импорта app/* модулей.
 *
 * Согласован с temp-files rule: ничего не пишет во временное — только читает .env.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function loadEnv(): void {
  const envPath = path.join(projectRoot, ".env");
  let content: string;
  try {
    content = readFileSync(envPath, "utf8");
  } catch {
    // .env нет — переменные берутся из process.env (CI/прод).
    return;
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}
