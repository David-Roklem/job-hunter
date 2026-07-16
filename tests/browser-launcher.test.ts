/**
 * Тесты app/browser/launcher.ts.
 *
 * vi.hoisted поднимает spawn-мок и fake-child. Эмулируем stdout Camoufox-server'а
 * (строка с wsEndpoint), проверяем парсинг, timeout, cleanup.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  exitCode: number | null;
  killed: boolean;
  kill: (sig?: string) => boolean;
};

const h = vi.hoisted(() => {
  const lastSpawn = { value: null as { cmd: string; args: string[]; opts: unknown } | null };
  const spawnMock = vi.fn();
  const spawnSyncMock = vi.fn(() => ({ status: 0, pid: 999 }));
  return { lastSpawn, spawnMock, spawnSyncMock };
});

// vi.mock без importOriginal: возвращаем ОБА named + default export
// (vitest требует default для ESM-интеропа, даже если не используется).
vi.mock("node:child_process", () => ({
  default: { spawn: (...args: unknown[]) => h.spawnMock(...args) },
  spawn: (...args: unknown[]) => h.spawnMock(...args),
  spawnSync: (...args: unknown[]) => h.spawnSyncMock(...args),
}));

import { launchCamoufoxServer } from "~/browser/launcher";

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 12345;
  child.exitCode = null;
  child.killed = false;
  child.kill = vi.fn((sig?: string) => {
    child.killed = true;
    setTimeout(() => {
      child.exitCode = sig === "SIGKILL" ? 1 : 0;
      child.emit("exit", child.exitCode, null);
    }, 5);
    return true;
  });
  return child;
}

describe("launchCamoufoxServer", () => {
  beforeEach(() => {
    h.spawnMock.mockReset();
    h.spawnSyncMock.mockReset();
    h.spawnSyncMock.mockReturnValue({ status: 0, pid: 999 });
    h.lastSpawn.value = null;
  });

  it("spawn'ит uv run python serve.py с правильными args + cwd=python-bridge", async () => {
    const fakeChild = makeFakeChild();
    h.spawnMock.mockImplementation((cmd: string, args: string[], opts: unknown) => {
      h.lastSpawn.value = { cmd, args, opts };
      return fakeChild;
    });

    const promise = launchCamoufoxServer({ profileDir: "/tmp/x" });

    expect(h.spawnMock).toHaveBeenCalledTimes(1);
    expect(h.lastSpawn.value!.cmd).toBe("uv");
    expect(h.lastSpawn.value!.args).toEqual([
      "run",
      "python",
      "serve.py",
      "--profile",
      "/tmp/x",
      "--locale",
      "en-US",
      "--window",
      "1920x1080",
    ]);
    const opts = h.lastSpawn.value!.opts as { cwd: string };
    expect(opts.cwd).toContain("python-bridge");

    fakeChild.stdout.emit("data", Buffer.from("Launching server...\n"));
    fakeChild.stdout.emit(
      "data",
      Buffer.from("Websocket endpoint: ws://localhost:54321/abc123def\n"),
    );

    const server = await promise;
    expect(server.wsEndpoint).toBe("ws://localhost:54321/abc123def");
  });

  it("прокидывает --headed и --locale когда переданы", async () => {
    const fakeChild = makeFakeChild();
    h.spawnMock.mockImplementation((cmd: string, args: string[], opts: unknown) => {
      h.lastSpawn.value = { cmd, args, opts };
      return fakeChild;
    });

    const promise = launchCamoufoxServer({ profileDir: "/tmp/y", headed: true, locale: "ru-RU" });
    expect(h.lastSpawn.value!.args).toContain("--headed");
    expect(h.lastSpawn.value!.args).toContain("ru-RU");

    fakeChild.stdout.emit("data", Buffer.from("ws://localhost:11111/xyz\n"));
    await promise;
  });

  it("прокидывает --window WxH когда передан", async () => {
    const fakeChild = makeFakeChild();
    h.spawnMock.mockImplementation((cmd: string, args: string[], opts: unknown) => {
      h.lastSpawn.value = { cmd, args, opts };
      return fakeChild;
    });

    const promise = launchCamoufoxServer({
      profileDir: "/tmp/y",
      window: [2560, 1440],
    });
    expect(h.lastSpawn.value!.args).toContain("--window");
    const idx = h.lastSpawn.value!.args.indexOf("--window");
    expect(h.lastSpawn.value!.args[idx + 1]).toBe("2560x1440");

    fakeChild.stdout.emit("data", Buffer.from("ws://localhost:33333/win\n"));
    await promise;
  });

  it("stop() убивает child-процесс (taskkill /T /F на win32, kill на POSIX)", async () => {
    const fakeChild = makeFakeChild();
    h.spawnMock.mockReturnValue(fakeChild);

    const promise = launchCamoufoxServer({ profileDir: "/tmp/x" });
    fakeChild.stdout.emit("data", Buffer.from("ws://localhost:22222/hash\n"));
    const server = await promise;

    await server.stop();

    if (process.platform === "win32") {
      // Windows: killChild использует taskkill /T /F чтобы убить дерево
      // (uv.exe + его внук camoufox.exe). Без /T зомби-camoufox держит lock профиля.
      expect(h.spawnSyncMock).toHaveBeenCalledTimes(1);
      const [cmd, args] = h.spawnSyncMock.mock.calls[0] as [string, string[]];
      expect(cmd).toBe("taskkill");
      expect(args).toContain("/T");
      expect(args).toContain("/F");
      expect(args).toContain("/PID");
      expect(args).toContain(String(fakeChild.pid));
    } else {
      // POSIX: обычный child.kill()
      expect(fakeChild.killed).toBe(true);
    }
  });

  it("rejects если процесс exit'нул до wsEndpoint", async () => {
    const fakeChild = makeFakeChild();
    h.spawnMock.mockReturnValue(fakeChild);

    const promise = launchCamoufoxServer({ profileDir: "/tmp/x" });
    fakeChild.stderr.emit("data", Buffer.from("Python error\n"));
    fakeChild.emit("exit", 1, null);

    await expect(promise).rejects.toThrow(/завершился .* до выдачи wsEndpoint/);
  });

  it("rejects если процесс выдал error event", async () => {
    const fakeChild = makeFakeChild();
    h.spawnMock.mockReturnValue(fakeChild);

    const promise = launchCamoufoxServer({ profileDir: "/tmp/x" });
    fakeChild.emit("error", new Error("ENOENT uv"));

    await expect(promise).rejects.toThrow(/процесс упал|ENOENT/);
  });
});
