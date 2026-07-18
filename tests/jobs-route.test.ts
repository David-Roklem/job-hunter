/**
 * Тесты роута /jobs (фаза 12 scheduler UI).
 *
 * In-memory db + прямой вызов loader/action. Проверяем:
 *  - loader: возвращает список + counts
 *  - action pause/resume/retry/cancel → статус меняется
 *  - 404 на несуществующем id, 400 на неизвестном intent
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

const { jobsRepo } = await import("~/db/repositories");
const { loader: jobsLoader, action: jobsAction } = await import(
  "~/routes/jobs._index"
);

function jsonForm(intent: string, id: number): Request {
  // urlencoded — обходит boundary-баг undici в vitest (см. review-ui.test).
  const body = new URLSearchParams();
  body.set("intent", intent);
  body.set("id", String(id));
  return new Request("http://localhost/jobs", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

beforeEach(() => {
  currentDb = makeDb();
});

describe("jobs._index loader", () => {
  it("возвращает пустой список + нулевые counts", async () => {
    const data = await jobsLoader({} as never);
    expect(data.jobs).toHaveLength(0);
    expect(data.counts.queued).toBe(0);
    expect(data.counts.done).toBe(0);
  });

  it("возвращает список и counts с разными статусами", async () => {
    const a = jobsRepo.enqueue("match", { run_id: 1 });
    const b = jobsRepo.enqueue("apply_hh", { application_id: 1 });
    jobsRepo.cancel(b.id);
    jobsRepo.markDone(a.id, { x: 1 });

    const data = await jobsLoader({} as never);
    expect(data.jobs).toHaveLength(2);
    expect(data.counts.done).toBe(1);
    expect(data.counts.cancelled).toBe(1);
  });
});

describe("jobs._index action", () => {
  it("pause queued → cancelled", async () => {
    const j = jobsRepo.enqueue("apply_hh", { application_id: 1 });
    await jobsAction({ request: jsonForm("pause", j.id) } as never);
    expect(jobsRepo.findById(j.id)?.status).toBe("cancelled");
  });

  it("retry failed → queued + attempts=0", async () => {
    const j = jobsRepo.enqueue("match", { run_id: 1 }, new Date(), {
      maxAttempts: 1,
    });
    jobsRepo.claimNext();
    jobsRepo.markFailed(j.id, "x"); // → failed (attempts=max)
    expect(jobsRepo.findById(j.id)?.status).toBe("failed");

    await jobsAction({ request: jsonForm("retry", j.id) } as never);
    const after = jobsRepo.findById(j.id);
    expect(after?.status).toBe("queued");
    expect(after?.attempts).toBe(0);
  });

  it("resume cancelled → queued", async () => {
    const j = jobsRepo.enqueue("apply_hh", { application_id: 1 });
    jobsRepo.cancel(j.id);
    await jobsAction({ request: jsonForm("resume", j.id) } as never);
    expect(jobsRepo.findById(j.id)?.status).toBe("queued");
  });

  it("cancel running → cancelled", async () => {
    const j = jobsRepo.enqueue("match", { run_id: 1 });
    jobsRepo.claimNext();
    await jobsAction({ request: jsonForm("cancel", j.id) } as never);
    expect(jobsRepo.findById(j.id)?.status).toBe("cancelled");
  });

  it("несуществующий id → throw 404", async () => {
    await expect(
      jobsAction({ request: jsonForm("retry", 999) } as never),
    ).rejects.toThrow();
  });

  it("неверный id (NaN) → throw 400", async () => {
    await expect(
      jobsAction({ request: jsonForm("retry", NaN) } as never),
    ).rejects.toThrow();
  });

  it("неизвестный intent → throw 400", async () => {
    const j = jobsRepo.enqueue("match", { run_id: 1 });
    await expect(
      jobsAction({ request: jsonForm("bogus", j.id) } as never),
    ).rejects.toThrow();
  });
});
