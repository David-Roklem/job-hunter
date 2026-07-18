/**
 * Троттлинг apply к hh.ru (фаза 12 scheduler).
 *
 * Три уровня защиты от бана:
 *  1. **Jitter** — случайная пауза 15–60с перед каждым submit (правдоподобное
 *     поведение человека; hh банит за всплески).
 *  2. **Max-per-cycle** — не более HH_MAX_PER_CYCLE apply за один poll воркера
 *     (по умолч. 20). In-memory счётчик, сбрасывается на новой итерации.
 *  3. **Daily cap** — не более HH_DAILY_LIMIT apply за текущие сутки (по умолч.
 *     80). Считается через jobsRepo.countApplyToday (done/running с полуночи).
 *
 * При превышении daily-cap apply_job остаётся в очереди с run_after = начало
 * следующего дня (обрабатывается воркером: он откладывает, а не маркирует failed).
 *
 * Все лимиты — из env, переопределяемы. sleep() инъектируется для тестов
 * (vi.useFakeTimers).
 */
import { submitApplication, type SubmitResult } from "~/hh/apply";
import { jobsRepo } from "~/db/repositories";

/** Диапазон jitter-задержки перед submit, мс. */
export const JITTER_MS: readonly [number, number] = [15_000, 60_000];

export type ApplyThrottleConfig = {
  /** Максимум apply за один poll воркера. Env HH_MAX_PER_CYCLE, по умолч. 20. */
  maxPerCycle: number;
  /** Суточный лимит apply. Env HH_DAILY_LIMIT, по умолч. 80. */
  dailyLimit: number;
  /** Минимальная пауза перед submit, мс. Env HH_JITTER_MIN, по умолч. 15000. */
  jitterMinMs: number;
  /** Максимальная пауза перед submit, мс. Env HH_JITTER_MAX, по умолч. 60000. */
  jitterMaxMs: number;
};

/** Читает конфиг из env с дефолтами. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ApplyThrottleConfig {
  const num = (key: string, def: number) => {
    const v = env[key];
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : def;
  };
  return {
    maxPerCycle: num("HH_MAX_PER_CYCLE", 20),
    dailyLimit: num("HH_DAILY_LIMIT", 80),
    jitterMinMs: num("HH_JITTER_MIN", JITTER_MS[0]),
    jitterMaxMs: num("HH_JITTER_MAX", JITTER_MS[1]),
  };
}

/** Случайная задержка в диапазоне [min, max], мс. */
export function randJitterMs(cfg: ApplyThrottleConfig): number {
  const lo = Math.min(cfg.jitterMinMs, cfg.jitterMaxMs);
  const hi = Math.max(cfg.jitterMinMs, cfg.jitterMaxMs);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/**
 * Начало следующих суток (локальная полуночь завтра).
 *
 * Применяется при превышении daily-cap: apply_job получает run_after = эта
 * метка, остаётся queued, исполняется на следующий день.
 */
export function startOfNextDay(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

export type ApplyThrottleOutcome =
  | { kind: "applied"; result: SubmitResult }
  | { kind: "deferred_to_tomorrow"; reason: string }
  | { kind: "cycle_limit_reached"; reason: string };

/**
 * Состояние троттлера на один poll воркера.
 *
 * Создаётся в начале каждой итерации цикла воркера (см. worker.ts).
 * cycleUsed инкрементируется при каждом реальном submit.
 */
export class ApplyThrottle {
  /** Сколько apply уже сделано в текущем poll-цикле. */
  cycleUsed = 0;
  /** sleep-функция (для подмены в тестах). */
  readonly sleep: (ms: number) => Promise<void>;
  readonly config: ApplyThrottleConfig;

  constructor(
    config: ApplyThrottleConfig = configFromEnv(),
    sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {
    this.config = config;
    this.sleep = sleep;
  }

  /**
   * Применить apply с троттлингом.
   *
   * Порядок проверок (важен): daily-cap → cycle-limit → jitter → submit.
   * Возвращает outcome без бросания; воркер сам решает, что делать
   * (deferred_to_tomorrow → markDone с особым result / перенос run_after).
   */
  async apply(applicationId: number): Promise<ApplyThrottleOutcome> {
    // 1. Daily cap — считаем done/running с полуночи.
    const usedToday = jobsRepo.countApplyToday();
    if (usedToday >= this.config.dailyLimit) {
      return {
        kind: "deferred_to_tomorrow",
        reason: `достигнут дневной лимит apply (${usedToday}/${this.config.dailyLimit})`,
      };
    }

    // 2. Cycle cap.
    if (this.cycleUsed >= this.config.maxPerCycle) {
      return {
        kind: "cycle_limit_reached",
        reason: `достигнут лимит apply за цикл (${this.cycleUsed}/${this.config.maxPerCycle})`,
      };
    }

    // 3. Jitter.
    const wait = randJitterMs(this.config);
    await this.sleep(wait);

    // 4. Submit.
    const result = await submitApplication({ applicationId });
    this.cycleUsed += 1;
    return { kind: "applied", result };
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
