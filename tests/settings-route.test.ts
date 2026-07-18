/**
 * Тесты роута /settings (фаза ui-control).
 *
 * Мок env.server (стаб значений) + envFile (не трогаем реальный .env).
 * Проверяем:
 *  - loader: возвращает ключи, секреты без value только is_set
 *  - action save → writeEnvFile вызывается с обновлениями
 *  - секретное поле пустое + keep=1 → не обновляется
 *  - неизвестный intent → throw 400
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  envFileMocks.readEnvFile.mockReset();
  envFileMocks.writeEnvFile.mockReset();
  envFileMocks.readEnvFile.mockReturnValue({ path: "/tmp/.env", exists: true, values: {} });
});

describe("settings._index loader", () => {
  it("возвращает все ключи из белого списка", async () => {
    const data = await settingsLoader({} as never);
    expect(data.keys.length).toBeGreaterThan(5);
    expect(data.envPath).toBe("/tmp/.env");
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

  it("несекретное незаполненное — is_set=false, value пустой", async () => {
    const data = await settingsLoader({} as never);
    const poll = data.keys.find((k) => k.key === "SCHEDULER_POLL_SEC");
    expect(poll?.is_set).toBe(false);
    expect(poll?.value).toBe("");
  });
});

describe("settings._index action — save", () => {
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

  it("секретное поле пустое без keep → затирается пустой строкой", async () => {
    await settingsAction({
      request: formSave({ env_ZAI_API_KEY: "" }),
    } as never);
    const arg = envFileMocks.writeEnvFile.mock.calls[0][0];
    expect(arg.ZAI_API_KEY).toBe("");
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
