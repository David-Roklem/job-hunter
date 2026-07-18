/**
 * Standalone long-running воркер планировщика (фаза 12).
 *
 * Запуск: npm run scheduler
 *
 * Крутит цикл: poll каждые SCHEDULER_POLL_SEC секунд → runWorkerOnce.
 * SIGINT/SIGTERM → graceful shutdown (между poll-ами, не прерывая шаг).
 *
 * Цикл collect→match→generate_draft запускается энкьютом корневого
 * collect_vacancies вручную или внешним cron (см. README):
 *   - вручную: tsx -e "import '~/db/repositories'; ..." или через UI (todo)
 *   - в этом воркере НЕ делается авто-запуск цикла по расписанию —
 *     пользователь явно энкьютит, чтобы контролировать момент (hh-сессия,
 *     время суток). Только apply добивается в фоне (из approve-action).
 *
 * Env:
 *   SCHEDULER_POLL_SEC  — интервал poll очереди, по умолч. 30.
 *   HH_MAX_PER_CYCLE    — лимит apply за poll (applyThrottle).
 *   HH_DAILY_LIMIT      — суточный лимит apply (applyThrottle).
 *   HH_JITTER_MIN/MAX   — диапазон jitter перед apply, мс.
 */
import { loadEnv } from "./_env";

loadEnv();

const { runWorkerOnce } = await import("../app/scheduler/worker");

const POLL_SEC = Number(process.env.SCHEDULER_POLL_SEC ?? "30");
const POLL_MS = (Number.isFinite(POLL_SEC) && POLL_SEC > 0 ? POLL_SEC : 30) * 1000;

let stopping = false;

function log(msg: string): void {
  console.log(`[scheduler ${new Date().toISOString()}] ${msg}`);
}

async function main(): Promise<void> {
  log(`воркер запущен (poll=${POLL_MS}ms)`);

  // Graceful shutdown.
  const shutdown = (sig: string) => {
    if (stopping) return;
    stopping = true;
    log(`получен ${sig}, завершение после текущей задачи...`);
    // Даём текущей задаче до 5с, затем выходим.
    setTimeout(() => {
      log("остановлен.");
      process.exit(0);
    }, 5_000);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Главный цикл.
  while (!stopping) {
    try {
      const result = await runWorkerOnce();
      if (result.kind === "idle") {
        // Тихо — нет работы.
      } else if (result.kind === "done") {
        log(
          `✓ job #${result.job.id} (${result.job.kind}) done` +
            (result.nextKind ? ` → enqueued ${result.nextKind}` : ""),
        );
      } else if (result.kind === "failed") {
        log(`✗ job #${result.job.id} (${result.job.kind}) failed: ${result.error}`);
      } else if (result.kind === "deferred") {
        log(
          `⏸ job #${result.job.id} (${result.job.kind}) deferred to ${result.runAfter.toISOString()}: ${result.reason}`,
        );
      }
    } catch (err) {
      // Не должно происходить (runWorkerOnce ловит), но на случай беды.
      log(`неожиданная ошибка в цикле: ${err}`);
    }

    if (stopping) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  log("воркер остановлен.");
}

main().catch((err) => {
  console.error("Фатальная ошибка scheduler:", err);
  process.exit(1);
});
