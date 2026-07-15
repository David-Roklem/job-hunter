---
phase: 09
plan: draft-generator
title: "Генерация черновиков писем (draft-generator)"
status: complete
started: 2026-07-15T13:23:00Z
completed: 2026-07-15T17:00:00Z
duration: "~3.5h"
tasks_completed: 7
files_modified: 7
tags: [ai, drafts, cover-letter, zai]
key-files:
  created:
    - app/ai/generateDrafts.ts
    - app/routes/drafts.ts
    - scripts/generate-drafts.ts
    - scripts/smoke-drafts.ts
    - tests/generate-drafts.test.ts
  modified:
    - app/ai/generateCoverLetter.ts
    - package.json
key-decisions:
  - Только сопроводительное письмо (резюме = загруженный шаблон как есть, БЕЗ AI-адаптации)
  - generateDrafts переиспользует generateCoverLetter (фаза 04), добавляя батч-оркестрацию + точки запуска
  - Continue-on-error + дедуп по cover_letter + minScore-фильтр (зеркало matcher 08)
---

# Phase 09 draft-generator: Summary

Батч-оркестратор генерации сопроводительных писем для откликов от matcher'а (фаза 08),
поверх существующего `generateCoverLetter` (фаза 04). AI пишет письмо на основе пары
вакансия×загруженный-шаблон-резюме и сохраняет в `cover_letters` (upsert). Точки запуска:
CLI + RR action `/drafts` + smoke. Без UI (фаза 10).

## Duration  ~3.5h (2026-07-15T13:23 → 2026-07-15T17:00)

## Tasks

- **Task 1:** `app/ai/generateDrafts.ts` — батч-оркестратор. `generateDraftsOne()`
  (обёртка над generateCoverLetter для одного application → DraftResult) +
  `generateDraftsAll()` (батч по status='draft' без письма, continue-on-error, дедуп,
  minScore, max). Типы: GenerateDraftsOptions/DraftResult/DraftError/GenerateDraftsStats. (commit 8ff1988)
- **Task 2:** `scripts/generate-drafts.ts` — CLI `npm run generate-drafts`
  (--application/--all/--threshold/--max/--locale), loadEnv, вывод тела письма (one) или
  сводки (all). Script добавлен в package.json. (commit 8ff1988)
- **Task 3:** `app/routes/drafts.ts` — RR resource route (action only, без loader/UI).
  intent-паттерн (зеркало matcher): one (applicationId) / all (threshold/max/locale).
  JSON + form-data, статусы 200/400/404/500. (commit 8ff1988)
- **Task 4:** `scripts/smoke-drafts.ts` — ручной smoke. Пропуск без ZAI_API_KEY (exit 0).
  Автоподбор первого кандидата (draft без письма). (commit 8ff1988)
- **Task 5:** `tests/generate-drafts.test.ts` — 10 тестов (one: успех/404/ошибка-AI;
  all: батч/дедуп/minScore/continue-on-error/не-draft/пусто/max). vi.mock zai + in-memory
  SQLite, паттерн из generate-cover-letter.test.ts / matcher-match.test.ts. (commit 8ff1988)
- **Task 6:** `npm run generate-drafts` script в package.json. (commit 8ff1988)
- **Task 7:** self-review (verify) — 8 functional edge-cases + route edge-cases + smoke
  на реальных данных. Новых багов не найдено.

## Deviations from Plan

**[Rule 3 — Adjacent fix] Предсуществующий TS-баг в generateCoverLetter.ts (фаза 04)**
- Found during: typecheck после реализации фазы 09 (мешал доказать typecheck-чистоту).
- Issue: `import type { AiProvider } from "./types"` импортировал **интерфейс** провайдера
  (AiProvider из app/ai/types.ts) вместо юниона `"zai"|"yandex"|"gigachat"` из `~/db/schema`.
  Каст `resp.provider as AiProvider` ломал typecheck (typecheck был сломан ещё до изменений
  фазы 09 — STATE фазы 08 «tsc чистый» был неточен/не перепроверен после merge фазы 04).
- Fix: импорт `AiProvider` из `~/db/schema`, убран дублирующий импорт из `./types`.
- Files: `app/ai/generateCoverLetter.ts`. Verification: `npm run typecheck` чистый.

**[Observation, не фикс] Имя в сгенерированном письме не совпадает с resume.name.**
- Smoke показал: модель обращается «Родион!» / подпись «Мария Петрова» вместо имени из
  `resume.name` (которое в реальных данных = "Frontend", название шаблона).
- Корень: промпт фазы 04 берёт `resume.name` как имя кандидата, но это поле хранит
  название шаблона ("Frontend"), а не имя человека. Не баг кода фазы 09 — это зазор
  промпт/данных фазы 04. Out-of-scope; фикс — правка промпта (отдельное поле name) или
  данных, будущая задача.

**Total deviations:** 1 auto-fixed (Rule 3). **Out-of-scope:** 1 (observation). **Escalated:** 0.

## Authentication Gates

None. ZAI_API_KEY уже был в .env (настроен в фазе 04/08); smoke на реальных данных
прошёл без дополнительных действий.

## Verification

```
npm run typecheck  → чистый (tsc + react-router typegen)
npm test           → 205/205 passed (20 files)
  + tests/generate-drafts.test.ts  10 passed
     one: успех/404/ошибка-AI (3)
     all: батч/дедуп/minScore/continue-on-error/не-draft/пусто/max (7)

Self-review (verify):
  functional edge-cases (8): пустые skills / NULL match_score / пустой description /
    locale=en / minScore на границе / повторный батч (дедуп) / one с существующим
    письмом (upsert) / score=0 — все корректны
  route edge-cases (7): JSON one/all, form-data urlencoded, 400/404/500, невалидный
    JSON — корректны (multipart/form-data в vitest-окружении не парсится из-за
    boundary-бага undici/happy-dom, но в реальном браузере работает; код идентичен
    matcher.ts route фазы 08, который в проде)
  smoke на реальных данных: application #1 (Fullstack × Frontend, score=35) →
    z.ai/glm-5.2 сгенерировал осмысленное письмо 1281 символов, записано в cover_letters
```

## Files Touched  - Created: 5  - Modified: 2 (+STATE/ROADMAP/PLAN)

## Next

Фаза 09 выполнена. После merge в master — **фаза 10 (review-ui)**: инбокс
«подтвердить / редактировать / отклонить» подготовленных откликов (письма из cover_letters),
одобрение одним кликом перед авто-откликом (фаза 11 apply-hh).
