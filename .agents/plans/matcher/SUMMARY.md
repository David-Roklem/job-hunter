---
phase: 08  plan: matcher  title: "Matcher — вакансия×резюме rule-префильтр + AI-скоринг"  status: complete
started: 2026-07-15T10:02Z  completed: 2026-07-15T13:12Z
tasks_completed: 7  files_modified: 9
tags: [matcher, ai-scoring, zai]
key-files:
  created:
    - app/matcher/prefilter.ts
    - app/matcher/match.ts
    - app/ai/prompts/match.ts
    - app/routes/matcher.ts
    - scripts/match.ts
    - scripts/smoke-match.ts
    - tests/matcher-prefilter.test.ts
    - tests/matcher-match.test.ts
  modified:
    - package.json (npm script `match`)
    - app/ai/providers/zai.ts (предсуществующая TS-ошибка `[0]` → `[0]!`)
key-decisions:
  - Двухуровневый алгоритм: rule-префильтр → AI-скоринг (отсекает мусор до дорогого z.ai-запроса)
  - Application создаётся со status='draft' (НЕ 'matched' — такого значения нет в enum applicationStatuses); 'matched' — только vacancy.status
---

# Phase 08: Matcher — Summary

Двухуровневый матчинг вакансия × resume-шаблон: детерминированный rule-based
префильтр (пересечение навыков) отсекает нерелевантное, затем z.ai доскаживает
score 0–100 + rationale. Прошедшие порог (≥50) создаются как `applications`
(`match_score`, `status='draft'`), а вакансия переводится в `status='matched'`.

## Duration  ~3h (2026-07-15T10:02 → 13:12)

## Tasks
1. `app/matcher/prefilter.ts` — чистая `prefilter()` + `countSkillHits()` +
   синоним-словарь (`react.js→react`, `ts→typescript`, …); кириллица-безопасный
   матч через lookbehind `(?<!\p{L})` с флагом `u` (урок фазы 07: `\b` не работает).
2. `app/ai/prompts/match.ts` — `buildMatchMessages()` (system+user, лимиты текста) +
   `parseMatchResponse()` (zod `{score 0-100, rationale}`), strip ```` ```json ````.
3. `app/matcher/match.ts` — `matchVacancy()` (префильтр→AI→create/update application+
   vacancy→matched) и `matchAll()` (vacancies `status='new'` × активные шаблоны).
   Идемпотентность через `findByVacancyAndResume`.
4. `scripts/match.ts` + `npm run match` — CLI (`--vacancy`/`--resume`/`--all`/`--threshold`/`--max`).
5. `app/routes/matcher.ts` — RR7 resource route (action one/all, JSON + form-data, без UI).
6. Тесты: `tests/matcher-prefilter.test.ts` (14) + `tests/matcher-match.test.ts` (14) —
   in-memory SQLite + vi.mock zai.
7. `scripts/smoke-match.ts` — ручной smoke на реальных данных (пропуск без `ZAI_API_KEY`).

## Deviations from Plan

**[Rule 2 — Missing detail] Статус application: 'draft', не 'matched'**
- Found during: Task 3 (тест идемпотентности упал на `applicationStatusSchema.parse('matched')`).
- Issue: PLAN.md предполагал `status='matched'` для applications, но enum
  `applicationStatuses` (`draft|pending_review|approved|sent|failed|rejected`)
  не содержит `'matched'` — это значение только `vacancyStatuses`.
- Fix: matcher создаёт application со `status='draft'` (скор посчитан, черновик
  письма ещё не сгенерирован — работа фаза 09). `vacancy.status='matched'` как в плане.
- Files: `app/matcher/match.ts`, PLAN.md (acceptance + контекст обновлены).
  Verification: тест «AI дал score≥threshold → application создан» проверяет `status='draft'`.

**[Rule 3 — Adjacent fix] Предсуществующая TS-ошибка в zai.ts**
- Found during: `npm run typecheck` перед началом правок.
- Issue: `app/ai/providers/zai.ts:125` — `parsed.data.choices[0].message.content`,
  TS2532 (Object possibly undefined). Воспроизводится на чистом `be2e138`
  (scaffold matcher, до правок фазы 08) — STATE.md «tsc чистый» был неточен.
- Fix: `choices[0]!.message.content` — zod-схема `min(1)` гарантирует наличие `[0]`.
- Строго ограниченный однострочный фикс, без изменения поведения.
- Files: `app/ai/providers/zai.ts`. Verification: `npm run typecheck` чистый.

**[Rule 1 — Bug found during self-review] matchVacancy скорил неактивное резюме**
- Found during: edge-case аудит (verify). Тест «неактивное резюме по id».
- Issue: `matchVacancy(resumeId)` грузил резюме через `findById` без проверки
  `is_active` — мог создать application по удалённому из ротации шаблону.
  `matchAll` фильтровал `is_active`, а `matchVacancy` по id — нет (несогласованно).
- Fix: явный отсев неактивного резюме (score 0, без AI, без application) с понятным
  rationale. Files: `app/matcher/match.ts`. Verification: новый тест «неактивное
  резюме → отсекается без AI».

**[Rule 1 — Bug found during self-review] matchAll падал целиком при mid-batch ошибке**
- Found during: edge-case аудит (verify). Тест «ошибка провайдера midway».
- Issue: transient-ошибка z.ai (429/перегрузка) на одной паре роняла весь батч —
  уже созданные applications терялись, оставшиеся пары не обрабатывались.
  При ~100 вакансий × N шаблонов одна transient-ошибка недопустима как полный провал.
- Fix: continue-on-error — ошибка фиксируется в новом поле `stats.errors`
  (`{vacancyId, resumeTemplateId, message}`), батч продолжается. CLI печатает
  ошибки отдельным блоком. Files: `app/matcher/match.ts`, `scripts/match.ts`.
  Verification: новый тест «mid-batch ошибка → continue-on-error».

**Total deviations:** 4 (2 auto-fixed Rule 1 edge-case, 1 Rule 2, 1 Rule 3). **Out-of-scope:** 0. **Escalated:** 0.

## Authentication Gates
None. `ZAI_API_KEY` опционален — smoke-скрипт пропускается без него (exit 0),
автотесты мокают провайдера. Реальный прогон требует ключа в `.env` (как smoke-zai фазы 04).

## Out-of-Scope Issues
- UI инбокса — фаза 10 (review-ui).
- Адаптация резюме + генерация письма — фаза 09 (draft-generator); matcher только
  скорит и создаёт `applications`, которые фаза 09 наполнит письмом.
- Персист `rationale` в БД — намеренно не сделано (нет колонки, только лог/результат).
- Ручной smoke на реальных данных не запускался (нет `ZAI_API_KEY` в этом окружении);
  скрипт готов, запускается `npx tsx scripts/smoke-match.ts`.

## Verification
```
npm run typecheck  → clean (0 errors)
npm test           → 195/195 passed (19 files)
  + tests/matcher-prefilter.test.ts  14 passed
  + tests/matcher-match.test.ts       19 passed (вкл. 5 edge-case)
```

## Files Touched  - Created: 8  - Modified: 2 (package.json, zai.ts) + PLAN.md/STATE.md

## Next
Фаза 08 готова к merge. Следующая по ROADMAP — **фаза 09 (draft-generator)**:
найти `applications` со `match_score` (от matcher'а) и сгенерировать письмо +
адаптированное резюме (`generateCoverLetter` из фазы 04 уже есть). Либо
`soly verify matcher` для self-review, затем `soly done matcher`.
