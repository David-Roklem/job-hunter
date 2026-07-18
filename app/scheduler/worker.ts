/**
 * Ядро воркера планировщика (фаза 12).
 *
 * runWorkerOnce — одна итерация: claimNext → dispatch → markDone/markFailed
 * + планирование следующего шага цепочки.
 *
 * Цепочка: collect_vacancies → match → generate_draft (тупик apply_hh —
 * обрабатывается отдельно через runApply + throttle).
 *
 * Корневой collect_vacancies при старте создаёт scheduler_runs строку
 * (run_id), которая пробрасывается в payload следующих шагов. generate_draft
 * при завершении вызывает schedulerRunsRepo.finish(run_id).
 *
 * Тестирование: шаги мокаются (vi.mock "~/scheduler/steps"), воркер гоняется
 * на in-memory db. runWorkerOnce детерминирован (без real timers).
 */
import {
  jobsRepo,
  schedulerRunsRepo,
} from "~/db/repositories";
import type { Job, JobKind } from "~/db/schema";
import {
  runCollect,
  runMatch,
  runGenerateDrafts,
  runApply,
  type CollectStepResult,
  type MatchStepResult,
  type DraftStepResult,
} from "~/scheduler/steps";
import { ApplyThrottle, type ApplyThrottleConfig, startOfNextDay } from "~/hh/applyThrottle";

export type WorkerDeps = {
  /** Throttle-инстанс для apply. По умолчанию создаётся один на poll. */
  throttle: ApplyThrottle;
  /** Sleep между шагами цепочки (поведенческий). По умолчанию реальный setTimeout. */
  sleepBetweenSteps: (ms: number) => Promise<void>;
  /** Минимальная пауза между шагами цепочки, мс. */
  stepGapMs: number;
};

export type WorkerResult =
  | { kind: "idle" } // нет готовых задач
  | { kind: "done"; job: Job; nextKind?: JobKind }
  | { kind: "failed"; job: Job; error: string }
  | { kind: "deferred"; job: Job; runAfter: Date; reason: string };

function defaultDeps(): WorkerDeps {
  return {
    throttle: new ApplyThrottle(),
    sleepBetweenSteps: (ms) => new Promise((r) => setTimeout(r, ms)),
    stepGapMs: 0, // в проде ставить ~5-15с через env; в тестах 0
  };
}

/**
 * Одна итерация воркера. Берёт следующую задачу, исполняет, пишет результат.
 *
 * Возвращает исход для логирования/loop-контроля. НЕ бросает — все ошибки
 * шагов уходят в markFailed (continue-on-error для цикла).
 */
export async function runWorkerOnce(
  deps: Partial<WorkerDeps> = {},
): Promise<WorkerResult> {
  const d: WorkerDeps = { ...defaultDeps(), ...deps };
  const now = new Date();
  const job = jobsRepo.claimNext(now);
  if (!job) return { kind: "idle" };

  try {
    const result = await dispatch(job, d);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobsRepo.markFailed(job.id, message);
    return { kind: "failed", job, error: message };
  }
}

/**
 * Диспетчер по kind. НЕ ловит свои исключения — их ловит runWorkerOnce.
 * Внутри вызывает markDone/markFailed сам для детерминированных исходов
 * (deferred, cycle-limit).
 */
async function dispatch(job: Job, deps: WorkerDeps): Promise<WorkerResult> {
  switch (job.kind) {
    case "collect_vacancies":
      return dispatchCollect(job, deps);
    case "match":
      return dispatchMatch(job, deps);
    case "generate_draft":
      return dispatchDraft(job, deps);
    case "apply_hh":
      return dispatchApply(job, deps);
  }
}

// ---------------------------------------------------------------------------
// collect_vacancies: создать run, исполнить, запланировать match
// ---------------------------------------------------------------------------

async function dispatchCollect(
  job: Job,
  deps: WorkerDeps,
): Promise<WorkerResult> {
  const runId = schedulerRunsRepo.start();
  const stats = await runCollect();

  // Записать агрегированные stats в scheduler_runs.
  schedulerRunsRepo.mergeStats(runId, {
    collected: stats.aggregated.collected,
    matched_sources: stats.sourcesProcessed,
  });
  for (const err of stats.errors) {
    schedulerRunsRepo.pushError(runId, err);
  }

  jobsRepo.markDone(job.id, { run_id: runId, ...stats });

  // Запланировать match (через небольшую паузу — поведенческий throttle).
  if (deps.stepGapMs > 0) await deps.sleepBetweenSteps(deps.stepGapMs);
  jobsRepo.enqueue(
    "match",
    { run_id: runId },
    new Date(Date.now() + deps.stepGapMs),
  );

  return { kind: "done", job, nextKind: "match" };
}

// ---------------------------------------------------------------------------
// match: исполнить, запланировать generate_draft
// ---------------------------------------------------------------------------

async function dispatchMatch(job: Job, deps: WorkerDeps): Promise<WorkerResult> {
  const payload = jobsRepo.readPayload(job);
  const stats: MatchStepResult = await runMatch();

  schedulerRunsRepo.mergeStats(payload.run_id, {
    matched_pairs: (stats as { matched?: number }).matched ?? 0,
  });

  jobsRepo.markDone(job.id, stats);

  if (deps.stepGapMs > 0) await deps.sleepBetweenSteps(deps.stepGapMs);
  jobsRepo.enqueue(
    "generate_draft",
    { run_id: payload.run_id },
    new Date(Date.now() + deps.stepGapMs),
  );

  return { kind: "done", job, nextKind: "generate_draft" };
}

// ---------------------------------------------------------------------------
// generate_draft: исполнить, завершить run
// ---------------------------------------------------------------------------

async function dispatchDraft(job: Job, _deps: WorkerDeps): Promise<WorkerResult> {
  const payload = jobsRepo.readPayload(job);
  const stats: DraftStepResult = await runGenerateDrafts({
    minScore: payload.min_score,
  });

  const drafted =
    (stats as { drafted?: number }).drafted ??
    (stats as { generated?: number }).generated ??
    0;
  schedulerRunsRepo.mergeStats(payload.run_id, { drafted });

  // Завершить цикл.
  const finalStats = schedulerRunsRepo.findById(payload.run_id);
  if (finalStats) {
    const runStats = finalStats.stats_json
      ? safeParse(finalStats.stats_json)
      : schedulerRunsRepoEmpty();
    schedulerRunsRepo.finish(payload.run_id, runStats, {});
  }

  jobsRepo.markDone(job.id, stats);
  return { kind: "done", job };
}

// ---------------------------------------------------------------------------
// apply_hh: через throttle (тупик цепочки — ничего не энкьютит)
// ---------------------------------------------------------------------------

async function dispatchApply(
  job: Job,
  deps: WorkerDeps,
): Promise<WorkerResult> {
  const payload = jobsRepo.readPayload(job);
  const outcome = await runApply(payload.application_id, deps.throttle);

  if (outcome.kind === "applied") {
    if (outcome.result.ok) {
      jobsRepo.markDone(job.id, outcome.result);
      return { kind: "done", job };
    }
    // submit вернул ok=false (нет маппинга / капча / и т.п.) — failed.
    jobsRepo.markFailed(job.id, outcome.result.reason ?? "apply failed");
    return { kind: "failed", job, error: outcome.result.reason ?? "apply failed" };
  }

  if (outcome.kind === "deferred_to_tomorrow") {
    // Плановый перенос на завтра — не failed. markDone + новый apply_job
    // с run_after=startOfNextDay, чтобы сохранить историю (этот job done,
    // новый queued на завтра).
    jobsRepo.markDone(job.id, { deferred: true, reason: outcome.reason });
    jobsRepo.enqueue(
      "apply_hh",
      { application_id: payload.application_id },
      startOfNextDay(),
    );
    return {
      kind: "deferred",
      job,
      runAfter: startOfNextDay(),
      reason: outcome.reason,
    };
  }

  // cycle_limit_reached — transient: markFailed с retry (если attempts
  // позволяет, иначе failed окончательно). run_after через бэк-офф.
  jobsRepo.markFailed(job.id, outcome.reason);
  return { kind: "failed", job, error: outcome.reason };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function safeParse(raw: string): ReturnType<typeof schedulerRunsRepoEmpty> {
  try {
    return JSON.parse(raw);
  } catch {
    return schedulerRunsRepoEmpty();
  }
}

function schedulerRunsRepoEmpty() {
  // Локальный empty-stats (не импортируем из repo, чтобы не плодить циклы).
  return {
    collected: 0,
    matched_sources: 0,
    matched_pairs: 0,
    drafted: 0,
    applied: 0,
    errors: [] as string[],
  };
}

export type { ApplyThrottleConfig };
