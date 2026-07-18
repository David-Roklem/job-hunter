/**
 * Smoke-планировщика (фаза 12) — БЕЗ автотестовой инфраструктуры.
 *
 * Запуск: npm run smoke:scheduler
 *
 * Проверяет БД-инварианты очереди и связывание цепочки НА ПУСТЫХ репозиториях
 * (без вызова длинных оркестраторов collect/match/draft — для них есть свои
 * smoke'ы: smoke-hh-session, smoke-zai, smoke-drafts, smoke-match).
 *
 * Что проверяет:
 *  1. jobs.enqueue → findById → claimNext → markDone (атомарный захват)
 *  2. scheduler_runs.start → mergeStats → finish (полный lifecycle)
 *  3. pause/resume/retry/cancel
 *  4. countByStatus / countApplyToday
 *  5. Ручное моделирование цепочки (как это делает worker.dispatch):
 *     collect-done → enqueue match → match-done → enqueue draft → draft-done
 *     + scheduler_runs.finish.
 *
 * Для запуска РЕАЛЬНОГО цикла (с playwright/z.ai) используйте:
 *   npm run scheduler  (после hh:login и настройки env)
 */
import { loadEnv } from "./_env";

loadEnv();

const { jobsRepo, schedulerRunsRepo } = await import("../app/db/repositories");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ASSERT FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

async function main(): Promise<void> {
  console.log("=== scheduler smoke (DB-layer invariants) ===\n");

  // Идемпотентность: очистить jobs/scheduler_runs от прошлых прогонов.
  for (const job of jobsRepo.list()) jobsRepo.cancel(job.id);
  console.log("(очистил очередь от прошлых прогонов)\n");

  // 1. Lifecycle одной задачи.
  console.log("1) jobs lifecycle: enqueue → claimNext → markDone");
  const j = jobsRepo.enqueue("apply_hh", { application_id: 42 });
  assert(j.status === "queued", "enqueue → queued");
  const claimed = jobsRepo.claimNext();
  assert(claimed?.id === j.id && claimed.status === "running", "claimNext → running, attempts=1");
  assert(claimed!.attempts === 1, "attempts incremented");
  jobsRepo.markDone(j.id, { sent: true });
  assert(jobsRepo.findById(j.id)?.status === "done", "markDone → done");
  assert(jobsRepo.findById(j.id)?.result_json !== null, "result_json записан");

  // 2. scheduler_runs lifecycle.
  console.log("\n2) scheduler_runs lifecycle: start → mergeStats → finish");
  const runId = schedulerRunsRepo.start();
  schedulerRunsRepo.mergeStats(runId, { collected: 5 });
  schedulerRunsRepo.mergeStats(runId, { matched_pairs: 3 });
  schedulerRunsRepo.mergeStats(runId, { drafted: 2 });
  let run = schedulerRunsRepo.findById(runId);
  assert(run?.finished_at === null, "run не завершён до finish()");
  const statsBefore = JSON.parse(run!.stats_json!);
  assert(statsBefore.collected === 5 && statsBefore.matched_pairs === 3 && statsBefore.drafted === 2, "stats накоплены");
  schedulerRunsRepo.finish(runId, statsBefore, {});
  run = schedulerRunsRepo.findById(runId);
  assert(run?.finished_at !== null, "run завершён (finished_at проставлен)");

  // 3. pause/resume/retry/cancel.
  console.log("\n3) pause/resume/retry/cancel");
  const q = jobsRepo.enqueue("match", { run_id: 1 });
  jobsRepo.pause(q.id);
  assert(jobsRepo.findById(q.id)?.status === "cancelled", "pause → cancelled");
  jobsRepo.resume(q.id);
  assert(jobsRepo.findById(q.id)?.status === "queued", "resume → queued");

  // claim+markFailed конкретно на f: создам раньше q, чтобы claimNext взял f.
  const f = jobsRepo.enqueue("match", { run_id: 2 }, new Date(Date.now() - 60_000), { maxAttempts: 1 });
  const fClaimed = jobsRepo.claimNext();
  assert(fClaimed?.id === f.id, "claimNext взял именно f (ранний run_after)");
  jobsRepo.markFailed(f.id, "x");
  assert(jobsRepo.findById(f.id)?.status === "failed", "markFailed при max → failed");
  jobsRepo.retry(f.id);
  assert(jobsRepo.findById(f.id)?.status === "queued", "retry → queued + attempts=0");
  assert(jobsRepo.findById(f.id)?.attempts === 0, "retry сбрасывает attempts");

  // q (создан после f) — проверить pause/resume в изоляции.
  void q;

  // 4. Моделирование цепочки (как worker.dispatch). Очередь уже содержит
  // «мусор» из шага 3 (q, f queued) — поэтому claimNext ниже берёт их,
  // не collect. Чтобы проверить цепочку чисто, сразу enqueue+claim+done в нужном порядке.
  console.log("\n4) моделирование цепочки collect→match→generate_draft");
  const cycleRun = schedulerRunsRepo.start();
  const collect = jobsRepo.enqueue("collect_vacancies", {});
  // Подготовим collect к исполнению: claim+done имитируют worker.
  const collectClaimed = jobsRepo.claimNext();
  // В очереди могут быть «мусорные» q/f из шага 3 (queued после resume/retry).
  // Если claimNext взял не collect — почистим и переклеймим.
  if (collectClaimed?.id === collect.id) {
    jobsRepo.markDone(collect.id, { run_id: cycleRun });
  } else {
    jobsRepo.cancel(q.id);
    jobsRepo.cancel(f.id);
    const reclaim = jobsRepo.claimNext();
    assert(reclaim?.id === collect.id, "claimNext взял collect после очистки q/f");
    jobsRepo.markDone(collect.id, { run_id: cycleRun });
  }
  // collect-done → энкьютит match
  jobsRepo.enqueue("match", { run_id: cycleRun });
  const matchClaim = jobsRepo.claimNext();
  assert(matchClaim?.kind === "match", "match в очереди после collect-done");
  jobsRepo.markDone(matchClaim!.id, { matched: 4 });
  schedulerRunsRepo.mergeStats(cycleRun, { matched_pairs: 4 });
  // match-done → энкьютит generate_draft
  jobsRepo.enqueue("generate_draft", { run_id: cycleRun });
  const draftClaim = jobsRepo.claimNext();
  assert(draftClaim?.kind === "generate_draft", "generate_draft в очереди после match-done");
  jobsRepo.markDone(draftClaim!.id, { drafted: 2 });
  schedulerRunsRepo.mergeStats(cycleRun, { drafted: 2 });
  // generate_draft-done → finish run (тупик)
  const finalRun = schedulerRunsRepo.findById(cycleRun);
  schedulerRunsRepo.finish(cycleRun, JSON.parse(finalRun!.stats_json!), {});
  assert(schedulerRunsRepo.findById(cycleRun)?.finished_at !== null, "run завершён после generate_draft");
  // В очереди могут остаться «мусорные» q/f (cancelled), но новых queued нет.
  const leftoverQueued = jobsRepo.list({ status: "queued" });
  assert(leftoverQueued.length === 0, `очередь queued пуста (тупик цепочки), осталось ${leftoverQueued.length}`);

  // 5. countByStatus / countApplyToday.
  console.log("\n5) countByStatus / countApplyToday");
  const counts = jobsRepo.countByStatus();
  assert(counts.done >= 2, "countByStatus считает done");
  const today = jobsRepo.countApplyToday();
  assert(today === 1, `countApplyToday = ${today} (ожидается 1 — начальный apply_hh done)`);

  console.log("\n✓ SMOKE OK — все инварианты очереди и scheduler_runs валидны.");
  console.log("\nДля реального цикла: npm run scheduler (после hh:login + env).");
}

main().catch((err) => {
  console.error("smoke упал:", err);
  process.exit(1);
});
