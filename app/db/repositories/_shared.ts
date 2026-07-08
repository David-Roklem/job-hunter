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

// Пагинация применяется inline в каждом репозитории (Drizzle SQLite sync API
// не даёт единого .limit()/.offset() для select().all(); для db.query.*
// limit/offset передаются напрямую в findMany).

// ---------------------------------------------------------------------------
// Zod-схемы для JSON-полей (валидируются на границе репозитория).
// ---------------------------------------------------------------------------

/** Строковый массив навыков. */
export const skillsSchema = z.array(z.string());

/** Произвольный объект конфигурации источника. */
export const sourceConfigSchema = z.record(z.string(), z.unknown());

/** Произвольный объект опыта работы в резюме. */
export const experienceSchema = z.record(z.string(), z.unknown());

/** Произвольный payload задачи очереди. */
export const jobPayloadSchema = z.record(z.string(), z.unknown());

/** Произвольный результат задачи. */
export const jobResultSchema = z.record(z.string(), z.unknown());

// Re-export enum-значений как zod-enum для удобства валидации входов.
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

/** Парсит JSON-колонку с zod-валидацией. Бросает ZodError при невалидных данных. */
export function fromJson<T>(raw: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(raw));
}
