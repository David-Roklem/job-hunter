/**
 * Репозиторий вакансий (vacancies).
 *
 * Тонкий CRUD без бизнес-логики. Дедупликация — через UNIQUE(source_id,
 * external_id): create() использует onConflictDoNothing и возвращает существующую
 * строку при конфликте (upsert-семантика для сбора).
 *
 * Примечание: реляционный query API Drizzle (db.query.*) асинхронный (thenable)
 * даже для sync-драйвера better-sqlite3 — поэтому findById/list — async.
 * Прямые db.select/db.insert/db.update — синхронные (.get()/.all()).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { companies, sources, vacancies, type EmploymentType } from "~/db/schema";
import {
  employmentTypeSchema,
  fromJson,
  toJson,
  vacancyStatusSchema,
  type ListOptions,
} from "./_shared";

export type Vacancy = typeof vacancies.$inferSelect;
export type NewVacancy = typeof vacancies.$inferInsert;

/** Zod-схема для raw_json вакансии (сырой ответ источника). */
const rawSchema = z.record(z.string(), z.unknown());

/** DTO с распарсенным raw (вместо непрозрачной строки raw_json). */
export type VacancyDTO = Omit<Vacancy, "raw_json"> & { raw: Record<string, unknown> };

/** Преобразовать строку raw_json в объект с zod-валидацией. */
function toDTO<T extends Vacancy>(row: T): Omit<T, "raw_json"> & { raw: Record<string, unknown> } {
  const { raw_json, ...rest } = row;
  return { ...rest, raw: fromJson(raw_json, rawSchema) };
}

/** Вход создания вакансии (с zod-валидацией границе). */
export type CreateVacancyInput = {
  source_id: number;
  external_id: string;
  company_id?: number | null;
  title: string;
  description: string;
  salary_from?: number | null;
  salary_to?: number | null;
  currency?: string | null;
  location?: string | null;
  employment_type?: EmploymentType | null;
  url: string;
  raw: Record<string, unknown>;
  collected_at: Date;
};

/** Найти вакансию по id (с relation'ами source + company). raw_json распарсен в raw. */
export async function findById(id: number) {
  const row = await db.query.vacancies.findFirst({
    where: eq(vacancies.id, id),
    with: {
      source: true,
      company: true,
    },
  });
  return row ? toDTO(row) : undefined;
}

/**
 * Найти существующую вакансию по ключу дедупликации (source_id, external_id).
 * Синхронная — использует db.select (прямая выборка без relations).
 */
export function findByExternalId(
  source_id: number,
  external_id: string,
): Vacancy | undefined {
  return db
    .select()
    .from(vacancies)
    .where(
      and(eq(vacancies.source_id, source_id), eq(vacancies.external_id, external_id)),
    )
    .get();
}

/**
 * Создать вакансию. При конфликте UNIQUE(source_id, external_id) — ничего не
 * делает и возвращает уже существующую строку (идемпотентный сбор).
 */
export function create(input: CreateVacancyInput): Vacancy {
  const employment_type =
    input.employment_type !== undefined && input.employment_type !== null
      ? employmentTypeSchema.parse(input.employment_type)
      : null;

  const inserted = db
    .insert(vacancies)
    .values({
      source_id: input.source_id,
      external_id: input.external_id,
      company_id: input.company_id ?? null,
      title: input.title,
      description: input.description,
      salary_from: input.salary_from ?? null,
      salary_to: input.salary_to ?? null,
      currency: input.currency ?? null,
      location: input.location ?? null,
      employment_type,
      url: input.url,
      raw_json: toJson(input.raw),
      collected_at: input.collected_at,
    })
    .onConflictDoNothing({
      target: [vacancies.source_id, vacancies.external_id],
    })
    .returning()
    .get();

  // onConflictDoNothing возвращает undefined при конфликте UNIQUE(source_id, external_id).
  // В этом случае берём существующую строку. Если её нет (собственно конфликт без
  // строки — гонка удаления), бросаем понятную ошибку вместо падения с `!`.
  if (inserted) return inserted;
  const existing = findByExternalId(input.source_id, input.external_id);
  if (!existing) {
    throw new Error(
      `vacancy insert returned no row and no existing (source_id=${input.source_id}, external_id=${JSON.stringify(input.external_id)}) — возможна гонка удаления`,
    );
  }
  return existing;
}

/** Список вакансий (с пагинацией, опционально по статусу). С relations, raw распарсен. */
export async function list(
  opts: ListOptions & { status?: Vacancy["status"] } = {},
) {
  const rows = await db.query.vacancies.findMany({
    where: opts.status ? eq(vacancies.status, opts.status) : undefined,
    limit: opts.limit,
    offset: opts.offset,
    with: { source: true, company: true },
  });
  return rows.map(toDTO);
}

/** Обновить поля вакансии (включая status). */
export function update(
  id: number,
  patch: Partial<{
    title: string;
    description: string;
    status: Vacancy["status"];
    company_id: number | null;
  }>,
): Vacancy | undefined {
  const values: Partial<NewVacancy> = { ...patch };
  if (patch.status !== undefined) {
    values.status = vacancyStatusSchema.parse(patch.status);
  }
  return db
    .update(vacancies)
    .set(values)
    .where(eq(vacancies.id, id))
    .returning()
    .get();
}

/** Доступ к связанным таблицам для удобства (без прямого импорта в feature-код). */
export { sources, companies };
