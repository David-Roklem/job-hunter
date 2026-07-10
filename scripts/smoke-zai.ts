/**
 * SMOKE-тест z.ai — реальный вызов к API на ключе из .env.
 *
 * Запуск: npx tsx scripts/smoke-zai.ts
 * Проверяет: аутентификацию, формат запроса/ответа, реальную генерацию.
 * НЕ входит в npm test (нужен живой ключ + сеть + деньги).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Грузим .env вручную (без зависимости dotenv) ДО импорта env.server.ts,
// т.к. тот парсит process.env при первом импорте.
const envPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".env",
);
try {
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {
  console.warn(".env не найден — переменные берутся из process.env");
}

const { zai } = await import("../app/ai/providers/zai");
const { buildCoverLetterMessages } = await import(
  "../app/ai/prompts/coverLetter"
);

async function main() {
  console.log("=== z.ai smoke-тест ===\n");

  const messages = buildCoverLetterMessages({
    vacancy: {
      title: "Senior Backend Developer",
      company: "Тест-Компания",
      description:
        "Ищем сильного backend-разработчика на Node.js. Требуется опыт с PostgreSQL, Docker, микросервисами. Будете строить высоконагруженные API.",
      location: "Москва",
    },
    resume: {
      name: "Иван Иванов",
      role: "Backend Developer",
      summary: "5 лет опыта в backend-разработке",
      skills: ["Node.js", "TypeScript", "PostgreSQL", "Docker", "микросервисы"],
      contentMd: "# Иван Иванов\n\nBackend-разработчик, 5 лет опыта.",
    },
    locale: "ru",
  });

  console.log("Провайдер:", zai.name);
  console.log("Модель: из env (ZAI_MODEL)\n");
  console.log("Отправляю запрос к z.ai...\n");

  try {
    const t0 = Date.now();
    const resp = await zai.chat({ messages, temperature: 0.7 });
    const dt = Date.now() - t0;

    console.log(`✓ Успех за ${dt}мс`);
    console.log(`  model:    ${resp.model}`);
    console.log(`  provider: ${resp.provider}`);
    console.log(`  длина ответа: ${resp.content.length} символов\n`);
    console.log("--- Сгенерированное письмо ---");
    console.log(resp.content);
    console.log("--- конец ---\n");
    process.exit(0);
  } catch (err) {
    console.error("✗ ОШИБКА:");
    console.error("  name:", (err as Error).name);
    console.error("  message:", (err as Error).message);
    const e = err as { status?: number; code?: number; provider?: string };
    if (e.status !== undefined) console.error("  HTTP status:", e.status);
    if (e.code !== undefined) console.error("  business code:", e.code);
    if (e.provider !== undefined) console.error("  provider:", e.provider);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Необработанная ошибка:", err);
  process.exit(1);
});
