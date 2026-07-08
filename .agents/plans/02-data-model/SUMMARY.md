---
phase: 2  plan: 02-data-model  title: "Data model (Drizzle/SQLite)"  status: complete
duration: "~38m"  started: 2026-07-08T13:05:15Z  completed: 2026-07-08T13:43:32Z
tasks_completed: 6  files_modified: 9
tags: [data-model, drizzle, sqlite, schema, repositories]
key-files:
  created:
    - app/db/repositories/_shared.ts
    - app/db/repositories/sources.ts
    - app/db/repositories/vacancies.ts
    - app/db/repositories/applications.ts
    - app/db/repositories/index.ts
    - drizzle/0000_aberrant_hellcat.sql
    - drizzle/meta/*
  modified:
    - app/db/schema.ts
    - app/db/index.ts
    - README.md
    - package.json
    - package-lock.json
key-decisions:
  - "better-sqlite3 вместо node:sqlite — драйвера node-sqlite не существует в drizzle-orm 0.45.2"
  - "Реляционный query API Drizzle (db.query.*) асинхронный даже для sync-драйвера — findById/list асинхронны"
  - "Дедупликация вакансий через UNIQUE(source_id, external_id) + onConflictDoNothing"
requirements-completed: []
---

# Phase 2 Plan 02-data-model: Data Model Summary

Полная data-модель `job_hunter` — 9 таблиц Drizzle/SQLite с первой SQL-миграцией
и тонкими репозиториями (vacancies, sources, applications) с дедупликацией и
relations-query API.

## Duration  ~38m (2026-07-08T13:05:15Z → 2026-07-08T13:43:32Z)

## Tasks
- Task 1: Написать `app/db/schema.ts` — 9 таблиц + relations + timestamps-хелпер
- Task 2: Подключить схему в `app/db/index.ts` (drizzle({ schema }))
- Task 3: Сгенерировать SQL-миграцию `drizzle/0000_aberrant_hellcat.sql`
- Task 4: Применить миграцию + верифицировать таблицы (9 + drizzle_meta)
- Task 5: Тонкие репозитории (vacancies, sources, applications, _shared, index)
- Task 6: Финальная верификация acceptance criteria (typecheck/test/build/idempotent)

## Deviations from Plan

**[Rule 2 — Bug found in prior phase] SQLite-драйвер node-sqlite не существует**
- Found during: Task 4 (db:migrate)
- Issue: В drizzle-orm 0.45.2 **нет** драйвера `node-sqlite` (появился только в
  более новых версиях). Bootstrap-фаза оставила несуществующий импорт
  `drizzle-orm/node-sqlite` в `app/db/index.ts` — typecheck проходил (нет проверки
  рантайма), но приложение упало бы при запуске. Решение bootstrap-фазы
  «node:sqlite вместо better-sqlite3» основано на неверной предпосылке.
- Fix: Поставлен **better-sqlite3 12.11.1** + `@types/better-sqlite3`. Импорт в
  `app/db/index.ts` заменён на `drizzle-orm/better-sqlite3`. INIT: `drizzle(new
  Database(dbPath), { schema })`. `drizzle-kit migrate` теперь работает (ему тоже
  нужен better-sqlite3/libsql). Решение утверждено пользователем (Q1: better-sqlite3,
  Q2: фикс в фазе 02).
- Files: `app/db/index.ts`, `package.json`, `package-lock.json`
- Verification: `npm run db:migrate` ✓, runtime smoke-test ✓ (insert/relations/dedup)
- Commit: будет в production-коммите фазы

**[Rule 2 — Bug found during impl] Реляционный query API асинхронный**
- Found during: Task 5 (repositories) — runtime smoke
- Issue: `db.query.vacancies.findFirst({...})` / `findMany({...})` возвращают
  **thenable** (Promise), даже для sync-драйвера better-sqlite3. Первая версия
  репозиториев (`vacancies.ts`, `applications.ts`) писала их как sync — в рантайме
  возвращали query-builder вместо данных.
- Fix: `findById`/`list` в `vacancies.ts` и `applications.ts` помечены `async` и
  вызываются с `await`. Прямые `db.select`/`db.insert`/`db.update` (без relations)
  остались sync — Drizzle для них даёт `.get()`/`.all()`.
- Files: `app/db/repositories/vacancies.ts`, `app/db/repositories/applications.ts`
- Verification: runtime smoke-test relations query ✓
- Commit: в production-коммите фазы

**[Rule 2 — Boundary] drizzle-kit не создаёт директорию БД**
- Found during: Task 4
- Issue: `drizzle-kit migrate` падал «directory does not exist» для `./data/`.
  В рантайме `app/db/index.ts` создаёт директорию (`mkdirSync({recursive:true})`),
  но CLI drizzle-kit этого не делает.
- Fix: `mkdir -p data` перед первым `db:migrate`. В README/инструкции это
  подразумевается шагом. Не требует кода — документируется.
- Verification: migrate после mkdir ✓

**Total deviations:** 3 auto-fixed (Rules 1–3). **Out-of-scope:** 0. **Escalated:** 0 (оба архитектурных решения утверждены пользователем через ask_pro).

## Authentication Gates
None.

## Out-of-Scope Issues
- **Тесты БД/CRUD** — по плану отложены (доверяем drizzle-kit). Появятся в фазах
  matcher (08) / draft-generator (09) с бизнес-логикой.
- **Транзакции в репозиториях** — не нужны на тонком CRUD уровне; добавит scheduler (12).

## Verification
- `npm run typecheck` ✓ (strict, без `any` — grep подтверждает)
- `npm test` ✓ (3/3 smoke-теста)
- `npm run build` ✓ (client + ssr)
- `npm run db:generate` ✓ idempotent («No schema changes»)
- `npm run db:migrate` ✓ (9 таблиц + 6 индексов созданы)
- runtime smoke-test ✓: дедупликация вакансий (UNIQUE source+external), UNIQUE
  applications (второй insert rejected), relations query (vacancy.source.kind)
- must_haves: ✓ нет `any`, ✓ БД только через `index.ts`, ✓ AUTOINCREMENT PK,
  ✓ дедупликация через UNIQUE, ✓ миграции в git (`./drizzle/`)

## Files Touched  - Created: 7  - Modified: 5

## Next
Фаза 02 завершена. Следующая по roadmap — **Phase 03 resume-templates**
(CRUD резюме-шаблонов; загрузка markdown/PDF; редактирование).
Запустите `soly plan 03-resume-templates` для планирования.
