/**
 * Тесты инбокса review-ui (фаза 10) — loaders/actions routes напрямую.
 *
 * In-memory SQLite + vi.mock zai (для regenerate). Проверяем:
 *  - listWithLetter: фильтр «есть cover_letter», relations, сортировка
 *  - applications._index loader/action (approve/reject/regenerate/404/400)
 *  - applications.$id.edit loader (404) / action (save валидация / approve)
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

// Мок zai (для regenerate action).
const chatMock = vi.fn();
vi.mock("~/ai/providers/zai", () => ({
  zai: { chat: (...args: unknown[]) => chatMock(...args) },
}));

const { listWithLetter } = await import("~/db/repositories/applications");
const { action: indexAction, loader: indexLoader } = await import(
  "~/routes/applications._index"
);
const {
  loader: editLoader,
  action: editAction,
} = await import("~/routes/applications.$id.edit");
const {
  sourcesRepo,
  vacanciesRepo,
  applicationsRepo,
  resumeTemplatesRepo,
  coverLettersRepo,
  jobsRepo,
} = await import("~/db/repositories");

/** Создаёт полный граф. letter=true → создаёт cover_letter. */
async function seed(opts: { letter?: boolean; status?: string; score?: number | null } = {}) {
  const s = sourcesRepo.create({ kind: "hh", name: "hh", config: {} });
  const v = vacanciesRepo.create({
    source_id: s.id,
    external_id: `e${Math.random().toString(36).slice(2)}`,
    title: "Senior Backend",
    description: "Node.js dev",
    url: "u",
    raw: {},
    collected_at: new Date(),
  });
  const r = resumeTemplatesRepo.create({
    name: "A",
    role: "Backend Developer",
    summary: "",
    skills: ["Node.js"],
    experience: [],
    content_md: "",
  });
  const a = applicationsRepo.create({
    vacancy_id: v.id,
    resume_template_id: r.id,
    match_score: opts.score === undefined ? 70 : opts.score,
    status: (opts.status ?? "draft") as "draft",
  });
  if (opts.letter) {
    coverLettersRepo.upsert({
      application_id: a.id,
      body_md: "исходное письмо",
      ai_provider: "zai",
      model: "glm-5.2",
    });
  }
  return a.id;
}

function jsonForm(intent: string, id: number, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("intent", intent);
  fd.append("id", String(id));
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  // urlencoded — обходит boundary-баг undici в vitest (см. verify drafts).
  const body = new URLSearchParams();
  body.set("intent", intent);
  body.set("id", String(id));
  for (const [k, v] of Object.entries(extra)) body.set(k, v);
  return new Request("http://x/applications", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

describe("listWithLetter", () => {
  beforeEach(() => {
    currentDb = makeDb();
    chatMock.mockReset();
  });

  it("фильтрует applications без cover_letter, тянет relations", async () => {
    const withLetter = await seed({ letter: true });
    const withoutLetter = await seed({ letter: false });

    const rows = await listWithLetter();

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(withLetter);
    expect(rows[0].cover_letter).toBeDefined();
    expect(rows[0].cover_letter?.body_md).toBe("исходное письмо");
    expect(rows[0].vacancy).toBeDefined();
    expect(rows[0].resume_template).toBeDefined();
    expect(rows[0].vacancy.company).toBeNull(); // company не создавали
    expect(withoutLetter).not.toContain(
      rows.map((r) => r.id).includes(withoutLetter) ? -1 : withoutLetter,
    );
  });

  it("сортировка: свежее письмо сверху (generated_at desc)", async () => {
    const old = await seed({ letter: true });
    // generated_at хранится в секундах (timestamp). Спим >1с для гарантированной
    // разницы между двумя письмами, иначе порядок не определён.
    await new Promise((r) => setTimeout(r, 1100));
    const recent = await seed({ letter: true });

    const rows = await listWithLetter();

    expect(rows[0].id).toBe(recent);
    expect(rows[1].id).toBe(old);
  });
});

describe("applications._index loader + action", () => {
  beforeEach(() => {
    currentDb = makeDb();
    chatMock.mockReset();
  });

  it("loader возвращает только applications с cover_letter", async () => {
    const withLetter = await seed({ letter: true });
    await seed({ letter: false });

    const data = await indexLoader({} as never);

    expect(data.applications).toHaveLength(1);
    expect(data.applications[0].id).toBe(withLetter);
  });

  it("action approve → application.status='approved' + enqueue apply_job", async () => {
    const id = await seed({ letter: true });
    const res = await indexAction({ request: jsonForm("approve", id) } as never);
    expect(res).toBeInstanceOf(Response); // redirect
    const app = await applicationsRepo.findById(id);
    expect(app?.status).toBe("approved");
    // Фаза 12: approve энкьютит apply_job для scheduler.
    const queued = jobsRepo.list({ status: "queued" });
    expect(queued).toHaveLength(1);
    expect(queued[0].kind).toBe("apply_hh");
    const payload = JSON.parse(queued[0].payload_json);
    expect(payload).toEqual({ application_id: id });
  });

  it("action reject → application.status='rejected' (БЕЗ apply_job)", async () => {
    const id = await seed({ letter: true });
    await indexAction({ request: jsonForm("reject", id) } as never);
    const app = await applicationsRepo.findById(id);
    expect(app?.status).toBe("rejected");
    expect(jobsRepo.list({ status: "queued" })).toHaveLength(0);
  });

  it("action regenerate → cover_letter.body_md обновлён (AI вызван)", async () => {
    const id = await seed({ letter: true });
    chatMock.mockResolvedValueOnce({
      content: "новое письмо от AI",
      model: "glm-5.2",
      provider: "zai",
    });
    await indexAction({ request: jsonForm("regenerate", id) } as never);
    expect(chatMock).toHaveBeenCalledTimes(1);
    const letter = coverLettersRepo.findByApplicationId(id);
    expect(letter?.body_md).toBe("новое письмо от AI");
  });

  it("action по несуществующему id → throw 404", async () => {
    await expect(
      indexAction({ request: jsonForm("approve", 999) } as never),
    ).rejects.toThrow();
  });

  it("action без id → throw 400", async () => {
    await expect(
      indexAction({ request: jsonForm("approve", NaN) } as never),
    ).rejects.toThrow();
  });
});

describe("applications.$id.edit loader + action", () => {
  beforeEach(() => {
    currentDb = makeDb();
    chatMock.mockReset();
  });

  it("loader возвращает application с cover_letter", async () => {
    const id = await seed({ letter: true });
    const data = await editLoader({ params: { id: String(id) } } as never);
    expect(data.app.id).toBe(id);
    expect(data.app.cover_letter).toBeDefined();
  });

  it("loader по несуществующему id → throw 404", async () => {
    await expect(
      editLoader({ params: { id: "999" } } as never),
    ).rejects.toThrow();
  });

  it("loader по application без письма → throw 404", async () => {
    const id = await seed({ letter: false });
    await expect(
      editLoader({ params: { id: String(id) } } as never),
    ).rejects.toThrow();
  });

  it("action save → coverLettersRepo.updateBody вызван, body обновлён", async () => {
    const id = await seed({ letter: true });
    await editAction({
      params: { id: String(id) },
      request: jsonForm("save", id, { body_md: "отредактированное письмо" }),
    } as never);
    const letter = coverLettersRepo.findByApplicationId(id);
    expect(letter?.body_md).toBe("отредактированное письмо");
    expect(letter?.edited_at).not.toBeNull(); // updateBody ставит edited_at
  });

  it("action save с пустым body → возвращает errors, БД не тронута", async () => {
    const id = await seed({ letter: true });
    const res = (await editAction({
      params: { id: String(id) },
      request: jsonForm("save", id, { body_md: "   " }),
    } as never)) as { values: { body_md: string }; errors: { body_md?: string } };
    expect(res.errors?.body_md).toBeDefined();
    // письмо не изменилось
    expect(coverLettersRepo.findByApplicationId(id)?.body_md).toBe(
      "исходное письмо",
    );
  });

  it("action approve → application.status='approved'", async () => {
    const id = await seed({ letter: true });
    await editAction({
      params: { id: String(id) },
      request: jsonForm("approve", id),
    } as never);
    const app = await applicationsRepo.findById(id);
    expect(app?.status).toBe("approved");
  });
});
