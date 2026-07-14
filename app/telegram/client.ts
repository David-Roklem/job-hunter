/**
 * gramjs-клиент (MTProto, user-аккаунт) — ядро Telegram-источника.
 *
 * Архитектура (решение discuss фазы 07): MTProto, НЕ Bot API. Бот не может
 * читать чужие публичные каналы вакансий (только где он админ). gramjs под
 * user-аккаунтом читает любой публичный канал + полную историю постов.
 *
 * Жизненный цикл:
 *   1. `npm run telegram:login` (один раз) → интерактивный логин (телефон+код),
 *      печатает StringSession → кладётся в .env как TG_SESSION.
 *   2. `createTelegramClient()` здесь — создаёт TelegramClient с сохранённой
 *      сессией; collect.ts вызывает start() и disconnect().
 *
 * api_id/api_hash — бесплатно на https://my.telegram.org → API development tools.
 *
 * ВНИМАНИЕ: один экземпляр StringSession нельзя использовать параллельно из
 * нескольких процессов — Telegram разрывает старое соединение. Collect-цикл
 * синхронный (один процесс), так что это безопасно.
 */
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { env } from "~/env.server";

/** Данные для аутентификации MTProto, собранные из env. */
export type TelegramCredentials = {
  apiId: number;
  apiHash: string;
  /** StringSession после telegram:login. Пусто = не залогинен. */
  session: string;
};

/**
 * Прочитать telegram-credentials из env.
 *
 * @throws Error с понятной инструкцией, если TG_API_ID/TG_API_HASH/TG_SESSION
 *   не заданы. Проверка на границе использования (env опционален для приложения
 *   в целом, но обязателен для telegram-функциональности).
 */
export function readCredentials(): TelegramCredentials {
  if (env.TG_API_ID === undefined || env.TG_API_HASH === undefined) {
    throw new Error(
      "Telegram: TG_API_ID/TG_API_HASH не заданы. Получите бесплатно на " +
        "https://my.telegram.org → API development tools и положите в .env.",
    );
  }
  if (!env.TG_SESSION) {
    throw new Error(
      "Telegram: TG_SESSION пуст. Запустите `npm run telegram:login` " +
        "(один раз, интерактивный логин) и положите выведенную строку в .env.",
    );
  }
  return {
    apiId: env.TG_API_ID,
    apiHash: env.TG_API_HASH,
    session: env.TG_SESSION,
  };
}

/**
 * Создать TelegramClient с сохранённой сессией.
 *
 * НЕ вызывает start() — это ответственность вызывающего (collect/login), чтобы
 * разделить создание клиента и подключение к сети. Опции connectionRetries
 * сглаживают нестабильность MTProto-соединения.
 *
 * @throws если credentials не заданы (через readCredentials).
 */
export function createTelegramClient(
  creds: TelegramCredentials = readCredentials(),
): TelegramClient {
  return new TelegramClient(
    new StringSession(creds.session),
    creds.apiId,
    creds.apiHash,
    {
      connectionRetries: 5,
    },
  );
}
