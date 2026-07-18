/**
 * Тесты менеджера процессов (app/processes/manager.ts).
 *
 * spawn замокан полностью — мы тестируем ОРКЕСТРОВКУ (pid-файлы, статусы,
 * логи, защита от двойного запуска), а не реальный subprocess. Реальный smoke
 * (start scheduler/login из UI) — ручная проверка на машине разработчика;
 * spawn+detached+unref на vitest-worker'e ломает IPC-канал родителя
 * (ERR_IPC_CHANNEL_CLOSED), поэтому изолируем.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Мокаем spawn ДО импорта manager — мы тестируем ОРКЕСТРОВКУ (pid-файлы, статусы,
// логи, защита от двойного запуска), а не реальный subprocess. Реальный smoke
// (start scheduler/login из UI) — ручная проверка на машине разработчика.
const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  default: { spawn: (...args: unknown[]) => mockSpawn(...args) },
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Изолируем файловые операции во временный каталог (согласовано с temp-files
// rule: os.tmpdir() + project-scoped). OneDrive блокирует rmSync логов в репо.
// Monkey-patch process.cwd() вместо chdir — chdir ломает друние импорты (db).
const TMP_CWD = path.join(os.tmpdir(), `job_hunter-procmgr-${process.pid}`);
const realCwd = process.cwd.bind(process);
let tmpReady = false;

beforeEach(() => {
  mkdirSync(TMP_CWD, { recursive: true });
  tmpReady = false;
  process.cwd = () => {
    if (!tmpReady) {
      tmpReady = true;
      mkdirSync(path.join(TMP_CWD, "data", "processes"), { recursive: true });
      mkdirSync(path.join(TMP_CWD, "data", "logs"), { recursive: true });
    }
    return TMP_CWD;
  };
  mockSpawn.mockReset();
});
afterEach(() => {
  process.cwd = realCwd;
  try {
    rmSync(TMP_CWD, { recursive: true, force: true });
  } catch {
    // OneDrive/Windows может держать хэндл — игнорируем, OS temp почистит.
  }
});

const {
  startManaged,
  stopManaged,
  statusManaged,
  readLogTail,
  logSize,
  logFile,
  __writeMetaForTest,
} = await import("~/processes/manager");

const TEST_NAME = "test-proc";

/** Фейковый ChildProcess с заданным pid. */
function fakeChild(pid: number): { pid: number; unref: () => void; kill: () => void } {
  return {
    pid,
    unref: vi.fn(),
    kill: vi.fn(),
  };
}

describe("processes/manager statusManaged", () => {
  it("нет pid-файла → running:false", () => {
    const st = statusManaged(TEST_NAME);
    expect(st.running).toBe(false);
    expect(st.pid).toBeUndefined();
  });

  it("pid-файл с мёртвым pid → running:false (ESRCH)", () => {
    __writeMetaForTest({
      name: TEST_NAME,
      pid: 999999, // почти наверняка не существует
      started_at: new Date().toISOString(),
      cmd: "echo",
      args: [],
    });
    const st = statusManaged(TEST_NAME);
    expect(st.running).toBe(false);
  });

  it("pid-файл с живым pid (текущий процесс) → running:true", () => {
    __writeMetaForTest({
      name: TEST_NAME,
      pid: process.pid,
      started_at: new Date().toISOString(),
      cmd: "node",
      args: [],
    });
    const st = statusManaged(TEST_NAME);
    expect(st.running).toBe(true);
    expect(st.pid).toBe(process.pid);
  });
});

describe("processes/manager startManaged", () => {
  it("spawn'ит процесс, пишет pid-файл, вызывает unref", () => {
    mockSpawn.mockReturnValue(fakeChild(12345));
    const res = startManaged(TEST_NAME, "npm", ["run", "scheduler"]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.meta.pid).toBe(12345);
    expect(mockSpawn).toHaveBeenCalledOnce();
    // pid-файл должен существовать и содержать мета.
    const st = statusManaged(TEST_NAME);
    expect(st.pid).toBe(12345);
    expect(st.started_at).toBeDefined();
    // 12345 мёртв в реальности (spawn замокан) → running:false. Это ожидаемо:
    // statusManaged проверяет жив ли pid через process.kill(pid,0).
    expect(st.running).toBe(false);
  });

  it("повторный start при живом pid → ok:false «уже запущен»", () => {
    // Первый start: текущий процесс жив → второй откажет.
    mockSpawn.mockReturnValue(fakeChild(process.pid));
    startManaged(TEST_NAME, "npm", ["run", "scheduler"]);
    // Перезапишем мета на текущий pid, чтобы isAlive дал true.
    __writeMetaForTest({
      name: TEST_NAME,
      pid: process.pid,
      started_at: new Date().toISOString(),
      cmd: "npm",
      args: ["run", "scheduler"],
    });
    const second = startManaged(TEST_NAME, "npm", ["run", "scheduler"]);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toContain("уже запущен");
    expect(mockSpawn).toHaveBeenCalledOnce(); // второй spawn не вызывался.
  });

  it("spawn без pid → ok:false", () => {
    mockSpawn.mockReturnValue({ pid: undefined, unref: vi.fn(), kill: vi.fn() });
    const res = startManaged(TEST_NAME, "bogus", []);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("не вернул pid");
  });

  it("spawn бросает → ok:false с сообщением", () => {
    mockSpawn.mockImplementation(() => {
      throw new Error("EPERM");
    });
    const res = startManaged(TEST_NAME, "bogus", []);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("EPERM");
  });
});

describe("processes/manager stopManaged", () => {
  it("stop без pid-файла → ok:false", () => {
    const res = stopManaged(TEST_NAME);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("не найден");
  });

  it("stop с мёртвым pid → ok:false (уже не работает)", () => {
    __writeMetaForTest({
      name: TEST_NAME,
      pid: 999999,
      started_at: new Date().toISOString(),
      cmd: "x",
      args: [],
    });
    const res = stopManaged(TEST_NAME);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("уже не работает");
  });

  it("stop живого pid (process.kill текущего не делаем — мокаем isAlive через дочерний)", () => {
    // Нельзя убивать текущий процесс (process.pid) — тест умрёт.
    // Поэтому проверяем только код-путь: stop с pid-файлом, где isAlive=true,
    // имитируем записью СВОЕГО pid, но перехватываем process.kill через vi.spyOn.
    __writeMetaForTest({
      name: TEST_NAME,
      pid: process.pid,
      started_at: new Date().toISOString(),
      cmd: "node",
      args: [],
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const res = stopManaged(TEST_NAME);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.pid).toBe(process.pid);
    expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");
    killSpy.mockRestore();
  });
});

describe("processes/manager logs", () => {
  it("readLogTail: нет файла → пустая строка", () => {
    expect(readLogTail(TEST_NAME)).toBe("");
  });

  it("readLogTail: хвост N строк", () => {
    const dir = path.join(process.cwd(), "data", "logs");
    mkdirSync(dir, { recursive: true });
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    writeFileSync(logFile(TEST_NAME), lines + "\n", "utf8");
    expect(readLogTail(TEST_NAME, 3)).toBe("line 7\nline 8\nline 9");
  });

  it("logSize: размер файла в байтах", () => {
    const dir = path.join(process.cwd(), "data", "logs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(logFile(TEST_NAME), "hello", "utf8");
    expect(logSize(TEST_NAME)).toBe(5);
  });
});
