/**
 * Тесты ядра воркера планировщика (фаза 12).
 *
 * Стратегия:
 *  - vi.mock("~/scheduler/steps") подменяет runCollect/runMatch/runGenerateDrafts/runApply.
 *  - vi.mock("~/hh/applyThrottle") — ApplyThrottle с no-op sleep.
 *  - in-memory db для jobsRepo/schedulerRunsRepo.
 *
 * Покрывает: цепочка collect→match→generate_draft, apply (applied/ok, ok=false,
 * deferred_to_tomorrow, cycle_limit), idle, continue-on-error.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { schema } from "~/db/schema";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

let currentDb: ReturnType<typeof drizzle>;

vi.mock("~/db", () => ({
  get db() {
    return currentDb;
  },
}));

// --- Mocks шагов --------------------------------------------------------
const runCollectMock = vi.fn();
const runMatchMock = vi.fn();
const runGenerateDraftsMock = vi.fn();
const runApplyMock = vi.fn();

vi.mock("~/scheduler/steps", () => ({
  runCollect: (...a: unknown[]) => runCollectMock(...a),
  runMatch: (...a: unknown[]) => runMatchMock(...a),
  runGenerateDrafts: (...a: unknown[]) => runGenerateDraftsMock(...a),
  runApply: (...a: unknown[]) => runApplyMock(...a),
}));

// --- Mock throttle (no-op sleep) ---------------------------------------
vi.mock("~/hh/applyThrottle", () => ({
  ApplyThrottle: class {
    cycleUsed = 0;
    async apply(applicationId: number) {
      return runApplyMock(applicationId, this);
    }
  },
  startOfNextDay: (now = new Date()) => {
    const n = new Date(now);
    n.setDate(n.getDate() + 1);
    n.setHours(0, 0, 0, 0);
    return n;
  },
}));

const { runWorkerOnce } = await import("~/scheduler/worker");
const { jobsRepo, schedulerRunsRepo } = await import("~/db/repositories");

const noSleep = async () => {};

function makeDb() {
  const db = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: path.join(projectRoot, "drizzle") });
  return db;
}

beforeEach(() => {
  currentDb = makeDb();
  runCollectMock.mockReset();
  runMatchMock.mockReset();
  runGenerateDraftsMock.mockReset();
  runApplyMock.mockReset();
});

describe("worker: idle", () => {
  it("возвращает idle при пустой очереди", async () => {
    const r = await runWorkerOnce({ sleepBetweenSteps: noSleep, stepGapMs: 0 });
    expect(r.kind).toBe("idle");
  });
});

describe("worker: цепочка collect → match → generate_draft", () => {
  it("collect done создаёт run + энкьютит match", async () => {
    runCollectMock.mockResolvedValue({
      sourcesProcessed: 2,
      sourcesSkipped: 0,
      aggregated: { collected: 5, matched: 3, rejected: 1, duplicates: 1, captcha: false },
      errors: [],
    });
    const collect = jobsRepo.enqueue("collect_vacancies", {});

    const r = await runWorkerOnce({ sleepBetweenSteps: noSleep, stepGapMs: 0 });
    expect(r.kind).toBe("done");
    if (r.kind !== "done") return;
    expect(r.nextKind).toBe("match");
    expect(r.job.id).toBe(collect.id);

    // collect → done
    const after = jobsRepo.findById(collect.id);
    expect(after?.status).toBe("done");

    // match в очереди
    const queued = jobsRepo.list({ status: "queued" });
    expect(queued).toHaveLength(1);
    expect(queued[0].kind).toBe("match");

    // run создан со stats
    const done = jobsRepo.findById(collect.id)!;
    const result = JSON.parse(done.result_json!);
    const run = schedulerRunsRepo.findById(result.run_id);
    expect(run).toBeDefined();
    expect(run!.finished_at).toBeNull(); // ещё не финал
  });

  it("match done энкьютит generate_draft и пробрасывает run_id", async () => {
    const runId = schedulerRunsRepo.start();
    runMatchMock.mockResolvedValue({ matched: 4 });
    const match = jobsRepo.enqueue("match", { run_id: runId });

    const r = await runWorkerOnce({ sleepBetweenSteps: noSleep, stepGapMs: 0 });
    expect(r.kind).toBe("done");
    expect(jobsRepo.findById(match.id)?.status).toBe("done");

    const next = jobsRepo.list({ status: "queued" })[0];
    expect(next.kind).toBe("generate_draft");
    const np = jobsRepo.readPayload(next);
    expect(np).toEqual({ run_id: runId });
  });

  it("generate_draft done завершает run (finished_at)", async () => {
    const runId = schedulerRunsRepo.start();
    schedulerRunsRepo.mergeStats(runId, { collected: 10 });
    runGenerateDraftsMock.mockResolvedValue({ drafted: 7 });

    const draft = jobsRepo.enqueue("generate_draft", { run_id: runId });
    const r = await runWorkerOnce({ sleepBetweenSteps: noSleep, stepGapMs: 0 });
    expect(r.kind).toBe("done");

    const run = schedulerRunsRepo.findById(runId);
    expect(run?.finished_at).toBeTruthy();
    const stats = JSON.parse(run!.stats_json!);
    expect(stats.collected).toBe(10);
    expect(stats.drafted).toBe(7);
    void draft;
  });

  it("generate_draft НИЧЕГО не энкьютит (тупик цепочки)", async () => {
    const runId = schedulerRunsRepo.start();
    runGenerateDraftsMock.mockResolvedValue({ drafted: 1 });
    jobsRepo.enqueue("generate_draft", { run_id: runId });
    await runWorkerOnce({ sleepBetweenSteps: noSleep, stepGapMs: 0 });
    expect(jobsRepo.list({ status: "queued" })).toHaveLength(0);
  });

  it("ошибка шага → markFailed (continue-on-error), без падения", async () => {
    runCollectMock.mockRejectedValue(new Error("network down"));
    const collect = jobsRepo.enqueue("collect_vacancies", {});

    const r = await runWorkerOnce({ sleepBetweenSteps: noSleep, stepGapMs: 0 });
    expect(r.kind).toBe("failed");
    // markFailed с бэк-оффом → снова queued (т.к. attempts < max_attempts).
    expect(jobsRepo.findById(collect.id)?.status).toBe("queued");
    expect(jobsRepo.findById(collect.id)?.error).toContain("network down");
    // Следующий шаг цепочки (match) НЕ запланирован — упавший collect не вёл далее.
    const queued = jobsRepo.list({ status: "queued" });
    expect(queued).toHaveLength(1);
    expect(queued[0].kind).toBe("collect_vacancies");
    expect(queued[0].run_after.getTime()).toBeGreaterThan(Date.now()); // бэк-офф
  });
});

describe("worker: apply_hh", () => {
  it("applied + result.ok → done, ничего не энкьютит", async () => {
    runApplyMock.mockResolvedValue({
      kind: "applied",
      result: { ok: true, reason: undefined },
    });
    const apply = jobsRepo.enqueue("apply_hh", { application_id: 5 });

    const r = await runWorkerOnce({ sleepBetweenSteps: noSleep, stepGapMs: 0 });
    expect(r.kind).toBe("done");
    expect(jobsRepo.findById(apply.id)?.status).toBe("done");
    expect(jobsRepo.list({ status: "queued" })).toHaveLength(0);
  });

  it("applied + result.ok=false → markFailed", async () => {
    runApplyMock.mockResolvedValue({
      kind: "applied",
      result: { ok: false, reason: "нет маппинга резюме" },
    });
    const apply = jobsRepo.enqueue(
      "apply_hh",
      { application_id: 5 },
      new Date(),
      { maxAttempts: 1 },
    );

    const r = await runWorkerOnce({ sleepBetweenSteps: noSleep, stepGapMs: 0 });
    expect(r.kind).toBe("failed");
    expect(jobsRepo.findById(apply.id)?.status).toBe("failed");
    expect(jobsRepo.findById(apply.id)?.error).toContain("нет маппинга");
  });

  it("deferred_to_tomorrow → markDone + новый apply_job с run_after=startOfNextDay", async () => {
    runApplyMock.mockResolvedValue({
      kind: "deferred_to_tomorrow",
      reason: "достигнут дневной лимит",
    });
    const apply = jobsRepo.enqueue("apply_hh", { application_id: 9 });

    const r = await runWorkerOnce({ sleepBetweenSteps: noSleep, stepGapMs: 0 });
    expect(r.kind).toBe("deferred");

    // Старый job → done (не failed!)
    expect(jobsRepo.findById(apply.id)?.status).toBe("done");
    // Новый apply_job → queued с run_after в будущем (завтра)
    const next = jobsRepo.list({ status: "queued" })[0];
    expect(next).toBeDefined();
    expect(next.kind).toBe("apply_hh");
    const np = jobsRepo.readPayload(next);
    expect(np).toEqual({ application_id: 9 });
    expect(next.run_after.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000);
  });

  it("cycle_limit_reached → markFailed transiently", async () => {
    runApplyMock.mockResolvedValue({
      kind: "cycle_limit_reached",
      reason: "limit hit",
    });
    const apply = jobsRepo.enqueue("apply_hh", { application_id: 1 });

    const r = await runWorkerOnce({ sleepBetweenSteps: noSleep, stepGapMs: 0 });
    expect(r.kind).toBe("failed");
    // markFailed с бэк-оффом → queued (если attempts < max)
    expect(jobsRepo.findById(apply.id)?.status).toBe("queued");
    expect(jobsRepo.findById(apply.id)?.error).toContain("limit hit");
  });
});

describe("worker: end-to-end минимальный", () => {
  it("полная цепочка collect→match→draft за 3 runWorkerOnce", async () => {
    runCollectMock.mockResolvedValue({
      sourcesProcessed: 1,
      sourcesSkipped: 0,
      aggregated: { collected: 3, matched: 3, rejected: 0, duplicates: 0, captcha: false },
      errors: [],
    });
    runMatchMock.mockResolvedValue({ matched: 6 });
    runGenerateDraftsMock.mockResolvedValue({ drafted: 2 });

    jobsRepo.enqueue("collect_vacancies", {});

    const r1 = await runWorkerOnce({ sleepBetweenSteps: noSleep, stepGapMs: 0 });
    const r2 = await runWorkerOnce({ sleepBetweenSteps: noSleep, stepGapMs: 0 });
    const r3 = await runWorkerOnce({ sleepBetweenSteps: noSleep, stepGapMs: 0 });
    const r4 = await runWorkerOnce({ sleepBetweenSteps: noSleep, stepGapMs: 0 });

    expect(r1.kind).toBe("done");
    expect(r2.kind).toBe("done");
    expect(r3.kind).toBe("done");
    expect(r4.kind).toBe("idle"); // очередь пуста

    // Все 3 задачи done, run завершён.
    const dones = jobsRepo.list({ status: "done" });
    expect(dones).toHaveLength(3);
    const runs = schedulerRunsRepo.list();
    expect(runs).toHaveLength(1);
    expect(runs[0].finished_at).toBeTruthy();
  });
});
