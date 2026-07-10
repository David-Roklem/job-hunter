/**
 * Репозиторий шаблонов резюме (resume_templates).
 *
 * Тонкий CRUD без бизнес-логики. Доступ к БД — через db из app/db/index.ts.
 *
 * JSON-поля skills_json/experience_json парсятся на границе репозитория через
 * строгие zod-схемы (skillsSchema, experienceSchema) — форма опыта зафиксирована
 * заранее под matcher (фаза 08) и draft-generator (фаза 09).
 *
 * Синхронный API: db.select/insert/update/delete возвращают .get()/.all()/.run().
 */
import { desc, eq } from "drizzle-orm";
import { db } from "~/db";
import { resume_templates } from "~/db/schema";
import {
  experienceSchema,
  fromJson,
  skillsSchema,
  toJson,
  type ExperienceItem,
  type ListOptions,
} from "./_shared";

export type ResumeTemplate = typeof resume_templates.$inferSelect;
export type NewResumeTemplate = typeof resume_templates.$inferInsert;

/** Вход создания шаблона (с zod-валидацией на границе). */
export type CreateResumeTemplateInput = {
  name: string;
  role: string;
  summary: string;
  skills: string[];
  experience: ExperienceItem[];
  content_md: string;
  is_active?: boolean;
};

/** DTO с распарсенными skills/experience (вместо непрозрачных *_json строк). */
export type ResumeTemplateDTO = Omit<
  ResumeTemplate,
  "skills_json" | "experience_json"
> & {
  skills: string[];
  experience: ExperienceItem[];
};

/** Преобразовать строковые JSON-колонки в валидированные объекты. */
function toDTO(row: ResumeTemplate): ResumeTemplateDTO {
  const { skills_json, experience_json, ...rest } = row;
  return {
    ...rest,
    skills: fromJson(skills_json, skillsSchema),
    experience: fromJson(experience_json, experienceSchema),
  };
}

/** Создать шаблон резюме. */
export function create(input: CreateResumeTemplateInput): ResumeTemplate {
  const skills_json = toJson(skillsSchema.parse(input.skills));
  const experience_json = toJson(experienceSchema.parse(input.experience));
  const row = db
    .insert(resume_templates)
    .values({
      name: input.name,
      role: input.role,
      summary: input.summary,
      skills_json,
      experience_json,
      content_md: input.content_md,
      is_active: input.is_active ?? true,
    })
    .returning()
    .get();
  if (!row) {
    throw new Error(
      `resume_template insert returned no row (name=${JSON.stringify(input.name)})`,
    );
  }
  return row;
}

/** Найти шаблон по id. skills/experience распарсены. */
export function findById(id: number): ResumeTemplateDTO | undefined {
  const row = db.select().from(resume_templates).where(eq(resume_templates.id, id)).get();
  return row ? toDTO(row) : undefined;
}

/**
 * Список шаблонов (с нативной пагинацией Drizzle).
 * Сортировка updated_at desc — недавно изменённые сверху (удобно для UI списка).
 */
export function list(opts: ListOptions = {}): ResumeTemplateDTO[] {
  const rows = db
    .select()
    .from(resume_templates)
    .orderBy(desc(resume_templates.updated_at))
    .limit(opts.limit)
    .offset(opts.offset)
    .all();
  return rows.map(toDTO);
}

/**
 * Обновить поля шаблона. Пустой patch — no-op (возвращает текущую строку).
 * skills/experience проходят zod-валидацию при наличии в patch.
 */
export function update(
  id: number,
  patch: Partial<{
    name: string;
    role: string;
    summary: string;
    skills: string[];
    experience: ExperienceItem[];
    content_md: string;
    is_active: boolean;
  }>,
): ResumeTemplate | undefined {
  const values: Partial<NewResumeTemplate> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.role !== undefined) values.role = patch.role;
  if (patch.summary !== undefined) values.summary = patch.summary;
  if (patch.skills !== undefined) {
    values.skills_json = toJson(skillsSchema.parse(patch.skills));
  }
  if (patch.experience !== undefined) {
    values.experience_json = toJson(experienceSchema.parse(patch.experience));
  }
  if (patch.content_md !== undefined) values.content_md = patch.content_md;
  if (patch.is_active !== undefined) values.is_active = patch.is_active;
  if (Object.keys(values).length === 0) {
    return db.select().from(resume_templates).where(eq(resume_templates.id, id)).get();
  }
  return db
    .update(resume_templates)
    .set(values)
    .where(eq(resume_templates.id, id))
    .returning()
    .get();
}

/** Удалить шаблон по id. Возвращает true, если строка была удалена. */
export function remove(id: number): boolean {
  const result = db.delete(resume_templates).where(eq(resume_templates.id, id)).run();
  return result.changes > 0;
}
