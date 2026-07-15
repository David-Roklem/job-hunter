---
phase: 10
plan: review-ui
title: "Инбокс ревью откликов (review-ui)"
status: complete
started: 2026-07-15T14:30:00Z
completed: 2026-07-15T17:45:00Z
duration: "~3.25h"
tasks_completed: 7
files_modified: 7
tags: [ui, review, applications, react-router]
key-files:
  created:
    - app/routes/applications._index.tsx
    - app/routes/applications.$id.edit.tsx
    - tests/review-ui.test.ts
  modified:
    - app/db/repositories/applications.ts
    - app/routes/_index.tsx
    - app/app.css
    - tests/smoke.test.tsx
key-decisions:
  - Инбокс показывает applications С cover_letter (письмо = готовность к ревью)
  - Действия approve/reject/regenerate/edit; без ручного dropdown'а статусов
  - Редактирование письма → coverLettersRepo.updateBody (edited_at отличает ручную правку от AI)
  - Маршрут /applications; паттерны UI повторяют фазу 03 resumes
---

# Phase 10 review-ui: Summary

Первый полноценный пользовательский экран цикла «система готовит → ты одобряешь».
Инбокс `/applications` показывает отклики с сгенерированным письмом (от
draft-generator фазы 09) с действиями: одобрить / отклонить / регенерировать /
редактировать письмо. Главная делает плашки «Отклики»/«Резюме» кликабельными.

## Duration  ~3.25h (2026-07-15T14:30 → 2026-07-15T17:45)

## Tasks

- **Task 1:** `applicationsRepo.listWithLetter()` — relations (vacancy.company +
  resume_template + cover_letter), фильтр «есть письмо» в JS, сортировка
  generated_at desc. (commit 1dacff7)
- **Task 2:** `app/routes/applications._index.tsx` — инбокс. loader (listWithLetter)
  + action (approve/reject/regenerate, throw 404/400/500) + UI карточек с
  действиями + пустое состояние. (commit 1dacff7)
- **Task 3:** `app/routes/applications.$id.edit.tsx` — редактирование письма.
  loader (findById, throw 404 если нет/нет письма) + action (save с валидацией
  непустого body / approve) + форма с textarea. (commit 1dacff7)
- **Task 4:** `_index.tsx` — плашки «Резюме»/«Отклики» кликабельны (обёрнуты в Link,
  необязательное поле href в SECTIONS). (commit 1dacff7)
- **Task 5:** CSS — `.badge--approved/--rejected/--draft` статусы + `.card__actions`
  /`.card__link`. (commit 1dacff7)
- **Task 6:** `tests/review-ui.test.ts` — 14 тестов (listWithLetter 2, index
  loader+action 6, edit loader+action 6), loaders/actions напрямую, vi.mock zai +
  in-memory БД. (commit 1dacff7)
- **Task 7:** ручной smoke на dev-сервере — approve/reject/regenerate/save/404 все
  валидны end-to-end на реальной БД.

## Deviations from Plan

**[Rule 3 — Adjacent fix] TS: data() возвращает DataWithResponseInit, не Response**
- Found during: typecheck после реализации index action.
- Issue: `return data(..., {status})` для 400/404/500 не assignable к
  `Promise<ActionData | Response>` — `data()` возвращает `DataWithResponseInit`,
  а не `Response`.
- Fix: 400/404/500 случаи делают `throw data(...)` (как resumes edit фазы 03),
  не return. После успеха — `redirect(...)`.
- Files: `app/routes/applications._index.tsx`. Verification: tsc чистый.

**[Rule 1 — Regression от Task 4] smoke-тест главной сломан добавлением Link**
- Found during: полный прогон тестов.
- Issue: добавление `<Link>` на главную (Task 4) сломало `tests/smoke.test.tsx`,
  который рендерил `<Dashboard>` напрямую без Router context (раньше главная имела
  только статичные `<li>`, без Link).
- Fix: обернуть рендер в тесте в `<MemoryRouter>` (стандарт для react-router
  компонентных тестов).
- Files: `tests/smoke.test.tsx`. Verification: 219/219 passed.

**[Observation, не фикс] Коллизия timestamps в тесте сортировки.**
- `cover_letters.generated_at` хранится в секундах (integer timestamp) — два
  письма, созданные в одну секунду, дают неопределённый порядок. Тест сортировки
  детерминирован через sleep >1с. В реальном сценарии (~100 откликов за минуты)
  коллизии редки и некритичны (порядок между ними не принципиален). Не баг кода.

**Total deviations:** 2 auto-fixed (Rule 3 + Rule 1 regression). **Out-of-scope:** 1 (observation). **Escalated:** 0.

## Authentication Gates

None. UI работает с локальной БД; регенерация использует уже настроенный ZAI_API_KEY.

## Verification

```
npm run typecheck  → чистый (tsc + react-router typegen)
npm test           → 219/219 passed (21 files)
  + tests/review-ui.test.ts  14 passed
     listWithLetter: фильтр по письму / сортировка (2)
     index loader+action: loader / approve / reject / regenerate / 404 / 400 (6)
     edit loader+action: loader / 404 / 404-без-письма / save / save-пустое / approve (6)

Ручной smoke (npm run dev, реальная БД):
  /                       → рендер, плашки Отклики/Резюме кликабельны (href)
  /applications           → карточки с реальными applications, badges, кнопки
  /applications/1/edit    → форма с textarea письма
  POST approve #1         → 302, status draft→approved, badge--approved
  POST reject #2          → 302, status draft→rejected
  POST save (edit)        → 302, body обновлён, edited_at выставлен
  POST save пустой body   → form__error, БД не тронута
  edit/999                → HTTP 404
```

## Files Touched  - Created: 3  - Modified: 4 (+STATE/ROADMAP/PLAN)

## Next

Фаза 10 выполнена. После merge в master — по ROADMAP:
- **фаза 11 (apply-hh):** авто-отклик на hh.ru через Playwright после подтверждения
  (status='approved' → отправка, анти-лимиты/задержки). Замыкает цикл «система
  готовит → ты одобряешь → система отправляет».
- **фаза 12 (scheduler):** фоновый планировщик — регулярный сбор + матчинг +
  генерация писем автоматически (оркестрация фаз 05–09), ~100 откликов/день.

На этом полный v0.1.0 цикл (сбор → матчинг → письмо → ревью → отправка) почти
готов; не хватает только авто-отправки (11) и автоматизации (12).
