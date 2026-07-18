/**
 * CRUD-тесты репозитория jobs (очередь фоновых задач, фаза 12 scheduler).
 *
 * Стратегия та же, что в hh-resume-mapping-repo.test.ts: vi.mock("~/db")
 * подменяет синглтон db на in-memory better-sqlite3 + накат миграций.
 *
 * Покрывает: enqueue/findById/list, claimNext (атомарность + FIFO),
 * markDone/markFailed (бэк-офф + max_attempts), cancel/retry/pause/resume,
 * readPayload (валидация по kind), countByStatus, countApplyToday.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { schema } from "~/db/schema";
import { eq } from "drizzle-orm";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function makeDb() {
  const db = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: path.join(projectRoot, "drizzle") });
  return db;
}

let currentDb: ReturnType<typeof makeDb>;

vi.mock("~/db", () => ({
  get db() {
    return currentDb;
  },
}));

const {
  enqueue,
  findById,
  list,
  claimNext,
  markDone,
  markFailed,
  cancel,
  retry,
  pause,
  resume,
  readPayload,
  countByStatus,
  countApplyToday,
} = await import("~/db/repositories/jobs");

beforeEach(() => {
  currentDb = makeDb();
});

describe("jobs repo: enqueue/findById/list", () => {
  it("enqueue ставит queued с payload_json и дефолтным run_after=now", () => {
    const beforeSec = Math.floor(Date.now() / 1000);
    const job = enqueue("apply_hh", { application_id: 42 });
    expect(job.kind).toBe("apply_hh");
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);
    expect(job.max_attempts).toBe(3);
    expect(job.payload_json).toBe(JSON.stringify({ application_id: 42 }));
    // mode:"timestamp" хранит секунды (без мс) — сверяем до секунд.
    expect(Math.floor(job.run_after.getTime() / 1000)).toBeGreaterThanOrEqual(beforeSec);

    const found = findById(job.id);
    expect(found?.id).toBe(job.id);
  });

  it("enqueue принимает кастомный run_after и maxAttempts", () => {
    // timestamp-mode обрезает мс — используем целые секунды.
    const future = new Date(Math.floor(Date.now() / 1000) * 1000 + 60_000);
    const job = enqueue(
      "match",
      { run_id: 1 },
      future,
      { maxAttempts: 5 },
    );
    expect(job.run_after).toEqual(future);
    expect(job.max_attempts).toBe(5);
  });

  it("list возвращает по статусу/лимиту", () => {
    enqueue("apply_hh", { application_id: 1 });
    enqueue("apply_hh", { application_id: 2 });
    enqueue("match", { run_id: 1 });

    expect(list().length).toBe(3);
    expect(list({ status: "apply_hh" as never }).length).toBe(0); // apply_hh не статус
    expect(list({ status: "queued" }).length).toBe(3);
    expect(list({ limit: 2 }).length).toBe(2);
  });
});

describe("jobs repo: claimNext", () => {
  it("возвращает undefined при пустой очереди", () => {
    expect(claimNext()).toBeUndefined();
  });

  it("не берёт задачу с run_after > now", () => {
    enqueue("match", { run_id: 1 }, new Date(Date.now() + 120_000));
    expect(claimNext()).toBeUndefined();
  });

  it("берёт задачу с run_after <= now и переводит в running", () => {
    const job = enqueue("match", { run_id: 1 });
    const claimed = claimNext();
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.locked_at).toBeTruthy();
  });

  it("FIFO: первая по run_after берётся раньше", () => {
    // Обе готовы (run_after <= now), но first раньше later.
    const later = enqueue("match", { run_id: 1 }, new Date(Date.now() - 60_000));
    const first = enqueue("match", { run_id: 2 }, new Date(Date.now() - 120_000));
    expect(claimNext()?.id).toBe(first.id);
    expect(claimNext()?.id).toBe(later.id);
  });

  it("не берёт уже running/done (только queued)", () => {
    const job = enqueue("match", { run_id: 1 });
    claimNext(); // → running
    expect(claimNext()).toBeUndefined(); // больше queued нет
    void job;
  });
});

describe("jobs repo: markDone / markFailed", () => {
  it("markDone пишет result_json и finished_at", () => {
    const job = enqueue("match", { run_id: 1 });
    claimNext();
    markDone(job.id, { pairs: 10 });
    const after = findById(job.id);
    expect(after?.status).toBe("done");
    expect(after?.result_json).toBe(JSON.stringify({ pairs: 10 }));
    expect(after?.finished_at).toBeTruthy();
    expect(after?.error).toBeNull();
  });

  it("markFailed до max_attempts → queued + бэк-офф", () => {
    const job = enqueue("match", { run_id: 1 });
    claimNext(); // attempts=1
    const status = markFailed(job.id, "всё сломалось");
    expect(status).toBe("queued");
    const after = findById(job.id);
    expect(after?.status).toBe("queued");
    expect(after?.error).toContain("всё сломалось");
    // 2^1 минут = 60_000мс минимум (timestamp-mode секунды — сверяем грубо).
    expect(Math.floor(after!.run_after.getTime() / 1000)).toBeGreaterThanOrEqual(
      Math.floor((Date.now() + 60_000) / 1000) - 5,
    );
  });

  it("markFailed при attempts>=max_attempts → failed окончательно", () => {
    const job = enqueue("match", { run_id: 1 }, new Date(), { maxAttempts: 1 });
    claimNext(); // attempts=1 = max
    const status = markFailed(job.id, "финал");
    expect(status).toBe("failed");
    expect(findById(job.id)?.status).toBe("failed");
  });
});

describe("jobs repo: cancel/retry/pause/resume", () => {
  it("cancel → cancelled", () => {
    const job = enqueue("apply_hh", { application_id: 1 });
    cancel(job.id);
    expect(findById(job.id)?.status).toBe("cancelled");
  });

  it("retry сбрасывает attempts и ставит queued с run_after=now", () => {
    const job = enqueue("match", { run_id: 1 }, new Date(), { maxAttempts: 1 });
    claimNext();
    markFailed(job.id, "x"); // → failed
    retry(job.id);
    const after = findById(job.id);
    expect(after?.status).toBe("queued");
    expect(after?.attempts).toBe(0);
    expect(after?.error).toBeNull();
  });

  it("pause = cancel, resume = retry", () => {
    const job = enqueue("apply_hh", { application_id: 1 });
    pause(job.id);
    expect(findById(job.id)?.status).toBe("cancelled");
    resume(job.id);
    expect(findById(job.id)?.status).toBe("queued");
  });
});

describe("jobs repo: readPayload", () => {
  it("десериализует apply_hh payload", () => {
    const job = enqueue("apply_hh", { application_id: 7 });
    const p = readPayload(job);
    expect(p).toEqual({ application_id: 7 });
  });

  it("десериализует match payload", () => {
    const job = enqueue("match", { run_id: 99 });
    expect(readPayload(job)).toEqual({ run_id: 99 });
  });

  it("бросает на невалидном payload (strict)", () => {
    // Запишем напрямую кривой payload, обойдя валидацию enqueue.
    const job = enqueue("match", { run_id: 1 });
    currentDb
      .update(schema.jobs)
      .set({ payload_json: JSON.stringify({ run_id: 1, extra: "nope" }) })
      .where(eq(schema.jobs.id, job.id))
      .run();
    expect(() => readPayload(findById(job.id)!)).toThrow();
  });
});

describe("jobs repo: countByStatus / countApplyToday", () => {
  it("countByStatus считает по статусам", () => {
    enqueue("match", { run_id: 1 });
    enqueue("match", { run_id: 2 });
    const apply = enqueue("apply_hh", { application_id: 1 });
    // simulate worker: claim → markDone на одной задаче
    const claimed = claimNext()!;
    markDone(claimed.id, {});
    const counts = countByStatus();
    expect(counts.queued).toBe(2);
    expect(counts.done).toBe(1);
    expect(counts.running).toBe(0);
    void apply;
  });

  it("countApplyToday считает apply_hh done/running с полуночи", () => {
    // apply_hh создаем первыми — claimNext (FIFO по run_after) возьмёт их.
    const a = enqueue("apply_hh", { application_id: 1 });
    const b = enqueue("apply_hh", { application_id: 2 });
    enqueue("match", { run_id: 1 });

    markDone(claimNext()!.id, {}); // a → done
    claimNext(); // b → running
    markDone(claimNext()!.id, {}); // match → done (не считается)
    void a;

    expect(countApplyToday()).toBe(2);
  });
});
