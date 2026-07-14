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
  ZAI_API_KEY: z.string().optional(),
  ZAI_MODEL: z.string().default("glm-5.2"),
  // GLM Coding Plan (PRO-подписка) требует dedicated endpoint /api/coding/paas/v4.
  // Переопределить для обычного аккаунта (pay-as-you-go): https://api.z.ai/api/paas/v4.
  ZAI_BASE_URL: z
    .string()
    .default("https://api.z.ai/api/coding/paas/v4"),
  YANDEX_GPT_API_KEY: z.string().optional(),

  // Telegram-источник (фаза 07). MTProto через gramjs (user-аккаунт),
  // НЕ Bot API. api_id/api_hash бесплатно на https://my.telegram.org → API development tools.
  // TG_SESSION — строка StringSession после `npm run telegram:login` (пусто = не залогинен).
  // Опциональны: telegram-функциональность недоступна без них, но приложение/тесты работают.
  TG_API_ID: z.coerce.number().optional(),
  TG_API_HASH: z.string().optional(),
  TG_SESSION: z.string().default(""),
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
