/**
 * Тесты роута /sources (фаза ui-control).
 *
 * In-memory db + мок processes/manager и ~/sources/sessionStatus (后者 читает
 * файлы/env — изолируем). Проверяем:
 *  - loader: возвращает sources + seedableKinds
 *  - action seed → создаёт source+profile, redirect
 *  - action login → startManaged вызывается с правильным именем процесса
 *  - action collect → enqueue collect_vacancies, redirect на /jobs
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

// Мок processes/manager (spawn не запускаем).
const managerMocks = {
  startManaged: vi.fn(),
  stopManaged: vi.fn(),
  statusManaged: vi.fn(() => ({ running: false, logPath: "/tmp/x.log" })),
  readLogTail: vi.fn(() => ""),
  logSize: vi.fn(() => 0),
};
vi.mock("~/processes/manager", () => ({
  default: managerMocks,
  ...managerMocks,
}));

// Мок sessionStatus (читает файлы/env — стабим).
vi.mock("~/sources/sessionStatus", () => ({
  sessionStatusByKind: (kind: string) => ({
    loggedIn: false,
    lastSeen: null,
    hint: `mock-${kind}`,
  }),
}));

const { sourcesRepo, jobsRepo } = await import("~/db/repositories");
const { loader: sourcesLoader, action: sourcesAction } = await import(
  "~/routes/sources._index"
);

function formIntent(intent: string, extra: Record<string, string> = {}): Request {
  const body = new URLSearchParams();
  body.set("intent", intent);
  for (const [k, v] of Object.entries(extra)) body.set(k, v);
  return new Request("http://localhost/sources", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

beforeEach(() => {
  currentDb = makeDb();
  managerMocks.startManaged.mockReset();
  managerMocks.startManaged.mockReturnValue({
    ok: true,
    meta: { name: "x", pid: 123, started_at: "x", cmd: "npm", args: [] },
  });
});

describe("sources._index loader", () => {
  it("пустая БД → пустой список + все seedableKinds не seeded", async () => {
    const data = await sourcesLoader({} as never);
    expect(data.sources).toHaveLength(0);
    expect(data.seedableKinds.every((k) => !k.seeded)).toBe(true);
    expect(data.seedableKinds.map((k) => k.kind)).toEqual([
      "hh",
      "aggregator",
      "telegram",
    ]);
  });

  it("после seed hh → source в списке, hh.seeded=true", async () => {
    await sourcesAction({ request: formIntent("seed", { kind: "hh" }) } as never);
    const data = await sourcesLoader({} as never);
    expect(data.sources).toHaveLength(1);
    expect(data.sources[0].kind).toBe("hh");
    const hh = data.seedableKinds.find((k) => k.kind === "hh");
    expect(hh?.seeded).toBe(true);
  });
});

describe("sources._index action — seed", () => {
  it("seed hh → создаёт source+profile, redirect", async () => {
    const res = await sourcesAction({
      request: formIntent("seed", { kind: "hh" }),
    } as never);
    expect(res).toBeInstanceOf(Response);
    const hh = sourcesRepo.list().find((s) => s.kind === "hh");
    expect(hh).toBeDefined();
  });

  it("seed telegram → создаёт source + каналы", async () => {
    await sourcesAction({
      request: formIntent("seed", { kind: "telegram" }),
    } as never);
    const tg = sourcesRepo.list().find((s) => s.kind === "telegram");
    expect(tg).toBeDefined();
  });

  it("seed company → throw 500 (нет дефолта)", async () => {
    await expect(
      sourcesAction({ request: formIntent("seed", { kind: "company" }) } as never),
    ).rejects.toThrow();
  });
});

describe("sources._index action — login", () => {
  it("login hh → startManaged с именем hh-login, скрипт hh:login", async () => {
    await sourcesAction({
      request: formIntent("login", { kind: "hh" }),
    } as never);
    expect(managerMocks.startManaged).toHaveBeenCalledWith("hh-login", "npm", [
      "run",
      "hh:login",
    ]);
  });

  it("login aggregator → wellfound-login, wellfound:login", async () => {
    await sourcesAction({
      request: formIntent("login", { kind: "aggregator" }),
    } as never);
    expect(managerMocks.startManaged).toHaveBeenCalledWith(
      "aggregator-login",
      "npm",
      ["run", "wellfound:login"],
    );
  });

  it("login telegram → telegram-login, telegram:login", async () => {
    await sourcesAction({
      request: formIntent("login", { kind: "telegram" }),
    } as never);
    expect(managerMocks.startManaged).toHaveBeenCalledWith(
      "telegram-login",
      "npm",
      ["run", "telegram:login"],
    );
  });

  it("login company → throw 400 (нет логина)", async () => {
    await expect(
      sourcesAction({ request: formIntent("login", { kind: "company" }) } as never),
    ).rejects.toThrow();
  });

  it("login при уже запущенном → throw 409", async () => {
    managerMocks.startManaged.mockReturnValue({ ok: false, error: "уже запущен" });
    await expect(
      sourcesAction({ request: formIntent("login", { kind: "hh" }) } as never),
    ).rejects.toThrow();
  });
});

describe("sources._index action — collect", () => {
  it("collect → enqueue collect_vacancies + redirect на /jobs", async () => {
    const res = await sourcesAction({
      request: formIntent("collect"),
    } as never);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).headers.get("Location")).toBe("/jobs");
    const jobs = jobsRepo.list();
    expect(jobs.some((j) => j.kind === "collect_vacancies")).toBe(true);
  });
});

describe("sources._index action — unknown intent", () => {
  it("throw 400", async () => {
    await expect(
      sourcesAction({ request: formIntent("bogus") } as never),
    ).rejects.toThrow();
  });
});
