/**
 * Репозиторий telegram-каналов (telegram_channels).
 *
 * Тонкий CRUD без бизнес-логики. Доступ к БД — через db из app/db/index.ts.
 *
 * Курсор last_message_id — per-channel состояние идемпотентного сбора:
 * collect читает посты с message_id > last_message_id, затем обновляет курсор
 * на maxId прочитанного. 0 = канал ещё не читали.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { telegramChannels } from "~/db/schema";
import { type ListOptions } from "./_shared";

export type TelegramChannel = typeof telegramChannels.$inferSelect;
export type NewTelegramChannel = typeof telegramChannels.$inferInsert;

/**
 * Валидация username канала (без ведущего "@").
 * Правила Telegram: 5–32 символа, начинается с буквы, [a-zA-Z0-9_].
 */
export const channelUsernameSchema = z
  .string()
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/,
    "username канала: 5–32 символа, начинается с буквы, [a-zA-Z0-9_] (без @)",
  );

/** Вход создания канала (с zod-валидацией username). */
export type CreateChannelInput = {
  source_id: number;
  username: string;
  title?: string | null;
  last_message_id?: number;
  is_active?: boolean;
};

/** Найти канал по id. */
export function findById(id: number): TelegramChannel | undefined {
  return db
    .select()
    .from(telegramChannels)
    .where(eq(telegramChannels.id, id))
    .get();
}

/** Найти канал по username (без @). */
export function findByUsername(username: string): TelegramChannel | undefined {
  return db
    .select()
    .from(telegramChannels)
    .where(eq(telegramChannels.username, username))
    .get();
}

/**
 * Список каналов (с опциональной фильтрацией по source_id и is_active).
 * Сортировка по id (стабильный порядок для сбора).
 */
export function list(
  opts: ListOptions & { sourceId?: number; active?: boolean } = {},
): TelegramChannel[] {
  const conditions = [];
  if (opts.sourceId !== undefined) {
    conditions.push(eq(telegramChannels.source_id, opts.sourceId));
  }
  if (opts.active !== undefined) {
    conditions.push(eq(telegramChannels.is_active, opts.active));
  }
  const rows = db
    .select()
    .from(telegramChannels)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(opts.limit as number)
    .offset(opts.offset as number)
    .all();
  return rows.sort((a, b) => a.id - b.id);
}

/** Создать канал. username валидируется (формат Telegram). */
export function create(input: CreateChannelInput): TelegramChannel {
  const username = channelUsernameSchema.parse(input.username);
  const row = db
    .insert(telegramChannels)
    .values({
      source_id: input.source_id,
      username,
      title: input.title ?? null,
      last_message_id: input.last_message_id ?? 0,
      is_active: input.is_active ?? true,
    })
    .returning()
    .get();
  if (!row) {
    throw new Error(
      `telegram_channel insert returned no row (username=${JSON.stringify(input.username)})`,
    );
  }
  return row;
}

/**
 * Обновить курсор последнего прочитанного поста.
 * Используется в collect-цикле после прохода канала.
 */
export function updateCursor(id: number, lastMessageId: number): void {
  db.update(telegramChannels)
    .set({ last_message_id: lastMessageId })
    .where(eq(telegramChannels.id, id))
    .run();
}

/**
 * Обновить поля канала (title/is_active/last_message_id). Пустой patch — no-op.
 */
export function update(
  id: number,
  patch: Partial<{
    title: string | null;
    is_active: boolean;
    last_message_id: number;
  }>,
): TelegramChannel | undefined {
  if (Object.keys(patch).length === 0) {
    return findById(id);
  }
  return db
    .update(telegramChannels)
    .set(patch)
    .where(eq(telegramChannels.id, id))
    .returning()
    .get();
}

/** Удалить канал. */
export function remove(id: number): void {
  db.delete(telegramChannels).where(eq(telegramChannels.id, id)).run();
}
