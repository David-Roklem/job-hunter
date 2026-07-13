/**
 * Тесты app/browser/session.ts (слой Camoufox).
 *
 * Мокаем модуль "camoufox" и проверяем, что createContext:
 *   - вызывает Camoufox с правильными опциями (data_dir, headless, humanize, geoip, locale)
 *   - инвертирует headed → headless
 *   - бросает, если profileDir не передан
 *
 * Контракт Camoufox: при наличии data_dir возвращает BrowserContext (persistent).
 * Мы не проверяем тип возврата (типы берём из playwright-core в самом модуле) —
 * только аргументы вызова.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Мок Camoufox: перехватываем вызов, сохраняем опции.
const camoufoxMock = vi.fn();
vi.mock("~/browser/camoufox", () => ({
  Camoufox: (opts: unknown) => {
    camoufoxMock(opts);
    // Возвращаем fake-объект (реальный BrowserContext не нужен для этих тестов).
    return Promise.resolve({ __fake: "context", pages: [], close: () => {} });
  },
}));

// Импорт ПОСЛЕ установки мока.
import { createContext } from "~/browser/session";

describe("createContext (Camoufox layer)", () => {
  beforeEach(() => {
    camoufoxMock.mockClear();
  });

  it("вызывает Camoufox с profileDir как data_dir + headed=false → headless=true", async () => {
    await createContext({ profileDir: "/tmp/test-profile" });

    expect(camoufoxMock).toHaveBeenCalledTimes(1);
    const opts = camoufoxMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.data_dir).toBe("/tmp/test-profile");
    expect(opts.headless).toBe(true);
  });

  it("инвертирует headed=true → headless=false (видимый браузер для логина)", async () => {
    await createContext({ profileDir: "/tmp/x", headed: true });

    const opts = camoufoxMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.headless).toBe(false);
  });

  it("передаёт humanize:true (реалистичные движения курсора через BrowserForge)", async () => {
    await createContext({ profileDir: "/tmp/x" });

    const opts = camoufoxMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.humanize).toBe(true);
  });

  it("НЕ передаёт geoip (отключено — баг camoufox@0.1.19: publicIP валится на proxy-handling)", async () => {
    await createContext({ profileDir: "/tmp/x" });

    const opts = camoufoxMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty("geoip");
  });

  it("использует locale ru-RU по умолчанию (hh)", async () => {
    await createContext({ profileDir: "/tmp/x" });

    const opts = camoufoxMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.locale).toBe("ru-RU");
  });

  it("прокидывает переданный locale (например en-US для wellfound)", async () => {
    await createContext({ profileDir: "/tmp/x", locale: "en-US" });

    const opts = camoufoxMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.locale).toBe("en-US");
  });

  it("НЕ передаёт timezone (убрано в фазе camoufox-stealth — geoip берёт на себя)", async () => {
    await createContext({ profileDir: "/tmp/x" });

    const opts = camoufoxMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty("timezone");
    expect(opts).not.toHaveProperty("timezoneId");
  });

  it("бросает Error, если profileDir пуст/не передан", async () => {
    await expect(createContext({ profileDir: "" })).rejects.toThrow(/profileDir обязателен/);
    // @ts-expect-error — намеренно без profileDir
    await expect(createContext({})).rejects.toThrow(/profileDir обязателен/);
  });
});
