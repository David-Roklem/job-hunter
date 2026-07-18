/**
 * Шаги цепочки планировщика (фаза 12).
 *
 * Каждый шаг — чистая async-функция, оборачивающая существующий оркестратор
 * (collect/match/generateDrafts/submit) и возвращающая структурированный
 * результат для записи в jobs.result_json и scheduler_runs.stats_json.
 *
 * Шаг НЕ занимается планированием следующего шага — это делает worker.dispatch
 * (сохраняет единую точку оркестрации цепочки). Шаг только исполняет.
 */
import { collectVacancies, type CollectStats } from "~/hh/collect";
import { matchAll, type MatchAllStats } from "~/matcher/match";
import { generateDraftsAll } from "~/ai/generateDrafts";
import { sourcesRepo, searchProfilesRepo } from "~/db/repositories";
import { ApplyThrottle, type ApplyThrottleOutcome } from "~/hh/applyThrottle";

// ---------------------------------------------------------------------------
// collect: итерация по всем активным hh-источникам
// ---------------------------------------------------------------------------

export type CollectStepResult = {
  /** Сколько источников обработано (валідных hh-пар source+profile). */
  sourcesProcessed: number;
  /** Сколько источников пропущено (нет search_profile_id / не hh). */
  sourcesSkipped: number;
  /** Агрегированные stats по всем источникам. */
  aggregated: {
    collected: number;
    matched: number;
    rejected: number;
    duplicates: number;
    captcha: boolean;
  };
  /** Ошибка на конкретном источнике (continue-on-error: идём дальше). */
  errors: string[];
};

/**
 * Запустить сбор по всем активным источникам kind='hh'.
 *
 * Для каждого берёт search_profile_id из source.config, вызывает collectVacancies.
 * Continue-on-error: один упавший источник не роняет весь шаг.
 * Источники без search_profile_id пропускаются (sourcesSkipped).
 */
export async function runCollect(): Promise<CollectStepResult> {
  const all = sourcesRepo.list();
  const hhSources = all.filter((s) => s.kind === "hh");

  const result: CollectStepResult = {
    sourcesProcessed: 0,
    sourcesSkipped: 0,
    aggregated: { collected: 0, matched: 0, rejected: 0, duplicates: 0, captcha: false },
    errors: [],
  };

  for (const source of hhSources) {
    const profileId = source.config?.search_profile_id;
    if (typeof profileId !== "number") {
      result.sourcesSkipped += 1;
      continue;
    }
    const profile = searchProfilesRepo.findById(profileId);
    if (!profile) {
      result.sourcesSkipped += 1;
      result.errors.push(
        `source ${source.id}: search_profile_id=${profileId} не найден`,
      );
      continue;
    }

    try {
      const stats: CollectStats = await collectVacancies({
        sourceId: source.id,
        profileId,
      });
      result.sourcesProcessed += 1;
      result.aggregated.collected += stats.collected;
      result.aggregated.matched += stats.matched;
      result.aggregated.rejected += stats.rejected;
      result.aggregated.duplicates += stats.duplicates;
      if (stats.captcha) result.aggregated.captcha = true;
    } catch (err) {
      result.errors.push(
        `source ${source.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// match
// ---------------------------------------------------------------------------

export type MatchStepResult = MatchAllStats;

/** Запустить matcher по всем подходящим вакансиям. */
export async function runMatch(): Promise<MatchStepResult> {
  return matchAll({});
}

// ---------------------------------------------------------------------------
// generate_draft
// ---------------------------------------------------------------------------

export type DraftStepInput = { minScore?: number };
export type DraftStepResult = Awaited<ReturnType<typeof generateDraftsAll>>;

/** Сгенерировать письма для всех подходящих applications. */
export async function runGenerateDrafts(
  input: DraftStepInput = {},
): Promise<DraftStepResult> {
  return generateDraftsAll({ minScore: input.minScore });
}

// ---------------------------------------------------------------------------
// apply (через throttle)
// ---------------------------------------------------------------------------

export type ApplyStepOutcome = ApplyThrottleOutcome;

/**
 * Исполнить apply через throttle (jitter + cycle-limit + daily-cap).
 *
 * Возвращает outcome; воркер сам решает:
 *  - applied + result.ok → markDone
 *  - applied + result.ok=false → markFailed (причина в result.reason)
 *  - deferred_to_tomorrow → markDone с особым result + перенос run_after
 *    на startOfNextDay (чтобы не считалось failed — это planned defer).
 *  - cycle_limit_reached → markFailed transiently (повтор в след. poll)
 */
export async function runApply(
  applicationId: number,
  throttle: ApplyThrottle,
): Promise<ApplyStepOutcome> {
  return throttle.apply(applicationId);
}
