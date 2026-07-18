/**
 * Тесты applyThrottle (фаза 12): jitter + cycle-limit + daily-cap.
 *
 * vi.mock("~/hh/apply") подменяет submitApplication — никакого playwright.
 * vi.mock("~/db/repositories") подменяет jobsRepo.countApplyToday.
 * sleep инъектируется (no-op) — без реальных таймеров.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const submitMock = vi.fn();
const countApplyTodayMock = vi.fn(() => 0);

vi.mock("~/hh/apply", () => ({
  submitApplication: (opts: { applicationId: number }) => submitMock(opts),
}));
vi.mock("~/db/repositories", () => ({
  jobsRepo: {
    get countApplyToday() {
      return countApplyTodayMock;
    },
  },
}));

const { ApplyThrottle, configFromEnv, startOfNextDay } = await import(
  "~/hh/applyThrottle"
);

beforeEach(() => {
  submitMock.mockReset();
  countApplyTodayMock.mockReset();
  countApplyTodayMock.mockReturnValue(0);
});

const noSleep = async () => {};
const cfg = (over: Partial<{ maxPerCycle: number; dailyLimit: number }> = {}) => ({
  maxPerCycle: 20,
  dailyLimit: 80,
  jitterMinMs: 0,
  jitterMaxMs: 0,
  ...over,
});

describe("applyThrottle: cycle limit", () => {
  it("применяет до maxPerCycle, дальше отказывает", async () => {
    const t = new ApplyThrottle(cfg({ maxPerCycle: 2 }), noSleep);
    submitMock.mockResolvedValue({ ok: true });
    const r1 = await t.apply(1);
    const r2 = await t.apply(2);
    const r3 = await t.apply(3);
    expect(r1.kind).toBe("applied");
    expect(r2.kind).toBe("applied");
    expect(r3.kind).toBe("cycle_limit_reached");
    expect(submitMock).toHaveBeenCalledTimes(2);
  });
});

describe("applyThrottle: daily cap", () => {
  it("при превышении daily-cap возвращает deferred_to_tomorrow БЕЗ submit", async () => {
    countApplyTodayMock.mockReturnValue(80);
    const t = new ApplyThrottle(cfg({ dailyLimit: 80 }), noSleep);
    const r = await t.apply(1);
    expect(r.kind).toBe("deferred_to_tomorrow");
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("daily-cap проверяется ДО cycle-limit", async () => {
    countApplyTodayMock.mockReturnValue(100);
    const t = new ApplyThrottle(
      cfg({ dailyLimit: 80, maxPerCycle: 0 }),
      noSleep,
    );
    const r = await t.apply(1);
    expect(r.kind).toBe("deferred_to_tomorrow");
  });
});

describe("applyThrottle: jitter + submit", () => {
  it("вызывает submit с правильным applicationId после sleep", async () => {
    const sleepCalls: number[] = [];
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };
    submitMock.mockResolvedValue({ ok: true, reason: undefined });
    const t = new ApplyThrottle(
      { maxPerCycle: 5, dailyLimit: 80, jitterMinMs: 100, jitterMaxMs: 200 },
      sleep,
    );
    const r = await t.apply(42);
    expect(r.kind).toBe("applied");
    expect(submitMock).toHaveBeenCalledWith({ applicationId: 42 });
    expect(sleepCalls).toHaveLength(1);
    expect(sleepCalls[0]).toBeGreaterThanOrEqual(100);
    expect(sleepCalls[0]).toBeLessThanOrEqual(200);
  });

  it("прокидывает ok=false от submit без повторных попыток", async () => {
    submitMock.mockResolvedValue({ ok: false, reason: "нет маппинга" });
    const t = new ApplyThrottle(cfg(), noSleep);
    const r = await t.apply(1);
    expect(r.kind).toBe("applied");
    if (r.kind === "applied") {
      expect(r.result.ok).toBe(false);
    }
    // cycleUsed инкрементирован даже при ok=false — submit был.
    expect(t.cycleUsed).toBe(1);
  });
});

describe("applyThrottle: configFromEnv", () => {
  it("читает env с дефолтами", () => {
    const c = configFromEnv({});
    expect(c.maxPerCycle).toBe(20);
    expect(c.dailyLimit).toBe(80);
    expect(c.jitterMinMs).toBe(15_000);
    expect(c.jitterMaxMs).toBe(60_000);
  });

  it("переопределяется env", () => {
    const c = configFromEnv({
      HH_MAX_PER_CYCLE: "5",
      HH_DAILY_LIMIT: "10",
      HH_JITTER_MIN: "1000",
      HH_JITTER_MAX: "2000",
    });
    expect(c.maxPerCycle).toBe(5);
    expect(c.dailyLimit).toBe(10);
    expect(c.jitterMinMs).toBe(1000);
    expect(c.jitterMaxMs).toBe(2000);
  });

  it("невалидный env → дефолт", () => {
    const c = configFromEnv({ HH_MAX_PER_CYCLE: "not-a-number" });
    expect(c.maxPerCycle).toBe(20);
  });
});

describe("applyThrottle: startOfNextDay", () => {
  it("возвращает полуночь следующего дня", () => {
    const now = new Date("2026-07-18T14:30:00.000Z");
    // Локальная полуночь — сверяем через локальный компонент даты.
    const next = startOfNextDay(now);
    expect(next.getDate()).toBe(now.getDate() + 1);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
    expect(next.getSeconds()).toBe(0);
  });
});
