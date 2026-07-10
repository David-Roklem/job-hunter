/**
 * Репозиторий откликов (applications).
 *
 * Тонкий CRUD без бизнес-логики. UNIQUE(vacancy_id, resume_template_id) —
 * один шаблон резюме на вакансию в одном отклике.
 */
import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import {
  applications,
  type ApplicationStatus,
} from "~/db/schema";
import {
  applicationStatusSchema,
  type ListOptions,
} from "./_shared";

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;

/** Вход создания отклика. */
export type CreateApplicationInput = {
  vacancy_id: number;
  resume_template_id: number;
  match_score?: number | null;
  status?: ApplicationStatus;
};

/** Найти отклик по id (с relation'ами vacancy + resume_template + cover_letter). */
export async function findById(id: number) {
  return db.query.applications.findFirst({
    where: eq(applications.id, id),
    with: {
      vacancy: true,
      resume_template: true,
      cover_letter: true,
    },
  });
}

/**
 * Найти отклик по ключу уникальности (vacancy_id, resume_template_id).
 */
export function findByVacancyAndResume(
  vacancy_id: number,
  resume_template_id: number,
): Application | undefined {
  return db
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.vacancy_id, vacancy_id),
        eq(applications.resume_template_id, resume_template_id),
      ),
    )
    .get();
}

/** Создать отклик. Бросает при нарушении UNIQUE(vacancy_id, resume_template_id) или FK. */
export function create(input: CreateApplicationInput): Application {
  const row = db
    .insert(applications)
    .values({
      vacancy_id: input.vacancy_id,
      resume_template_id: input.resume_template_id,
      match_score: input.match_score ?? null,
      status: input.status ?? "draft",
    })
    .returning()
    .get();
  if (!row) {
    throw new Error(
      `application insert returned no row (vacancy_id=${input.vacancy_id}, resume_template_id=${input.resume_template_id})`,
    );
  }
  return row;
}

/** Список откликов (с пагинацией, опционально по статусу). С relations. */
export async function list(
  opts: ListOptions & { status?: Application["status"] } = {},
) {
  const rows = await db.query.applications.findMany({
    where: opts.status ? eq(applications.status, opts.status) : undefined,
    limit: opts.limit,
    offset: opts.offset,
    with: {
      vacancy: true,
      resume_template: true,
    },
  });
  return rows;
}

/** Обновить поля отклика (статус, скор, дата отправки). Пустой patch — no-op. */
export function update(
  id: number,
  patch: Partial<{
    status: Application["status"];
    match_score: number | null;
    submitted_at: Date | null;
  }>,
): Application | undefined {
  const values: Partial<NewApplication> = { ...patch };
  if (patch.status !== undefined) {
    values.status = applicationStatusSchema.parse(patch.status);
  }
  if (Object.keys(values).length === 0) {
    return db.select().from(applications).where(eq(applications.id, id)).get();
  }
  return db
    .update(applications)
    .set(values)
    .where(eq(applications.id, id))
    .returning()
    .get();
}
