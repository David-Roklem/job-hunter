/**
 * Репозиторий сопроводительных писем (cover_letters).
 *
 * Тонкий CRUD без бизнес-логики. 1:1 с applications по UNIQUE(application_id) —
 * поэтому основная операция записи — upsert (а не create).
 */
import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import { cover_letters, type AiProvider } from "~/db/schema";
import { type ListOptions } from "./_shared";

export type CoverLetter = typeof cover_letters.$inferSelect;
export type NewCoverLetter = typeof cover_letters.$inferInsert;

/** Вход upsert'а письма (генерация AI). */
export type UpsertCoverLetterInput = {
  application_id: number;
  body_md: string;
  ai_provider?: AiProvider;
  model?: string;
};

/** Найти письмо по id. */
export function findById(id: number): CoverLetter | undefined {
  return db.select().from(cover_letters).where(eq(cover_letters.id, id)).get();
}

/** Найти письмо по application_id (1:1). */
export function findByApplicationId(
  application_id: number,
): CoverLetter | undefined {
  return db
    .select()
    .from(cover_letters)
    .where(eq(cover_letters.application_id, application_id))
    .get();
}

/** Список писем (с пагинацией, опционально по провайдеру). */
export function list(
  opts: ListOptions & { ai_provider?: AiProvider } = {},
): CoverLetter[] {
  const rows = db
    .select()
    .from(cover_letters)
    .where(
      opts.ai_provider
        ? eq(cover_letters.ai_provider, opts.ai_provider)
        : undefined,
    )
    .limit(opts.limit as number)
    .offset(opts.offset as number)
    .all();
  return rows;
}

/**
 * Upsert письма по UNIQUE(application_id).
 *
 * При конфликте — обновляем body_md/ai_provider/model/generated_at и сбрасываем
 * edited_at (контент пересгенерирован, ручная правка потеряна).
 */
export function upsert(input: UpsertCoverLetterInput): CoverLetter {
  const now = new Date();
  const row = db
    .insert(cover_letters)
    .values({
      application_id: input.application_id,
      body_md: input.body_md,
      ai_provider: input.ai_provider,
      model: input.model,
      generated_at: now,
    })
    .onConflictDoUpdate({
      target: cover_letters.application_id,
      set: {
        body_md: input.body_md,
        ai_provider: input.ai_provider,
        model: input.model,
        generated_at: now,
        edited_at: null,
      },
    })
    .returning()
    .get();
  if (!row) {
    throw new Error(
      `cover_letters upsert returned no row (application_id=${input.application_id})`,
    );
  }
  return row;
}

/** Ручное редактирование тела письма (для review-ui). Обновляет edited_at. */
export function updateBody(id: number, body_md: string): CoverLetter | undefined {
  return db
    .update(cover_letters)
    .set({ body_md, edited_at: new Date() })
    .where(and(eq(cover_letters.id, id)))
    .returning()
    .get();
}

/** Удалить письмо. */
export function remove(id: number): boolean {
  const res = db.delete(cover_letters).where(eq(cover_letters.id, id)).run();
  return res.changes > 0;
}
