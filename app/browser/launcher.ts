/**
 * Node-side launcher: spawn Python-Camoufox-server, дождаться wsEndpoint,
 * отдать его для firefox.connect(). Управляет жизненным циклом Python-процесса.
 *
 * Архитектура CDP/Playwright-server bridge:
 *   1. spawn `uv run python python-bridge/serve.py --profile ... --headed ...`
 *   2. читать stdout, ждать строку с wsEndpoint (паттерн ws://localhost:PORT/HASH)
 *   3. вернуть { wsEndpoint, stop }
 *   4. stop() — kill Python-процесса (+ дочерние camoufox.exe)
 *
 * spawn-on-demand: новый процесс на каждый запуск сбора/логина. Между запусками
 * ресурсов не жрёт. Профиль (куки/localStorage) персистится в data_dir (Python-side),
 * так что повторные логины не нужны.
 *
 * ВАЖНО: cwd = python-bridge/ (camoufox's launchServer.js — CJS, и без нейтрального
 * package.json в этой директории он «заражается» корневым type:module и валится).
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/** Паттерн wsEndpoint в stdout Camoufox-server. */
const WS_ENDPOINT_REGEX = /ws:\/\/localhost:\d+\/[a-z0-9]+/i;

/** Максимальное ожидание запуска сервера (мс). Браузер + GeoIP могут быть медленными. */
const SERVER_START_TIMEOUT_MS = 60_000;

export type LaunchOptions = {
  /** Директория персистентного профиля (пробрасывается в Camoufox data_dir). */
  profileDir: string;
  /** true → видимый браузер (для ручного логина). Дефолт false (headless). */
  headed?: boolean;
  /** locale браузера. Дефолт "en-US". */
  locale?: string;
};

export type LaunchedServer = {
  /** WebSocket endpoint для firefox.connect(). */
  wsEndpoint: string;
  /** Остановить Python-сервер (kill процесса + дочерних). Безопасно вызывать многократно. */
  stop: () => Promise<void>;
};

/**
 * Запустить Python-Camoufox-server и дождаться wsEndpoint.
 *
 * @throws Error если uv не найден, сервер не стартовал за timeout, или процесс упал.
 */
export function launchCamoufoxServer(
  opts: LaunchOptions,
): Promise<LaunchedServer> {
  return new Promise((resolve, reject) => {
    const bridgeDir = path.join(process.cwd(), "python-bridge");
    const args = [
      "run",
      "python",
      "serve.py",
      "--profile",
      opts.profileDir,
      "--locale",
      opts.locale ?? "en-US",
    ];
    if (opts.headed) args.push("--headed");

    let child: ChildProcess;
    try {
      // Без shell:true — с shell args не экранируются, и пути с пробелами/
      // кириллицей (Рабочий стол) разбиваются/ломают кодировку. uv должен быть в PATH.
      child = spawn("uv", args, {
        cwd: bridgeDir,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e) {
      reject(
        new Error(
          `launchCamoufoxServer: не удалось spawn'нуть uv. Установлен ли uv? (${e instanceof Error ? e.message : String(e)})`,
        ),
      );
      return;
    }

    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void killChild(child);
      reject(
        new Error(
          `launchCamoufoxServer: сервер не отдал wsEndpoint за ${SERVER_START_TIMEOUT_MS}ms. stderr: ${stderrBuf.slice(-500)}`,
        ),
      );
    }, SERVER_START_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const match = stdoutBuf.match(WS_ENDPOINT_REGEX);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        const wsEndpoint = match[0];
        resolve({
          wsEndpoint,
          stop: () => killChild(child),
        });
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      // stderr не валидация — только для диагностики при ошибке.
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`launchCamoufoxServer: процесс упал: ${err.message}`));
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `launchCamoufoxServer: Python-сервер завершился (code=${code}) до выдачи wsEndpoint. stderr: ${stderrBuf.slice(-500)}`,
        ),
      );
    });
  });
}

/** Безопасно убить дочерний процесс (с попыткой graceful, затем force). */
async function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  try {
    // graceful: SIGTERM (на Windows = TerminateProcess, но пробуем).
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGKILL");
    }
  } catch {
    // best-effort
  }
}
