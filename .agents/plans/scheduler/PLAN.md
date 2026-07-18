# Plan: scheduler

> Фаза 12 ROADMAP. Фоновый планировщик полного цикла
> `collect → match → draft → (ручное approve) → apply`.
> Режим vision: «система готовит → ты одобряешь → auto-apply».

## Goal

Standalone long-running tsx-воркер (`npm run scheduler`) крутит цикл сбора
и подготовки откликов: планировщик берёт из очереди `jobs` следующую задачу
(`WHERE status='queued' AND run_after<=now ORDER BY run_after`), исполняет её
через существующие оркестраторы (`collect-hh`, `matchAll`, `generateDraftsAll`,
`submitApplication`) и при успехе энкьютит следующий шаг цепочки.
Apply к hh никогда не запускается циклом автоматически — `apply_job`
создаётся **только** в action `/applications/:id` intent=`approve`.
Троттлинг hh: jitter 15–60с + `HH_MAX_PER_CYCLE` + суточный cap `HH_DAILY_LIMIT`.
UI `/jobs` показывает очередь с pause/resume/retry.

## Decisions (зафиксированы в discuss)

- **Процесс**: `scripts/scheduler.ts` (long-running `npm run scheduler`), рядом
  с dev-сервером. НЕ внутри React Router, НЕ setInterval в server entry.
- **Связь шагов**: цепочка job'ов — шаг при `done` сам энкьютит следующий
  (`collect_vacancies` → `match` → `generate_draft`). Throttle через `run_after`.
  Цикл = новая `scheduler_runs` строка при запуске корневого `collect_vacancies`.
- **Apply триггер**: `apply_job` создаётся **только** в `/applications/:id`
  approve-action (заменяя прямой вызов `submitApplication` из фазы 11).
  В цикле apply НЕ добивается.
- **Анти-лимиты hh**: `applyThrottle` — jitter `rand(15..60)c` + счётчик за цикл
  (`HH_MAX_PER_CYCLE`, по умолч. 20) + счётчик за сутки (`HH_DAILY_LIMIT`,
  по умолч. 80). Превышение → оставшиеся approved ждут след. день
  (apply_job получает `run_after` = начало след. дня, остаётся `queued`).
- **UI**: `/jobs` — таблица очереди (id, kind, status, run_after, attempts,
  error, result) + кнопки pause/resume/retry (intent-ветвление как в фазах 03/10).
- **jobKinds**: добавляем `'match'` (миграция 0004). Итоговый enum:
  `collect_vacancies | match | generate_draft | apply_hh`.
- **scheduler_runs**: новая таблица аудита циклов (id, started_at, finished_at,
  stats_json: кол-во собрано/скоринг/писем/отправлено, last_error).

## Steps

### 1. Схема: jobKinds += 'match' + таблица scheduler_runs (миграция 0004)

- `app/db/schema.ts`:
  - `jobKinds` → `["collect_vacancies", "match", "generate_draft", "apply_hh"]`.
  - Новая таблица `scheduler_runs` (id PK, started_at, finished_at, stats_json,
    last_error, …timestamps). Без FK — цикл независим от конкретной job-строки.
- `npm run db:generate` → `drizzle/0004_*.sql` + snapshot.
- `app/db/repositories/jobs.ts` (новый): `enqueue(kind, payload, run_after?)`,
  `claimNext(now)` (атомарный `queued→running` через UPDATE…WHERE id=?
  RETURNING), `markDone(id, result)`, `markFailed(id, error)`, `cancel(id)`,
  `retry(id)` (сброс `attempts<max_attempts`, `status='queued'`, `run_after=now`),
  `list(filter?)`, `findById`.
- `app/db/repositories/scheduler_runs.ts` (новый): `start() → id`,
  `finish(id, stats, error?)`.
- Тесты: `tests/jobs-repo.test.ts`, `tests/scheduler-runs-repo.test.ts`
  (in-memory better-sqlite3 + migrator, паттерн фаз 02/03).

### 2. Ядро воркера: scripts/scheduler.ts + app/scheduler/worker.ts

- `app/scheduler/worker.ts` — вынесенная (тестируемая) логика:
  - `runWorkerOnce(opts)`: взять следующий `claimNext(now)`, диспатч по kind,
    запись результата.
  - `dispatch(job)`: switch по kind → вызов оркестратора + планирование
    следующего шага цепочки:
    - `collect_vacancies` → `runCollect()` (через `app/scheduler/steps/collect.ts`
      обёртку над логикой `scripts/collect-hh.ts` — main() вынести в функцию),
      при ok → `enqueue('match', {run_id}, now+small)`.
    - `match` → `matchAll({})`, при ok → `enqueue('generate_draft', {run_id}, now)`.
    - `generate_draft` → `generateDraftsAll({minScore})`, при ok → `scheduler_runs.finish(run_id, stats)`.
    - `apply_hh` → `applyWithThrottle()` (шаг 3), НЕ энкьютит ничего (тупик цепочки).
  - Throttle-минимум между шагами: `run_after = now + rand(5..15)c` (поведенческий).
- `scripts/scheduler.ts` — loop: `while (true) { runWorkerOnce(); await sleep(pollInterval) }`.
  `pollInterval` из env `SCHEDULER_POLL_SEC` (по умолч. 30). Graceful shutdown
  на SIGINT/SIGTERM (закрыть playwright-контекст, выйти).
- Тесты: `tests/scheduler-worker.test.ts` на `vi.useFakeTimers` — мок оркестраторов,
  проверка цепочки (collect-done → match-queued → match-done → draft-queued),
  continue-on-error (fail → markFailed, без падения цикла).

### 3. Throttle apply + суточный cap: app/hh/applyThrottle.ts

- `canApplyNow()` — счётчик apply за сегодня (`jobs WHERE kind='apply_hh' AND
  status IN ('done','running') AND finished_at>=start_of_day`) < `HH_DAILY_LIMIT`.
  + счётчик за текущий цикл воркера (in-memory counter, reset на новый poll).
- `applyWithThrottle(applicationId)`: если cap достигнут → `run_after = startOfNextDay`,
  остаётся `queued`, return. Иначе `await sleep(rand(15..60)c)`, вызвать
  `submitApplication`. Превышение `HH_MAX_PER_CYCLE` → break цикла apply.
- Интеграция: `dispatch` для `apply_hh` вызывает `applyWithThrottle`.
- Тесты: `tests/apply-throttle.test.ts` — мок `submitApplication` и `jobsRepo`,
  проверка: (а) под cap → submit вызван, (б) над cap → run_after сдвинут, submit
  не вызван.

### 4. /applications/:id approve-action → enqueue apply_job

- `app/routes/applications._index.tsx`: ветка `intent === "approve"` после
  `applicationsRepo.updateStatus(id, 'approved')` →
  `jobsRepo.enqueue('apply_hh', { application_id: id }, new Date())`.
  Существующий `intent === "apply"` (прямой submit из фазы 11) ОСТАВЛЯЕМ
  (ручной fallback / smoke).
- Тесты: обновить `tests/applications-route.test.ts` — approve →
  assert job в очереди с `kind='apply_hh'`, `payload_json` содержит `application_id`.

### 5. UI /jobs (pause/resume/retry) + плашка на главной

- `app/routes/jobs._index.tsx`: loader (`jobsRepo.list` с опц. фильтром по status),
  action с intent `pause|resume|retry|cancel` → соответствующие repo-методы.
  Таблица: id, kind, status, run_after, attempts/max, error (truncate), result.
- `_index.tsx` (главная): плашка «Очередь» (как «Отклики»/«Резюме» из фазы 10)
  → `/jobs`, показывает счётчик queued/running/failed.
- Тесты: `tests/jobs-route.test.ts` — loader возвращает список, action pause
  переводит running→cancelled, retry ставит failed→queued.

### 6. CLI/scripts wiring + npm scripts + smoke

- `package.json`: `"scheduler": "tsx scripts/scheduler.ts"`.
- `scripts/smoke-scheduler.ts`: вручную enqueue collect_vacancies (mock collect
  или минимальный) → запустить `runWorkerOnce` → assert прошла цепочка до
  generate_draft, создана scheduler_runs. Документация в комментарии: как
  гонять реальный smoke (нужны ключи hh-session, ZAI_API_KEY).
- README: секция «Планировщик» — `npm run scheduler`, env-переменные.

## Acceptance

- `npm run scheduler` запускается и крутит цикл, беря задачи из очереди по
  `run_after`. SIGINT/SIGTERM корректно останавливают (закрытие playwright).
- Цепочка работает end-to-end (smoke): ручной enqueue `collect_vacancies` →
  воркер прогоняет `collect → match → generate_draft`, в `scheduler_runs`
  появляется строка с `stats_json` и `finished_at`.
- `apply_job` создаётся **только** в approve-action; цикл apply не запускает.
  При `HH_DAILY_LIMIT` достигнутом apply_job остаётся queued, `run_after` = start
  следующего дня, `submitApplication` не вызывается.
- Throttle hh: jitter 15–60с между apply, не более `HH_MAX_PER_CYCLE` за poll.
- UI `/jobs` показывает очередь; pause/resume/retry работают (action → status
  меняется, loader отражает). Плашка на главной кликабельна.
- `npm run typecheck` чист. Автотесты `N/N` зелёные (новые: jobs-repo,
  scheduler-runs-repo, scheduler-worker, apply-throttle, jobs-route; обновл.:
  applications-route).
- Конец фазы: ROADMAP фаза 12 → complete, STATE обновлён, SUMMARY.md написан.
  (smoke реального hh-цикла опционален — требует ключи/сессию; smoke-mock обязателен.)

## Constraints / out-of-scope

- Не трогаем существующие оркестраторы (`matchAll`, `generateDraftsAll`,
  `submitApplication`) — только вызываем.
- Wellfound по-прежнему заморожен (IP-блок, фаза 06); в collect цикле только hh.
  Telegram — если есть `TG_API_*`, можно в collect шаг, но не блокирующее.
- AI-адаптация резюме — не фаза 12 (опция из фазы 09).
