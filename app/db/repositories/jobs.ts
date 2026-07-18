/**
 * Репозиторий очереди фоновых задач (таблица jobs, фаза 12 scheduler).
 *
 * Планировщик (app/scheduler/worker.ts) берёт следующую задачу через
 * claimNext(now) — атомарный queued→running. Шаги цепочки (collect→match→
 * generate_draft) при done сами энкьютят следующий шаг через enqueue.
 * apply_hh создаётся ТОЛЬКО из action /applications/:id approve.
 *
 * JSON-payload валидируется zod на границе репозитория (см. payloadSchemas).
 * claimNext использует UPDATE…WHERE id=? RETURNING для атомарного захвата
 * (better-sqlite3 синхронный — race невозможен в single-thread Node).
 */
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "~/db";
import {
  jobs,
  type JobKind,
  type JobStatus,
} from "~/db/schema";
import { fromJson, toJson, type ListOptions } from "./_shared";
import { z } from "zod";

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

// ---------------------------------------------------------------------------
// Payload-схемы по kind. parsePayload сериализует обратно в toJson при записи.
// ---------------------------------------------------------------------------

/** payload для collect_vacancies: пустой объект (источники берём из sources). */
export const collectVacanciesPayloadSchema = z
  .object({})
  .strict();

/** payload для match: ссылка на run цикла (для scheduler_runs.finish). */
export const matchPayloadSchema = z
  .object({
    run_id: z.number().int().positive(),
  })
  .strict();

/** payload для generate_draft: ссылка на run + порог скоринга. */
export const generateDraftPayloadSchema = z
  .object({
    run_id: z.number().int().positive(),
    min_score: z.number().int().min(0).max(100).optional(),
  })
  .strict();

/** payload для apply_hh: id application, одобренной пользователем. */
export const applyHhPayloadSchema = z
  .object({
    application_id: z.number().int().positive(),
  })
  .strict();

/** Объединение payload-схем по kind (для type-narrowing в воркере). */
export const payloadSchemas = {
  collect_vacancies: collectVacanciesPayloadSchema,
  match: matchPayloadSchema,
  generate_draft: generateDraftPayloadSchema,
  apply_hh: applyHhPayloadSchema,
} as const;

export type PayloadOf<K extends JobKind> = z.infer<
  (typeof payloadSchemas)[K]
>;

/** Мапа kind→payload для enqueue. */
export type PayloadByKind = {
  collect_vacancies: z.infer<typeof collectVacanciesPayloadSchema>;
  match: z.infer<typeof matchPayloadSchema>;
  generate_draft: z.infer<typeof generateDraftPayloadSchema>;
  apply_hh: z.infer<typeof applyHhPayloadSchema>;
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Поставить задачу в очередь.
 *
 * run_after по умолчанию = сейчас (исполнять сразу). Для троттлинга/ретраев
 * передай будущий timestamp. attempts/max_attempts — дефолты из схемы (0/3).
 */
export function enqueue<K extends JobKind>(
  kind: K,
  payload: PayloadByKind[K],
  runAfter: Date = new Date(),
  opts: { maxAttempts?: number } = {},
): Job {
  const row = db
    .insert(jobs)
    .values({
      kind,
      payload_json: toJson(payload),
      status: "queued",
      run_after: runAfter,
      max_attempts: opts.maxAttempts ?? 3,
    })
    .returning()
    .get();
  if (!row) {
    throw new Error(`jobs enqueue returned no row (kind=${kind})`);
  }
  return row;
}

/** Найти задачу по id. */
export function findById(id: number): Job | undefined {
  return db.select().from(jobs).where(eq(jobs.id, id)).get();
}

/** Десериализовать payload задачи с валидацией по kind. */
export function readPayload<K extends JobKind>(
  job: { kind: K; payload_json: string },
): PayloadOf<K> {
  const schema = payloadSchemas[job.kind] as unknown as z.ZodType<PayloadOf<K>>;
  return fromJson(job.payload_json, schema);
}

/**
 * Атомарно захватить следующую исполняемую задачу (queued→running).
 *
 * Условие: status='queued' AND run_after<=now. Выборка — первая по run_after
 * (FIFO с учётом отложенных). locked_at = now для видимости в UI/аудите.
 * attempts инкрементируется (защита от бесконечного retry: max_attempts).
 *
 * better-sqlite3 синхронный в single-thread Node — UPDATE…RETURNING атомарно,
 * race между poll-итерациями невозможен (нет конкурентных claimNext).
 */
export function claimNext(now: Date = new Date()): Job | undefined {
  const candidate = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "queued"), lte(jobs.run_after, now)))
    .orderBy(asc(jobs.run_after), asc(jobs.id))
    .limit(1)
    .get();
  if (!candidate) return undefined;

  const claimed = db
    .update(jobs)
    .set({
      status: "running",
      locked_at: now,
      attempts: candidate.attempts + 1,
      updated_at: now,
    })
    .where(eq(jobs.id, candidate.id))
    .returning()
    .get();
  return claimed ?? undefined;
}

/** Отметить задачу выполненной, записать result_json. */
export function markDone(id: number, result: unknown): void {
  db.update(jobs)
    .set({
      status: "done",
      result_json: toJson(result),
      error: null,
      finished_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(jobs.id, id))
    .run();
}

/**
 * Отметить задачу провалившейся.
 *
 * Если attempts < max_attempts — перевести в queued с экспоненциальным
 * бэк-оффом (отложить на 2^attempts минут), иначе — failed окончательно.
 * Возвращает итоговый status (для логирования воркером).
 */
export function markFailed(
  id: number,
  error: string,
  opts: { now?: Date } = {},
): JobStatus {
  const now = opts.now ?? new Date();
  const job = findById(id);
  if (!job) throw new Error(`markFailed: job ${id} not found`);

  const exhausted = job.attempts >= job.max_attempts;
  if (exhausted) {
    db.update(jobs)
      .set({
        status: "failed",
        error,
        finished_at: now,
        updated_at: now,
      })
      .where(eq(jobs.id, id))
      .run();
    return "failed";
  }

  // Экспоненциальный бэк-офф: 2^attempts минут (2, 4, 8, ...).
  const backoffMs = Math.pow(2, job.attempts) * 60_000;
  const runAfter = new Date(now.getTime() + backoffMs);
  db.update(jobs)
    .set({
      status: "queued",
      error,
      run_after: runAfter,
      locked_at: null,
      updated_at: now,
    })
    .where(eq(jobs.id, id))
    .run();
  return "queued";
}

/** Список задач с опциональным фильтром по статусу. */
export function list(
  opts: ListOptions & { status?: JobStatus } = {},
): Job[] {
  const conds = [];
  if (opts.status) conds.push(eq(jobs.status, opts.status));
  const q = db.select().from(jobs).$dynamic();
  if (conds.length > 0) q.where(and(...conds));
  return q.limit(opts.limit ?? 200).offset(opts.offset ?? 0).orderBy(asc(jobs.id)).all();
}

/**
 * Перевести running задачу в cancelled (pause из UI).
 *
 * Только running→cancelled имеет смысл «паузы» (воркер уже взял задачу).
 * Для queued pause = cancel (см. cancelQueued).
 */
export function cancel(id: number): void {
  db.update(jobs)
    .set({ status: "cancelled", finished_at: new Date(), updated_at: new Date() })
    .where(eq(jobs.id, id))
    .run();
}

/**
 * Возобновить cancelled/failed задачу: статус queued, run_after=now,
 * attempts сбрасывается в 0 (явный ручной retry — не считается попыткой).
 */
export function retry(id: number): void {
  db.update(jobs)
    .set({
      status: "queued",
      attempts: 0,
      error: null,
      locked_at: null,
      run_after: new Date(),
      finished_at: null,
      updated_at: new Date(),
    })
    .where(eq(jobs.id, id))
    .run();
}

/**
 * Pause: cancelled для running (см. cancel), либо перевод queued→cancelled
 * (чтобы не было подхвачено до явного resume).
 */
export function pause(id: number): void {
  cancel(id);
}

/** Resume: то же что retry (cancel→queued с этого момента). */
export function resume(id: number): void {
  retry(id);
}

/** Счётчики по статусам (для плашки на главной). */
export function countByStatus(): Record<JobStatus, number> {
  const rows = db
    .select()
    .from(jobs)
    .all();
  const out: Record<JobStatus, number> = {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const r of rows) {
    out[r.status] += 1;
  }
  return out;
}

/** Счётчик apply_hh за сегодня (сегодня = с полуночи локально). */
export function countApplyToday(now: Date = new Date()): number {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  // Считаем apply_hh, которые сегодня были исполнены (done с finished_at) ИЛИ
  // сейчас running. finished_at может быть null у running — отдельно.
  const doneRows = db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, "apply_hh"),
        eq(jobs.status, "done"),
        gte(jobs.finished_at, startOfDay),
      ),
    )
    .all();
  const runningRows = db
    .select()
    .from(jobs)
    .where(
      and(eq(jobs.kind, "apply_hh"), eq(jobs.status, "running")),
    )
    .all();
  return doneRows.length + runningRows.length;
}
