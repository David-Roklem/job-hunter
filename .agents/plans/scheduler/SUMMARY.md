---
phase: 12
plan: scheduler
title: "Фоновый планировщик: collect→match→draft→(approve)→apply"
status: complete
started: 2026-07-18T11:02:31Z
completed: 2026-07-18T14:27:00Z
duration: "~3h 25m"
tasks_completed: 6
files_modified: 16
tags: [scheduler, queue, jobs, hh, ui]
key-files:
  created:
    - app/db/repositories/jobs.ts
    - app/db/repositories/scheduler_runs.ts
    - app/hh/applyThrottle.ts
    - app/scheduler/steps.ts
    - app/scheduler/worker.ts
    - app/routes/jobs._index.tsx
    - scripts/scheduler.ts
    - scripts/smoke-scheduler.ts
    - drizzle/0004_lively_squirrel_girl.sql
    - tests/jobs-repo.test.ts
    - tests/scheduler-runs-repo.test.ts
    - tests/apply-throttle.test.ts
    - tests/scheduler-worker.test.ts
    - tests/jobs-route.test.ts
  modified:
    - app/db/schema.ts
    - app/db/repositories/index.ts
    - app/routes/applications._index.tsx
    - app/routes/_index.tsx
    - app/app.css
    - package.json
    - README.md
    - tests/review-ui.test.ts
key-decisions:
  - "Standalone tsx-воркер scripts/scheduler.ts (npm run scheduler) — НЕ внутри RR-сервера"
  - "Цепочка job'ов: шаг при done сам энкьютит следующий (collect→match→generate_draft)"
  - "apply_job создаётся ТОЛЬКО из /applications/:id approve-action (mode vision)"
  - "applyThrottle: jitter 15-60с + HH_MAX_PER_CYCLE + HH_DAILY_LIMIT"
  - "jobKinds += 'match' через миграцию 0004 + новая таблица scheduler_runs"
requirements-completed: []
---

# Фаза 12 Plan scheduler: Summary

Standalone long-running tsx-воркер крутит полный цикл подготовки откликов
(collect→match→generate_draft) с очередью задач `jobs` и троттлингом apply
к hh.ru (jitter + cycle-cap + daily-cap). Apply никогда не запускается
циклом — только из UI approve-action. UI `/jobs` для аудита и ручного
pause/resume/retry.

## Duration  ~3h 25m (2026-07-18T11:02Z → 14:27Z)

## Tasks

- **Шаг 1** — schema + миграция (85df7ae): `jobKinds += 'match'`, таблица
  `scheduler_runs`, репозитории `jobs` (enqueue/claimNext/markDone/markFailed
  с бэк-оффом/cancel/retry/pause/resume/countByStatus/countApplyToday) и
  `scheduler_runs` (start/mergeStats/pushError/finish). 26 тестов.
- **Шаг 3** — `app/hh/applyThrottle.ts` (3a1fe48): jitter rand(15-60)c +
  HH_MAX_PER_CYCLE + HH_DAILY_LIMIT, deferred-to-tomorrow при превышении
  суточного cap. 9 тестов.
- **Шаг 2** — `app/scheduler/worker.ts` + `steps.ts` (f70b083): runWorkerOnce
  с dispatch по kind, цепочка collect→match→draft через enqueue next-step,
  apply через throttle (4 исхода: applied/deferred/cycle-limit/failed).
  `scripts/scheduler.ts` standalone long-running loop с SIGINT/SIGTERM.
  11 тестов.
- **Шаг 4** — approve-action (2c125a4): `/applications/:id` intent=approve
  теперь энкьютит apply_job вместо прямого submitApplication (последний
  сохранён как ручной fallback intent=apply).
- **Шаг 5** — UI `/jobs` (9884d61): таблица очереди + счётчики по статусам
  + pause/resume/retry/cancel action + плашка «Очередь» на главной. CSS
  для `.table`/`.badge--danger`. 9 тестов.
- **Шаг 6** — wiring (54bae7f): `npm run scheduler`, `npm run smoke:scheduler`,
  README-секция с env-таблицей.

## Deviations from Plan

**Total deviations:** 1 auto-fixed (Rule 1/2). **Out-of-scope:** 0. **Escalated:** 1 (gap-resolve до старта).

- **[Rule 2 — Missing detail] runCollect source iteration**
  - Found during: pre-implementation gap-hunt
  - Issue: план говорил «обёртка над логикой collect-hh.ts», но collectVacancies
    требует конкретные source_id+profile_id, а цикл не знает их. Уточнено через
    ask_pro: `runCollect()` итерирует по всем активным source kind='hh', достаёт
    search_profile_id из source.config, вызывает collectVacancies для каждой пары
    (continue-on-error).
  - Fix: `app/scheduler/steps.ts:runCollect` реализует именно эту итерацию.
  - Files: app/scheduler/steps.ts · Verification: scheduler-worker.test.ts
    "полная цепочка" (11/11) · Commit: f70b083

- **[Rule 1 — Test correctness] timestamp-mode precision**
  - Found during: Step 1 тесты падали на `before <= run_after.getTime()`
  - Issue: Drizzle `mode:"timestamp"` хранит секунды (без мс). Строгие
    миллисекундные сравнения в тестах давали false-negative.
  - Fix: тесты переведены на секундную точность (`Math.floor(t/1000)`),
    FIFO-тест использует гэп 120с вместо 5с.
  - Files: tests/jobs-repo.test.ts · Commit: 85df7ae

## Authentication Gates

None — план не требует внешних ключей для автотестов/smoke (использует моки
для steps/throttle). Реальный hh-цикл требует `npm run hh:login` (как фазы 05/11).

## Out-of-Scope Issues

- **Авто-запуск цикла по расписанию**: воркер НЕ энкьютит корневой
  collect_vacancies по cron — пользователь явно запускает (внешним cron или
  вручную), чтобы контролировать момент сбора (hh-сессия, время суток).
  Будущая опция: SCHEDULER_AUTO_CYCLE env.
- **Wellfound в цикле**: заморожен по IP-блоку (фаза 06). runCollect берёт
  только kind='hh'.
- **AI-адаптация резюме**: отложена (опция из фазы 09).

## Verification

```
npm run typecheck   → чисто (react-router typegen + tsc)
npm test            → 292/292 passed (28 файлов)
                       было 237/237 (фаза 11), +55 тестов
npm run smoke:scheduler → ✓ SMOKE OK (все инварианты очереди и scheduler_runs)
npm run db:migrate  → миграция 0004 применена к dev-БД
```

Новые тесты: jobs-repo (19), scheduler-runs-repo (7), apply-throttle (9),
scheduler-worker (11), jobs-route (9) = 55. review-ui расширен assert'ами
(+1 в approve, +1 в reject).

## Files Touched  - Created: 14  - Modified: 8

## Next

Фаза 12 complete. ROADMAP фаза 12 → complete.
Смежные возможности (опционально):
- `/jobs` кнопка «enqueue collect_vacancies» (запуск цикла из UI)
- SCHEDULER_AUTO_CYCLE env для cron-перезапуска цикла
- AI-адаптация резюме (опция из фазы 09)
- Wellfound через прокси (фаза 06, заморожен)

Предложить пользователю: `soly verify scheduler` для self-review,
затем `soly done scheduler` для merge + PR.
