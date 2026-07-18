/**
 * Тесты роута /settings (фаза ui-control + cover-letter-profile).
 *
 * In-memory db (для userProfileRepo) + мок env.server (стаб значений) +
 * мок envFile (не трогаем реальный .env). Проверяем:
 *  - loader: возвращает ключи env + userProfile
 *  - action save (env) → writeEnvFile вызывается
 *  - action save_profile → userProfileRepo.upsert вызывается
 *  - секретное поле пустое + keep=1 → не обновляется
 *  - неизвестный intent → throw 400
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

// Мок env.server ДО импорта роута.
const envStub = {
  ZAI_API_KEY: "secret-key",
  ZAI_MODEL: "glm-5.2",
  ZAI_BASE_URL: "https://api.z.ai/api/coding/paas/v4",
  YANDEX_GPT_API_KEY: undefined,
  TG_API_ID: 12345,
  TG_API_HASH: "hash",
  TG_SESSION: "",
  SCHEDULER_POLL_SEC: undefined,
  HH_MAX_PER_CYCLE: undefined,
  HH_DAILY_LIMIT: undefined,
  HH_JITTER_MIN: undefined,
  HH_JITTER_MAX: undefined,
  DATABASE_URL: "./data/test.sqlite",
  NODE_ENV: "test" as const,
};
vi.mock("~/env.server", () => ({
  env: envStub,
}));

// Мок envFile.
const envFileMocks = {
  readEnvFile: vi.fn(() => ({ path: "/tmp/.env", exists: true, values: {} })),
  writeEnvFile: vi.fn(),
};
vi.mock("~/settings/envFile", () => ({
  default: envFileMocks,
  readEnvFile: envFileMocks.readEnvFile,
  writeEnvFile: envFileMocks.writeEnvFile,
}));

const { userProfileRepo } = await import("~/db/repositories");
const { loader: settingsLoader, action: settingsAction } = await import(
  "~/routes/settings._index"
);

function formSave(fields: Record<string, string>): Request {
  const body = new URLSearchParams();
  body.set("intent", "save");
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("http://localhost/settings", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

function formSaveProfile(fields: Record<string, string>): Request {
  const body = new URLSearchParams();
  body.set("intent", "save_profile");
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("http://localhost/settings", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

beforeEach(() => {
  currentDb = makeDb();
  envFileMocks.readEnvFile.mockReset();
  envFileMocks.writeEnvFile.mockReset();
  envFileMocks.readEnvFile.mockReturnValue({ path: "/tmp/.env", exists: true, values: {} });
});

describe("settings._index loader", () => {
  it("возвращает все ключи из белого списка + userProfile=null", async () => {
    const data = await settingsLoader({} as never);
    expect(data.keys.length).toBeGreaterThan(5);
    expect(data.envPath).toBe("/tmp/.env");
    expect(data.userProfile).toBeNull();
  });

  it("секреты отдаются без value, только is_set", async () => {
    const data = await settingsLoader({} as never);
    const secret = data.keys.find((k) => k.key === "ZAI_API_KEY");
    expect(secret?.is_secret).toBe(true);
    expect(secret?.value).toBeNull();
    expect(secret?.is_set).toBe(true);
  });

  it("несекретное значение отдаётся", async () => {
    const data = await settingsLoader({} as never);
    const model = data.keys.find((k) => k.key === "ZAI_MODEL");
    expect(model?.is_secret).toBe(false);
    expect(model?.value).toBe("glm-5.2");
  });

  it("возвращает userProfile после upsert", async () => {
    userProfileRepo.upsert({ name: "Test User" });
    const data = await settingsLoader({} as never);
    expect(data.userProfile).not.toBeNull();
    expect(data.userProfile?.name).toBe("Test User");
  });
});

describe("settings._index action — save (env)", () => {
  it("несекретное поле сохраняется", async () => {
    await settingsAction({
      request: formSave({ env_ZAI_MODEL: "glm-6" }),
    } as never);
    expect(envFileMocks.writeEnvFile).toHaveBeenCalledOnce();
    const arg = envFileMocks.writeEnvFile.mock.calls[0][0];
    expect(arg.ZAI_MODEL).toBe("glm-6");
  });

  it("секретное поле с новым значением сохраняется", async () => {
    await settingsAction({
      request: formSave({ env_ZAI_API_KEY: "new-secret" }),
    } as never);
    const arg = envFileMocks.writeEnvFile.mock.calls[0][0];
    expect(arg.ZAI_API_KEY).toBe("new-secret");
  });

  it("секретное поле пустое + keep=1 → НЕ обновляется", async () => {
    await settingsAction({
      request: formSave({ env_ZAI_API_KEY: "", keep_ZAI_API_KEY: "1" }),
    } as never);
    const arg = envFileMocks.writeEnvFile.mock.calls[0][0];
    expect(arg.ZAI_API_KEY).toBeUndefined();
  });

  it("возвращает ok + warning о рестарте", async () => {
    const res = await settingsAction({
      request: formSave({ env_ZAI_MODEL: "glm-6" }),
    } as never);
    expect(res).toEqual({
      ok: true,
      warning: expect.stringContaining("Перезапустите"),
    });
  });

  it("writeEnvFile бросает → throw 500", async () => {
    envFileMocks.writeEnvFile.mockImplementation(() => {
      throw new Error("disk full");
    });
    await expect(
      settingsAction({ request: formSave({ env_ZAI_MODEL: "x" }) } as never),
    ).rejects.toThrow();
  });
});

describe("settings._index action — save_profile", () => {
  it("создаёт профиль через userProfileRepo.upsert", async () => {
    const res = await settingsAction({
      request: formSaveProfile({
        profile_name: "Иван Иванов",
        profile_telegram: "@ivan",
        profile_email: "ivan@example.com",
      }),
    } as never);
    expect(res).toEqual({
      ok: true,
      warning: expect.stringContaining("Профиль сохранён"),
    });
    const profile = userProfileRepo.get();
    expect(profile?.name).toBe("Иван Иванов");
    expect(profile?.contacts.telegram).toBe("@ivan");
    expect(profile?.contacts.email).toBe("ivan@example.com");
  });

  it("пустые контакты → undefined (не пустые строки)", async () => {
    await settingsAction({
      request: formSaveProfile({ profile_name: "Test" }),
    } as never);
    const profile = userProfileRepo.get();
    expect(profile?.contacts.telegram).toBeUndefined();
    expect(profile?.contacts.email).toBeUndefined();
  });

  it("сигнатура сохраняется", async () => {
    await settingsAction({
      request: formSaveProfile({
        profile_name: "Test",
        profile_signature: "С уважением, Test",
      }),
    } as never);
    expect(userProfileRepo.get()?.signature_md).toBe("С уважением, Test");
  });

  it("пустое имя → throw 400", async () => {
    await expect(
      settingsAction({
        request: formSaveProfile({ profile_name: "" }),
      } as never),
    ).rejects.toThrow();
  });

  it("upsert обновляет существующий профиль", async () => {
    userProfileRepo.upsert({ name: "Старое" });
    await settingsAction({
      request: formSaveProfile({ profile_name: "Новое" }),
    } as never);
    expect(userProfileRepo.get()?.name).toBe("Новое");
  });
});

describe("settings._index action — unknown intent", () => {
  it("throw 400", async () => {
    const body = new URLSearchParams();
    body.set("intent", "bogus");
    await expect(
      settingsAction({
        request: new Request("http://localhost/settings", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        }),
      } as never),
    ).rejects.toThrow();
  });
});
