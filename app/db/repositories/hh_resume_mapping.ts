/**
 * Репозиторий маппинга resume_template_id → hh resume_id (hash).
 *
 * Нужен фазе 11 apply-hh: форма отклика на hh требует hh-resume-id, а в БД мы
 * храним resume_template_id. Пользователь указывает соответствие один раз
 * (скрипт scripts/map-hh-resumes.ts), apply читает маппинг через findByTemplateId.
 *
 * 1:1 — UNIQUE(resume_template_id). Тонкий CRUD без JSON-полей.
 */
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { hh_resume_mapping } from "~/db/schema";
import type { ListOptions } from "./_shared";

export type HhResumeMapping = typeof hh_resume_mapping.$inferSelect;
export type NewHhResumeMapping = typeof hh_resume_mapping.$inferInsert;

/** Создать или обновить маппинг для шаблона (upsert по resume_template_id). */
export function upsert(input: {
  resume_template_id: number;
  hh_resume_id: string;
}): HhResumeMapping {
  const existing = findByTemplateId(input.resume_template_id);
  if (existing) {
    const updated = db
      .update(hh_resume_mapping)
      .set({ hh_resume_id: input.hh_resume_id, updated_at: new Date() })
      .where(eq(hh_resume_mapping.resume_template_id, input.resume_template_id))
      .returning()
      .get();
    if (!updated) {
      throw new Error(
        `hh_resume_mapping update returned no row (template=${input.resume_template_id})`,
      );
    }
    return updated;
  }
  const row = db
    .insert(hh_resume_mapping)
    .values({
      resume_template_id: input.resume_template_id,
      hh_resume_id: input.hh_resume_id,
    })
    .returning()
    .get();
  if (!row) {
    throw new Error(
      `hh_resume_mapping insert returned no row (template=${input.resume_template_id})`,
    );
  }
  return row;
}

/** Найти hh_resume_id по id шаблона резюме. undefined — маппинга нет. */
export function findByTemplateId(
  resumeTemplateId: number,
): HhResumeMapping | undefined {
  return db
    .select()
    .from(hh_resume_mapping)
    .where(eq(hh_resume_mapping.resume_template_id, resumeTemplateId))
    .get();
}

/** Список всех маппингов (для UI/скриптов). */
export function list(opts: ListOptions = {}): HhResumeMapping[] {
  return db
    .select()
    .from(hh_resume_mapping)
    .limit(opts.limit as number)
    .offset(opts.offset as number)
    .all();
}

/** Удалить маппинг по id шаблона. */
export function removeByTemplateId(resumeTemplateId: number): void {
  db.delete(hh_resume_mapping)
    .where(eq(hh_resume_mapping.resume_template_id, resumeTemplateId))
    .run();
}
