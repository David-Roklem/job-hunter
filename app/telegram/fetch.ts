/**
 * Чтение постов из Telegram-каналов через gramjs.
 *
 * Чистая зависимость от TelegramClient — мокируется в тестах (collect.test
 * подставляет фейковый client). В реальном запуске client создаётся в
 * app/telegram/client.ts.
 *
 * Курсор: getMessages(username, { minId: last_message_id }) возвращает посты
 * НОВЕЕ курсора. maxId из ответа становится новым курсором → идемпотентный
 * повторный сбор не дублирует посты.
 */
import type { TelegramClient, Api } from "telegram";

/** Пост канала, нормализованный под парсеры (минимум полей, нужных им). */
export type ChannelPost = {
  /** message_id — уникален в канале, идёт в external_id вакансии. */
  messageId: number;
  /** unix-секунды (date отправки). */
  date: number;
  /** Полный текст поста (может быть пустым — медиа без подписи). */
  text: string;
  /** Markdown-форматированный текст (с **жирным**, ссылками) — для извлечения title/ссылок. */
  textMarkdown: string;
  /** Entities (ссылки, упоминания, жирный) — для извлечения url/контактов. */
  entities: Api.TypeMessageEntity[];
};

/** Результат чтения одного канала. */
export type FetchResult = {
  posts: ChannelPost[];
  /** maxId прочитанных постов — новый курсор для telegram_channels.last_message_id. */
  maxId: number;
};

/**
 * Прочитать новые посты канала (message_id > last_message_id).
 *
 * @param client gramjs-клиент (подключённый).
 * @param username публиччный username канала БЕЗ "@".
 * @param lastMessageId курсор (0 = читать с начала/последних).
 * @param limit максимум постов за вызов (дефолт 50 — безопасный анти-флуд).
 *
 * Фильтрация: только текстовые посты с непустым text (пропускаем медиа без
 * подписи, сервисные сообщения: закреплено/участник присоединился и т.п.).
 * Гарантия: maxId = max(messageId) прочитанных; если ничего не прочитано —
 * maxId = lastMessageId (курсор не двигается).
 */
export async function fetchNewPosts(
  client: TelegramClient,
  username: string,
  lastMessageId: number,
  limit = 50,
): Promise<FetchResult> {
  const raw = await client.getMessages(username, {
    limit,
    minId: lastMessageId,
  });

  // getMessages может вернуть одно сообщение или массив — нормализуем.
  const messages: Api.Message[] = Array.isArray(raw) ? raw : [raw];

  const posts: ChannelPost[] = [];
  let maxId = lastMessageId;

  for (const msg of messages) {
    if (!isTextPost(msg)) continue;
    const text = msg.message ?? "";
    if (!text.trim()) continue;

    const post: ChannelPost = {
      messageId: msg.id,
      date: msg.date,
      text,
      textMarkdown: msg.message ?? "",
      // entities могут отсутствовать у простого текста — пустой массив.
      entities: msg.entities ?? [],
    };
    posts.push(post);
    if (post.messageId > maxId) maxId = post.messageId;
  }

  return { posts, maxId };
}

/**
 * Является ли сообщение текстовым постом канала.
 *
 * Отсеиваем: undefined/не Message (Api.MessageEmpty/MessageService), посты без
 * текста (чистое медиа). Service-сообщения (закреплено/новый участник) — это
 * MessageService, у них нет поля .message.
 */
function isTextPost(msg: Api.Message | undefined): msg is Api.Message {
  if (!msg) return false;
  // Api.Message имеет className "Message"; MessageService/MessageEmpty — нет.
  // Проверяем через наличие строки className (gramjs выставляет на инстансах).
  if (typeof (msg as { className?: string }).className === "string") {
    return (msg as { className: string }).className === "Message";
  }
  return false;
}
