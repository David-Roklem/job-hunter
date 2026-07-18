/**
 * Репозиторий циклов планировщика (таблица scheduler_runs, фаза 12).
 *
 * Корневой job collect_vacancies при старте цикла создаёт здесь строку через
 * start(). Цепочка collect→match→generate_draft пишет агрегированные stats
 * при завершении (finish). Без FK — цикл независим от конкретной job-строки
 * (одна строка на весь прогон цепочки).
 */
import { desc, eq, isNotNull } from "drizzle-orm";
import { db } from "~/db";
import { scheduler_runs } from "~/db/schema";
import { fromJson, toJson, type ListOptions } from "./_shared";
import { z } from "zod";

export type SchedulerRun = typeof scheduler_runs.$inferSelect;

/** Агрегированная статистика одного цикла (JSON-колонка stats_json). */
export const runStatsSchema = z.object({
  // collect
  collected: z.number().int().default(0),
  matched_sources: z.number().int().default(0),
  // match
  matched_pairs: z.number().int().default(0),
  // generate_draft
  drafted: z.number().int().default(0),
  // apply (опционально — apply идёт вне цикла, но для аудита)
  applied: z.number().int().default(0),
  errors: z.array(z.string()).default([]),
});
export type RunStats = z.infer<typeof runStatsSchema>;

export function emptyStats(): RunStats {
  return {
    collected: 0,
    matched_sources: 0,
    matched_pairs: 0,
    drafted: 0,
    applied: 0,
    errors: [],
  };
}

/** Начать новый цикл. Возвращает id (для проброса в payload следующих шагов). */
export function start(now: Date = new Date()): number {
  const row = db
    .insert(scheduler_runs)
    .values({ started_at: now })
    .returning()
    .get();
  if (!row) throw new Error("scheduler_runs insert returned no row");
  return row.id;
}

/** Дописать/слить stats (для накопления по шагам цепочки). */
export function mergeStats(
  runId: number,
  patch: Partial<RunStats>,
  opts: { now?: Date } = {},
): void {
  const now = opts.now ?? new Date();
  const run = findById(runId);
  if (!run) throw new Error(`scheduler_runs ${runId} not found`);
  const current = run.stats_json
    ? fromJson(run.stats_json, runStatsSchema)
    : emptyStats();
  const next: RunStats = {
    ...current,
    ...patch,
    errors: patch.errors
      ? [...current.errors, ...patch.errors]
      : current.errors,
  };
  db.update(scheduler_runs)
    .set({ stats_json: toJson(next), updated_at: now })
    .where(eq(scheduler_runs.id, runId))
    .run();
}

/** Добавить сообщение об ошибке в errors[] текущего цикла. */
export function pushError(runId: number, message: string): void {
  const run = findById(runId);
  if (!run) return;
  const current = run.stats_json
    ? fromJson(run.stats_json, runStatsSchema)
    : emptyStats();
  current.errors.push(message);
  db.update(scheduler_runs)
    .set({ stats_json: toJson(current), updated_at: new Date() })
    .where(eq(scheduler_runs.id, runId))
    .run();
}

/**
 * Завершить цикл: зафиксировать finished_at + финальные stats.
 *
 * last_error проставляется, если цепочка упала на каком-то шаге
 * (воркер передаёт сюда сообщение ошибки финального шага).
 */
export function finish(
  runId: number,
  stats: RunStats,
  opts: { now?: Date; lastError?: string } = {},
): void {
  const now = opts.now ?? new Date();
  db.update(scheduler_runs)
    .set({
      finished_at: now,
      stats_json: toJson(stats),
      last_error: opts.lastError,
      updated_at: now,
    })
    .where(eq(scheduler_runs.id, runId))
    .run();
}

export function findById(id: number): SchedulerRun | undefined {
  return db
    .select()
    .from(scheduler_runs)
    .where(eq(scheduler_runs.id, id))
    .get();
}

export function list(opts: ListOptions = {}): SchedulerRun[] {
  return db
    .select()
    .from(scheduler_runs)
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0)
    .all();
}

/**
 * Последний завершённый цикл (finished_at IS NOT NULL), свежий сверху.
 * Используется дашбордом для показа итогов последнего прогона.
 */
export function lastFinished(): SchedulerRun | undefined {
  return db
    .select()
    .from(scheduler_runs)
    .where(isNotNull(scheduler_runs.finished_at))
    .orderBy(desc(scheduler_runs.finished_at))
    .limit(1)
    .get();
}
