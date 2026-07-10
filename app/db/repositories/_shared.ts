/**
 * Вспомогательные типы и хелперы для репозиториев.
 *
 * InferSelect/InferInsert берём из самих таблиц (через $inferSelect/$inferInsert)
 * — это идиоматичный способ Drizzle без дублирования.
 */
import { z } from "zod";
import {
  aiProviders,
  applicationStatuses,
  employmentTypes,
  jobKinds,
  jobStatuses,
  sourceKinds,
  vacancyStatuses,
} from "~/db/schema";

/** Опциональные параметры листинга: лимит/оффсет. */
export type ListOptions = { limit?: number; offset?: number };

// Пагинация: все три репозитория передают limit/offset в Drizzle напрямую
// (sources — через db.select().limit().offset(); vacancies/applications —
// через db.query.*.findMany({ limit, offset })). undefined = без лимита.

// ---------------------------------------------------------------------------
// Zod-схемы для JSON-полей (валидируются на границе репозитория).
// skills/experience объявлены под resume_templates; payload_json для jobs
// намеренно НЕ сейчас — его форма прояснится в фазе scheduler (12).
// ---------------------------------------------------------------------------

/** Конфиг источника: произвольный объект ({ url?, channel?, filters?, ... }). */
export const sourceConfigSchema = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// resume_templates: навыки + опыт (строгая форма под matcher 08 / draft 09).
// ---------------------------------------------------------------------------

/** Навыки шаблона резюме — массив строк. */
export const skillsSchema = z.array(z.string());

/**
 * Один пункт опыта работы в шаблоне резюме.
 * period.to === null — «по настоящее время».
 */
export const experienceItemSchema = z.object({
  company: z.string(),
  role: z.string(),
  period: z.object({
    from: z.string(), // "2022-01"
    to: z.string().nullable(), // null = «по настоящее время»
  }),
  description: z.string(),
});

/** Опыт работы в шаблоне резюме — массив пунктов. */
export const experienceSchema = z.array(experienceItemSchema);
export type ExperienceItem = z.infer<typeof experienceItemSchema>;

// Re-export enum-значений как zod-enum (полный набор под все enum-колонки схемы —
// для консистентности, даже если репозиторий для таблицы ещё не написан).
export const sourceKindSchema = z.enum(sourceKinds);
export const vacancyStatusSchema = z.enum(vacancyStatuses);
export const employmentTypeSchema = z.enum(employmentTypes);
export const applicationStatusSchema = z.enum(applicationStatuses);
export const aiProviderSchema = z.enum(aiProviders);
export const jobKindSchema = z.enum(jobKinds);
export const jobStatusSchema = z.enum(jobStatuses);

// ---------------------------------------------------------------------------
// JSON-сериализация хелперы (SQLite хранит JSON как text).
// ---------------------------------------------------------------------------

/** Сериализует значение в JSON-строку для записи в text-колонку. */
export function toJson<T>(value: T): string {
  return JSON.stringify(value);
}

/**
 * Парсит JSON-колонку с zod-валидацией.
 *
 * Бросает Error с понятным сообщением при повреждённом JSON (SyntaxError
 * от JSON.parse оборачивается) и ZodError при невалидной форме данных.
 * Коррупция text-колонки — реалистичный сценарий (ручная правка, миграция,
 * частичная запись), поэтому ошибка должна быть информативной, а не
 * «Unexpected token in JSON».
 */
export function fromJson<T>(raw: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `fromJson: повреждённый JSON в колонке (длина=${raw.length}, префикс=${JSON.stringify(raw.slice(0, 40))})`,
      { cause },
    );
  }
  return schema.parse(parsed);
}
