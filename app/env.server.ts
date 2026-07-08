import { z } from "zod";

/**
 * Конфигурация окружения.
 *
 * ЕДИНСТВЕННЫЙ способ читать process.env в приложении. Все ключи валидируются
 * через zod. Любой код, которому нужен конфиг, импортирует `env` отсюда —
 * прямой `process.env` в feature-коде запрещён (правило проекта).
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // SQLite-файл. По умолчанию локальная БД в ./data (см. vision.md — single-user).
  DATABASE_URL: z
    .string()
    .default("./data/job_hunter.sqlite"),

  // Внешние сервисы — пока опциональны. Подключаются в следующих фазах.
  YANDEX_GPT_API_KEY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

type RawEnv = Record<string, string | undefined>;

function parseEnv(source: RawEnv): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.join(".") || "(root)";
        return `  • ${path}: ${issue.message}`;
      })
      .join("\n");
    throw new Error(
      `Невалидная конфигурация окружения (.env / process.env).\n` +
        `Исправьте следующие поля:\n${issues}`,
    );
  }
  return result.data;
}

/**
 * Валидированный снимок окружения. Импортируется один раз при старте.
 *
 * Тесты принимают параметр `__parseEnv`, чтобы управлять окружением
 * не через мутацию глобального `process.env`.
 */
export const env: Env = parseEnv(process.env as RawEnv);

export { parseEnv as __parseEnvForTest };
