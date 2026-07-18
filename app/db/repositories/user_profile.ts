/**
 * Репозиторий профиля кандидата (singleton, фаза cover-letter-profile).
 *
 * user_profile — единственная строка (id=1). Хранит имя, контакты и
 * сигнатуру письма; подставляется в промпт генерации сопроводительного,
 * чтобы модель не вставляла плейсхолдеры ([Имя], [Ссылка на Telegram]).
 *
 * Singleton-конвенция: get() возвращает профиль или null (если не задан),
 * upsert() всегда пишет id=1 (INSERT OR REPLACE). Миграция НЕ создаёт
 * строку по умолчанию — пользователь заполняет через /settings.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { user_profile } from "~/db/schema";
import { fromJson, toJson } from "./_shared";

export type UserProfile = typeof user_profile.$inferSelect;

/**
 * Контакты кандидата. Все поля опциональны — пользователь заполняет что нужно.
 * Ключи стабильны (используются в промпте и UI).
 */
export const contactsSchema = z.object({
  telegram: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  github: z.string().optional(),
  website: z.string().optional(),
  linkedin: z.string().optional(),
});
export type Contacts = z.infer<typeof contactsSchema>;

/** DTO с распарсенными контактами (вместо непрозрачного JSON). */
export type UserProfileDTO = Omit<UserProfile, "contacts_json"> & {
  contacts: Contacts;
};

/** Вход для upsert. */
export type UpsertProfileInput = {
  name: string;
  contacts?: Partial<Contacts>;
  signature_md?: string;
};

function toDTO(row: UserProfile): UserProfileDTO {
  const { contacts_json, ...rest } = row;
  return { ...rest, contacts: fromJson(contacts_json, contactsSchema) };
}

/** Singleton id. */
const SINGLETON_ID = 1;

/**
 * Получить профиль или null, если не задан.
 *
 * null означает «профиль не заполнен» — генератор писем работает в старом
 * режиме (без подстановки имени/контактов, модель может вставить плейсхолдеры).
 */
export function get(): UserProfileDTO | null {
  const row = db
    .select()
    .from(user_profile)
    .where(eq(user_profile.id, SINGLETON_ID))
    .get();
  return row ? toDTO(row) : null;
}

/**
 * Создать или обновить единственную строку профиля (INSERT OR REPLACE id=1).
 *
 * Возвращает DTO с распарсенными контактами. Бросает zod-error при невалидных
 * контактах.
 */
export function upsert(input: UpsertProfileInput): UserProfileDTO {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("user_profile.name не может быть пустым");
  }
  const contacts = contactsSchema.parse(input.contacts ?? {});
  const row = db
    .insert(user_profile)
    .values({
      id: SINGLETON_ID,
      name,
      contacts_json: toJson(contacts),
      signature_md: input.signature_md ?? "",
    })
    .onConflictDoUpdate({
      target: user_profile.id,
      set: {
        name,
        contacts_json: toJson(contacts),
        signature_md: input.signature_md ?? "",
        updated_at: new Date(),
      },
    })
    .returning()
    .get();
  if (!row) throw new Error("user_profile upsert returned no row");
  return toDTO(row);
}
