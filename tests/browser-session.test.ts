/**
 * Тесты app/browser/session.ts (Python-bridge архитектура).
 *
 * vi.hoisted поднимает fake-объекты выше vi.mock-фабрик (vitest hoisting).
 * Мокаем:
 *   - "~/browser/launcher" → launchCamoufoxServer возвращает fake { wsEndpoint, stop }
 *   - "playwright" → firefox.connect возвращает fake Browser с контекстом
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- hoisted fakes (переживают vi.mock hoisting) ---------------------

const fakes = vi.hoisted(() => {
  const fakeStop = vi.fn(async () => {});
  const launchCamoufoxServerMock = vi.fn();
  const fakeContextClose = vi.fn(async () => {});
  const fakeContext = {
    close: fakeContextClose,
    newPage: vi.fn(async () => ({})),
  };
  const contextsFn = vi.fn(() => [fakeContext]);
  const newContextFn = vi.fn(async () => fakeContext);
  const fakeBrowser = {
    contexts: contextsFn,
    newContext: newContextFn,
    close: vi.fn(async () => {}),
  };
  const connectMock = vi.fn(async () => fakeBrowser);
  return {
    fakeStop,
    launchCamoufoxServerMock,
    fakeContextClose,
    fakeContext,
    contextsFn,
    newContextFn,
    fakeBrowser,
    connectMock,
  };
});

vi.mock("~/browser/launcher", () => ({
  launchCamoufoxServer: (opts: unknown) => fakes.launchCamoufoxServerMock(opts),
}));
vi.mock("playwright", () => ({
  firefox: { connect: (ws: unknown) => fakes.connectMock(ws) },
}));

import { createContext } from "~/browser/session";

describe("createContext (Python-bridge)", () => {
  beforeEach(() => {
    fakes.launchCamoufoxServerMock.mockReset();
    fakes.connectMock.mockReset();
    fakes.fakeStop.mockReset();
    fakes.fakeContextClose.mockReset();
    fakes.newContextFn.mockReset();

    // defaults
    fakes.launchCamoufoxServerMock.mockResolvedValue({
      wsEndpoint: "ws://localhost:99999/fakehash",
      stop: fakes.fakeStop,
    });
    fakes.connectMock.mockResolvedValue(fakes.fakeBrowser);
    fakes.contextsFn.mockReturnValue([fakes.fakeContext]);

    // ВАЖНО: session.ts мутирует fakeContext.close (оборачивает).
    // Восстанавливать оригинал перед каждым тестом, иначе обёртки накапливаются.
    fakes.fakeContext.close = fakes.fakeContextClose;
  });

  it("передаёт profileDir/headed/locale в launchCamoufoxServer", async () => {
    await createContext({ profileDir: "/tmp/x", headed: true, locale: "en-US" });

    expect(fakes.launchCamoufoxServerMock).toHaveBeenCalledTimes(1);
    const opts = fakes.launchCamoufoxServerMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.profileDir).toBe("/tmp/x");
    expect(opts.headed).toBe(true);
    expect(opts.locale).toBe("en-US");
  });

  it("дефолт headed=false (falsy), locale=ru-RU (hh)", async () => {
    await createContext({ profileDir: "/tmp/x" });

    const opts = fakes.launchCamoufoxServerMock.mock.calls[0][0] as { headed?: boolean; locale?: string };
    expect(opts.headed).toBeFalsy(); // undefined или false — оба headless
    expect(opts.locale).toBe("ru-RU");
  });

  it("вызывает firefox.connect с wsEndpoint от launcher", async () => {
    await createContext({ profileDir: "/tmp/x" });

    expect(fakes.connectMock).toHaveBeenCalledTimes(1);
    expect(fakes.connectMock.mock.calls[0][0]).toBe("ws://localhost:99999/fakehash");
  });

  it("возвращает существующий context из browser.contexts()", async () => {
    const ctx = await createContext({ profileDir: "/tmp/x" });
    expect(ctx).toBe(fakes.fakeContext);
    expect(fakes.newContextFn).not.toHaveBeenCalled();
  });

  it("создаёт новый context, если browser.contexts() пуст", async () => {
    fakes.contextsFn.mockReturnValue([]);
    await createContext({ profileDir: "/tmp/x" });
    expect(fakes.newContextFn).toHaveBeenCalledTimes(1);
  });

  it("бросает Error, если profileDir пуст", async () => {
    await expect(createContext({ profileDir: "" })).rejects.toThrow(/profileDir обязателен/);
    expect(fakes.launchCamoufoxServerMock).not.toHaveBeenCalled();
  });

  it("вызывает launcher.stop() и пробрасывает ошибку, если firefox.connect упал", async () => {
    fakes.connectMock.mockRejectedValueOnce(new Error("connection refused"));

    await expect(createContext({ profileDir: "/tmp/x" })).rejects.toThrow(/firefox.connect failed/);
    expect(fakes.fakeStop).toHaveBeenCalledTimes(1);
  });

  it("context.close() также вызывает launcher.stop() (cleanup)", async () => {
    const callsBefore = fakes.fakeStop.mock.calls.length;
    const closeCallsBefore = fakes.fakeContextClose.mock.calls.length;
    const ctx = await createContext({ profileDir: "/tmp/x" });
    await ctx.close();
    // close() вызвал original close + stop ровно по разу с момента снапшота.
    expect(fakes.fakeContextClose.mock.calls.length).toBe(closeCallsBefore + 1);
    expect(fakes.fakeStop.mock.calls.length).toBe(callsBefore + 1);
  });
});
