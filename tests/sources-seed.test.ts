/**
 * Тесты app/sources/seed.ts (фаза ui-control).
 *
 * In-memory db + проверка idempotency. SeehHh/seedWellfound/seedTelegram —
 * чистые функции над repo, тесты создают БД, гоняют seed дважды.
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

const { seedHh, seedWellfound, seedTelegram, seedByKind, SEED_NAMES } = await import(
  "~/sources/seed"
);
const { sourcesRepo, searchProfilesRepo, telegramChannelsRepo } = await import(
  "~/db/repositories"
);

beforeEach(() => {
  currentDb = makeDb();
});

describe("sources/seed seedHh", () => {
  it("создаёт source + profile, возвращает id", () => {
    const res = seedHh();
    expect(res.kind).toBe("hh");
    expect(res.source_id).toBeGreaterThan(0);
    expect(res.profile_id).toBeGreaterThan(0);
    expect(res.created).toBe(true);

    const source = sourcesRepo.findById(res.source_id);
    expect(source?.kind).toBe("hh");
    expect(source?.name).toBe(SEED_NAMES.hh.source);
    // search_profile_id проставлен в config.
    expect(source?.config.search_profile_id).toBe(res.profile_id);
  });

  it("idempotent: повторный вызов не дублирует, created=false", () => {
    const first = seedHh();
    const second = seedHh();
    expect(second.source_id).toBe(first.source_id);
    expect(second.profile_id).toBe(first.profile_id);
    expect(second.created).toBe(false);

    expect(sourcesRepo.list()).toHaveLength(1);
    expect(searchProfilesRepo.list()).toHaveLength(1);
  });
});

describe("sources/seed seedWellfound", () => {
  it("создаёт aggregator source + profile", () => {
    const res = seedWellfound();
    expect(res.kind).toBe("wellfound");
    const source = sourcesRepo.findById(res.source_id);
    expect(source?.kind).toBe("aggregator");
    expect(source?.name).toBe(SEED_NAMES.wellfound.source);
  });

  it("idempotent", () => {
    seedWellfound();
    const before = sourcesRepo.list().length;
    seedWellfound();
    expect(sourcesRepo.list()).toHaveLength(before);
  });
});

describe("sources/seed seedTelegram", () => {
  it("создаёт telegram source + profile + каналы по умолчанию", () => {
    const res = seedTelegram();
    expect(res.kind).toBe("telegram");
    expect(res.channels_added).toBeGreaterThan(0);

    const source = sourcesRepo.findById(res.source_id);
    expect(source?.kind).toBe("telegram");
    // Каналы привязаны к source.
    const channels = telegramChannelsRepo.list({ sourceId: res.source_id });
    expect(channels.length).toBeGreaterThan(0);
  });

  it("idempotent: каналы не дублируются", () => {
    const first = seedTelegram();
    const second = seedTelegram();
    expect(second.source_id).toBe(first.source_id);
    expect(second.channels_added).toBe(0); // все уже есть
    expect(second.created).toBe(false);
  });

  it("кастомный список каналов", () => {
    const res = seedTelegram([{ username: "custom_chan", title: "Custom" }]);
    expect(res.channels_added).toBe(1);
    const ch = telegramChannelsRepo.findByUsername("custom_chan");
    expect(ch).toBeDefined();
  });
});

describe("sources/seed seedByKind", () => {
  it("hh → seedHh", () => {
    const res = seedByKind("hh");
    expect(res.kind).toBe("hh");
  });

  it("aggregator → seedWellfound", () => {
    const res = seedByKind("aggregator");
    expect(res.kind).toBe("wellfound");
  });

  it("telegram → seedTelegram", () => {
    const res = seedByKind("telegram");
    expect(res.kind).toBe("telegram");
  });

  it("company → бросает (нет дефолта)", () => {
    expect(() => seedByKind("company")).toThrow(/не реализован/);
  });
});
