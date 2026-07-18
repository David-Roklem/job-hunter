/**
 * Белый список редактируемых настроек окружения (фаза ui-control).
 *
 * Только эти ключи можно править через /settings. EnvSchema в env.server.ts —
 * канон: значения, которые туда попадают, должны пройти zod-валидацию при
 * следующем старте процесса. Здесь мы управляем лишь UI-метаданными (группа,
 * подпись, секретность, подсказка).
 *
 * Секреты НИКОГДА не отдаются в loader /settings (см. settings._index.tsx).
 */
export type EditableKey =
  | "ZAI_API_KEY"
  | "ZAI_MODEL"
  | "ZAI_BASE_URL"
  | "YANDEX_GPT_API_KEY"
  | "TG_API_ID"
  | "TG_API_HASH"
  | "TG_SESSION"
  | "SCHEDULER_POLL_SEC"
  | "HH_MAX_PER_CYCLE"
  | "HH_DAILY_LIMIT"
  | "HH_JITTER_MIN"
  | "HH_JITTER_MAX"
  | "DATABASE_URL"
  | "NODE_ENV";

/** Спецификация ключа для UI. */
export type EditableKeySpec = {
  key: EditableKey;
  label: string;
  group: string;
  /** Секретные значения не отдаются в loader. */
  is_secret: boolean;
  hint?: string;
};

/** Полный белый список. Порядок = порядок в UI. */
export const EDITABLE_KEYS: EditableKeySpec[] = [
  // --- AI ---
  {
    key: "ZAI_API_KEY",
    label: "z.ai API-ключ",
    group: "AI (z.ai)",
    is_secret: true,
    hint: "Ключ для генерации писем. Получить: https://z.ai",
  },
  {
    key: "ZAI_MODEL",
    label: "Модель",
    group: "AI (z.ai)",
    is_secret: false,
    hint: "По умолчанию glm-5.2",
  },
  {
    key: "ZAI_BASE_URL",
    label: "API endpoint",
    group: "AI (z.ai)",
    is_secret: false,
    hint: "PRO-подписка: coding/paas/v4. Pay-as-you-go: /api/paas/v4",
  },
  {
    key: "YANDEX_GPT_API_KEY",
    label: "YandexGPT ключ",
    group: "AI (yandex)",
    is_secret: true,
  },

  // --- Telegram ---
  {
    key: "TG_API_ID",
    label: "Telegram api_id",
    group: "Telegram",
    is_secret: false,
    hint: "https://my.telegram.org → API development tools",
  },
  {
    key: "TG_API_HASH",
    label: "Telegram api_hash",
    group: "Telegram",
    is_secret: true,
  },
  {
    key: "TG_SESSION",
    label: "StringSession",
    group: "Telegram",
    is_secret: true,
    hint: "Заполняется после npm run telegram:login",
  },

  // --- Scheduler / hh лимиты ---
  {
    key: "SCHEDULER_POLL_SEC",
    label: "Интервал poll воркера (сек)",
    group: "Планировщик",
    is_secret: false,
    hint: "По умолчанию 30",
  },
  {
    key: "HH_MAX_PER_CYCLE",
    label: "Макс. apply за poll",
    group: "hh лимиты",
    is_secret: false,
    hint: "Защита от бана. По умолчанию 20",
  },
  {
    key: "HH_DAILY_LIMIT",
    label: "Суточный лимит apply",
    group: "hh лимиты",
    is_secret: false,
    hint: "По умолчанию 80",
  },
  {
    key: "HH_JITTER_MIN",
    label: "Jitter min (мс)",
    group: "hh лимиты",
    is_secret: false,
    hint: "По умолчанию 15000",
  },
  {
    key: "HH_JITTER_MAX",
    label: "Jitter max (мс)",
    group: "hh лимиты",
    is_secret: false,
    hint: "По умолчанию 60000",
  },

  // --- Database / runtime ---
  {
    key: "DATABASE_URL",
    label: "Путь к SQLite",
    group: "База данных",
    is_secret: false,
    hint: "По умолчанию ./data/job_hunter.sqlite",
  },
  {
    key: "NODE_ENV",
    label: "Режим",
    group: "База данных",
    is_secret: false,
    hint: "development | test | production",
  },
];

/** Множество ключей для быстрой проверки. */
export const EDITABLE_KEY_SET: Set<EditableKey> = new Set(
  EDITABLE_KEYS.map((k) => k.key),
);
