/**
 * Тесты роута / (дашборд, фаза ui-control).
 *
 * In-memory db + прямой вызов loader/action. Проверяем:
 *  - loader: возвращает status/version + counts + lastRun
 *  - action intent=collect_now → enqueue collect_vacancies, redirect на /jobs
 *  - action неизвестный intent → throw 400
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

const { jobsRepo, schedulerRunsRepo } = await import("~/db/repositories");
const { loader: indexLoader, action: indexAction } = await import(
  "~/routes/_index"
);

function formIntent(intent: string): Request {
  const body = new URLSearchParams();
  body.set("intent", intent);
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

beforeEach(() => {
  currentDb = makeDb();
});

describe("_index loader", () => {
  it("возвращает status/version + нулевые counts без lastRun", async () => {
    const data = await indexLoader({} as never);
    expect(data.status).toBe("ok");
    expect(data.version).toBe("0.1.0");
    expect(data.counts.queued).toBe(0);
    expect(data.lastRun).toBeNull();
  });

  it("возвращает counts после enqueue задач", async () => {
    jobsRepo.enqueue("collect_vacancies", {});
    jobsRepo.enqueue("apply_hh", { application_id: 1 });
    const data = await indexLoader({} as never);
    expect(data.counts.queued).toBe(2);
  });

  it("возвращает lastRun после завершённого цикла", async () => {
    const runId = schedulerRunsRepo.start();
    schedulerRunsRepo.mergeStats(runId, { collected: 5, matched_pairs: 3, drafted: 2 });
    // finish перетирает stats_json — передаём агрегированные значения.
    schedulerRunsRepo.finish(
      runId,
      { ...schedulerRunsRepo.emptyStats(), collected: 5, matched_pairs: 3, drafted: 2 },
      {},
    );
    const data = await indexLoader({} as never);
    expect(data.lastRun).not.toBeNull();
    expect(data.lastRun?.id).toBe(runId);
    expect(data.lastRun?.stats.collected).toBe(5);
    expect(data.lastRun?.stats.drafted).toBe(2);
  });
});

describe("_index action", () => {
  it("collect_now → enqueue collect_vacancies + redirect на /jobs", async () => {
    const res = await indexAction({ request: formIntent("collect_now") } as never);
    expect(res).toBeInstanceOf(Response);
    const resp = res as Response;
    expect(resp.headers.get("Location")).toBe("/jobs");
    // Job в очереди.
    const jobs = jobsRepo.list();
    expect(jobs.some((j) => j.kind === "collect_vacancies")).toBe(true);
  });

  it("неизвестный intent → throw 400", async () => {
    await expect(
      indexAction({ request: formIntent("bogus") } as never),
    ).rejects.toThrow();
  });
});
