/**
 * Менеджер долгоживущих процессов (scheduler, логины источников).
 *
 * Spawn'ит команду как detached-процесс (выживающий после закрытия action-
 * запроса), пишет stdout/stderr в data/logs/<name>.log (append), а метаданные
 * (pid, started_at, cmd) — в data/processes/<name>.json.
 *
 * Статус alive/dead проверяется по PID через process.kill(pid, 0) (бросает
 * ESRCH если процесса нет). Это переживает restart dev-сервера/HMR: pid-файл
 * на диске — источник истины, а не server-state в памяти RR7.
 *
 * Windows-нюанс: `npm` = `npm.cmd`, поэтому spawn через `shell: true` + команда
 * как строка ("npm run scheduler"). Detached + shell на Windows создаёт новую
 * группу процесса; stop = process.kill(pid, 'SIGTERM').
 *
 * Согласовано с temp-files rule: всё под data/ (project-scoped, НЕ /tmp).
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Директория pid-файлов: data/processes/. Создаётся лениво. */
function processesDir(): string {
  const dir = path.join(process.cwd(), "data", "processes");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Директория логов: data/logs/. Создаётся лениво. */
function logsDir(): string {
  const dir = path.join(process.cwd(), "data", "logs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Путь pid-файла для имени процесса. */
function pidFile(name: string): string {
  return path.join(processesDir(), `${name}.json`);
}

/** Путь лог-файла для имени процесса. */
export function logFile(name: string): string {
  return path.join(logsDir(), `${name}.log`);
}

/** Метаданные запущенного процесса (сериализуются в pid-файл). */
export type ProcessMeta = {
  name: string;
  pid: number;
  started_at: string; // ISO
  cmd: string;
  args: string[];
};

/** Результат start: либо ok с мета, либо ошибка (например, уже запущен). */
export type StartResult =
  | { ok: true; meta: ProcessMeta }
  | { ok: false; error: string };

/** Результат stop. ok:false если процесс уже умер или pid-файла нет. */
export type StopResult =
  | { ok: true; pid: number }
  | { ok: false; error: string };

/** Статус процесса для UI. */
export type ProcessStatus = {
  running: boolean;
  pid?: number;
  started_at?: string;
  logPath: string;
};

/** Проверить, жив ли процесс по PID (ESRCH = мёртв). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Прочитать pid-файл (если есть). */
function readMeta(name: string): ProcessMeta | undefined {
  const file = pidFile(name);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ProcessMeta;
  } catch {
    return undefined;
  }
}

/**
 * Текущий статус процесса по имени.
 *
 * running вычисляется по isAlive(pid). Если pid-файл есть, но процесс мёртв —
 * возвращается running:false (UI покажет «остановлен»); pid-файл НЕ чистится
 * автоматически (оставляет след для дебага; чистится при следующем start).
 */
export function statusManaged(name: string): ProcessStatus {
  const meta = readMeta(name);
  const logPath = logFile(name);
  if (!meta) return { running: false, logPath };
  return {
    running: isAlive(meta.pid),
    pid: meta.pid,
    started_at: meta.started_at,
    logPath,
  };
}

/**
 * Запустить процесс по имени.
 *
 * cmd — полная командная строка (например, "npm run scheduler"); spawn'ится
 * через shell:true для совместимости с Windows (npm.cmd). Stdout+stderr
 * аппендятся в data/logs/<name>.log. Detached:true — процесс переживает
 * родительский node (dev-сервер); unref() чтобы не блокировать выход.
 *
 * Если процесс с таким именем уже жив — отказ (ok:false). Если pid-файл есть,
 * но процесс мёртв — перезапускаем (чистим устаревший файл).
 */
export function startManaged(name: string, cmd: string, args: string[] = []): StartResult {
  const existing = readMeta(name);
  if (existing && isAlive(existing.pid)) {
    return {
      ok: false,
      error: `процесс «${name}» уже запущен (pid=${existing.pid})`,
    };
  }

  const fullCmd = args.length > 0 ? `${cmd} ${args.join(" ")}` : cmd;
  const logPath = logFile(name);

  // Shell-редирект stdout+stderr в лог-файл (append). Detached+unref — процесс
  // живёт после закрытия action-запроса и переживает restart dev-сервера.
  // shell:true обязателен на Windows (npm = npm.cmd).
  const redirectCmd = `${fullCmd} >> "${logPath}" 2>&1`;

  let child: ChildProcess;
  try {
    child = spawn(redirectCmd, [], {
      cwd: process.cwd(),
      shell: true,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, JOB_HUNTER_MANAGED: name },
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (child.pid === undefined) {
    return { ok: false, error: "spawn (redirect) не вернул pid" };
  }

  const meta: ProcessMeta = {
    name,
    pid: child.pid,
    started_at: new Date().toISOString(),
    cmd,
    args,
  };
  writeFileSync(pidFile(name), JSON.stringify(meta, null, 2), "utf8");

  // Отвязываем от родителя — процесс живёт самостоятельно.
  child.unref();

  return { ok: true, meta };
}

/**
 * Остановить процесс по имени (SIGTERM).
 *
 * Если pid-файла нет — ok:false. Если процесс уже мёртв — ok:false с пояснением
 * (pid-файл чистится). Иначе — SIGTERM и удаление pid-файла.
 *
 * ВАЖНО: на Windows detached+shell создаёт новую группу; process.kill(pid)
 * убивает shell-обёртку, но НЕ обязательно дочерний процесс (npm → node).
 * Это известное ограничение; для критичных случаев рекомендован встроенный
 * scheduler (out-of-scope этой фазы). Для single-user scheduler-стопа
 * обычно достаточно — npm.cmd проксирует сигнал.
 */
export function stopManaged(name: string): StopResult {
  const meta = readMeta(name);
  if (!meta) {
    return { ok: false, error: `процесс «${name}» не найден (нет pid-файла)` };
  }
  if (!isAlive(meta.pid)) {
    // Чистим устаревший pid-файл.
    try {
      writeFileSync(pidFile(name), "", "utf8");
    } catch {
      // ignore
    }
    return { ok: false, error: `процесс «${name}» уже не работает (pid=${meta.pid} мёртв)` };
  }
  try {
    process.kill(meta.pid, "SIGTERM");
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  // pid-файл не чистим — оставляем запись о последнем запуске для дебага.
  // statusManaged всё равно покажет running:false после смерти.
  return { ok: true, pid: meta.pid };
}

/**
 * Хвост лог-файла (последние N строк) для UI.
 *
 * Возвращает пустую строку, если файла нет. Читает весь файл и берёт хвост —
 * логи короткие (single-user), без stream-API для простоты.
 */
export function readLogTail(name: string, lines = 100): string {
  const file = logFile(name);
  if (!existsSync(file)) return "";
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return "";
  }
  const all = content.split(/\r?\n/).filter((l) => l.length > 0);
  return all.slice(-lines).join("\n");
}

/** Размер лог-файла в байтах (для UI-индикатора «лог растёт»). */
export function logSize(name: string): number {
  const file = logFile(name);
  if (!existsSync(file)) return 0;
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/** Для тестов: напрямую записать pid-файл (имитация запущенного процесса). */
export function __writeMetaForTest(meta: ProcessMeta): void {
  writeFileSync(pidFile(meta.name), JSON.stringify(meta, null, 2), "utf8");
}

/** Для тестов: очистить pid-файл. */
export function __clearMetaForTest(name: string): void {
  const file = pidFile(name);
  if (existsSync(file)) writeFileSync(file, "", "utf8");
}
