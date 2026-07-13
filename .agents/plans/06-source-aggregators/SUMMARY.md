---
phase: 06
plan: source-aggregators
title: "Wellfound (aggregator) via Playwright + shared browser/session"
status: complete
duration: "~35m"
started: 2026-07-13T08:41:30Z
completed: 2026-07-13T09:16:20Z
tasks_completed: 11
files_modified: 14
tags: [wellfound, aggregator, playwright, wellfound, international-market]
key-files:
  created:
    - app/browser/session.ts
    - app/wellfound/selectors.ts
    - app/wellfound/parsers.ts
    - app/wellfound/session.ts
    - app/wellfound/collect.ts
    - scripts/seed-wellfound.ts
    - scripts/wellfound-login.ts
    - scripts/collect-wellfound.ts
    - tests/fixtures/wellfound-search.html
    - tests/fixtures/wellfound-vacancy.html
    - tests/wellfound-parsers.test.ts
    - tests/wellfound-filter.test.ts
    - tests/wellfound-collect.test.ts
  modified:
    - app/db/schema.ts
    - app/hh/session.ts
    - package.json
key-decisions:
  - "Новый source kind 'aggregator' в enum (Wellfound и будущие агреграторы)"
  - "Общий app/browser/session.ts (параметризованный locale/timezone/profileDir) — hh и wellfound тонкие обёртки"
  - "Wellfound SPA → waitForSelector перед page.content() (отличие от hh SSR)"
  - "Ручной smoke ОТЛОЖЕН: Cloudflare bot-detect блокирует Playwright по IP"
requirements-completed: []
---

# Phase 06 Plan: source-aggregators — Summary

Второй источник вакансий (Wellfound) реализован поверх переиспользованной
инраструктуры фазы 05: общий browser-context, тот же include/exclude-фильтр,
те же таблицы/репозитории, тот же collect-цикл. Автотесты зелёные (80/80).
Ручной smoke заблокирован Cloudflare-детектом — отложен до эскалации анти-детекта.

## Duration  ~35m (08:41 → 09:16 UTC)

## Tasks

- Task 1: extend `sourceKinds` enum с `"aggregator"` (`d2085f0`). Миграция физически не нужна — SQLite хранит enum как `text`, валидация на уровне zod-runtime + TS.
- Task 2: вынесен общий `app/browser/session.ts` (`createContext({profileDir,headed,locale,timezone})` + `isLoggedIn(page,markers)`); `app/hh/session.ts` стал тонкой обёрткой (`bd0a946`). Существующие hh-скрипты и vi.mock не сломаны.
- Task 3: модуль `app/wellfound/` — `selectors.ts` (data-testid, изоляция), `parsers.ts` (чистые cheerio-функции + свой `parseSalary` под `$`/`k`), `session.ts` (en-US, отдельный profile), `collect.ts` (оркестратор с `waitForSelector` под SPA + `WellfoundBlockError`) (`4857ae0`).
- Task 4-6: CLI-скрипты `wellfound:{seed,login,collect}` + npm bin (`da95376`), фикс seed DTO (`cd623ef`).
- Task 7-10: фикстуры `wellfound-{search,vacancy}.html` + тесты parsers(13)/filter(5)/collect(7) (`a6279f0`); фикс `parseSalary` k-обработки.
- Task 11: package.json scripts (в составе `da95376`).
- Task 12 (smoke): **отложен** — Cloudflare bot-detect блокирует по IP. См. ниже.

## Deviations from Plan

**[Rule 1 — Bug] parseSalary: «k» терялся между regex и parseMoney**
- Found during: Task 8 (RED в wellfound-parsers.test.ts)
- Issue: regex `[\d.,]+\s*k?` съедал `k` до вызова `parseMoney`, поэтому `"$150k"` парсился как `150`, а не `150000`.
- Fix: включил `k` в capture-группу (`([\d.,]+k?)`), `parseMoney` применяет множитель.
- Files: `app/wellfound/parsers.ts` · Verification: 13/13 wellfound-parsers зелёные · Commit: `a6279f0`

**[Rule 1 — Bug] seed-wellfound: source.create() возвращает Source, не DTO**
- Found during: Task 12 (ручной seed упал с `Cannot read properties of undefined (reading 'search_profile_id')`)
- Issue: `sourcesRepo.create()` возвращает `Source` (с `config_json`), а скрипт читал `source.config` (поле DTO). `list()`/`findById()` возвращают DTO, `create()` — нет.
- Fix: после create перечитываю через `findById(created.id)`.
- Files: `scripts/seed-wellfound.ts` · Verification: `npm run wellfound:seed` отработал идемпотентно · Commit: `cd623ef`

**[Rule 1 — Missing impl detail] Миграция 0002 не сгенерировалась**
- Found during: Task 1
- Issue: план ожидал миграцию 0002 для консистентности chain, но `db:generate` сообщил «No schema changes» — SQLite хранит `text` enum без физического CHECK на уровне БД, валидация只在 zod/TS runtime.
- Fix: ничего менять не нужно; enum-значение `"aggregator"` работает через `sourceKindSchema.parse` (zod) и TS-вывод. Зафиксировано здесь как уточнение к плану.
- Files: — · Verification: `npm run typecheck` чистый; `sourcesRepo.create({kind:"aggregator"})` проходит zod · Commit: `d2085f0`

**Total deviations:** 3 auto-fixed (Rule 1). **Out-of-scope:** 0. **Escalated:** 0 (bot-detect — см. Authentication Gates, не deviation).

## Authentication Gates

**[human-action] Ручной логин Wellfound — ЗАБЛОКИРОВАН Cloudflare**
- При запуске `npm run wellfound:login` (headed браузер) Wellfound отдал страницу:
  «Access is temporarily restricted — Automated (bot) activity on your network (IP 202.148.55.56)».
- Блок сработал **до** формы входа — по IP/fingerprint, а не по учетке. Уровень анти-детекта 2 (ручные stealth из фазы 05) недостаточен для Cloudflare Wellfound'а.
- Не ошибка кода: collect/parsers/session корректны (покрыты автотестами 80/80). Внешний блок.
- **Решение пользователя:** эскалировать анти-детект через **Camoufox** (общий стек для всех источников) — отдельный план/фаза.

## Out-of-Scope Issues

- **Camoufox / анти-детект уровень 3** — следующий план. Заменит ядро `app/browser/session.ts` (Chromium → Camoufox Firefox-based). Повлияет на hh и wellfound одновременно; повторный smoke обоих источников после миграции.
- **Реальные селекторы Wellfound** — синтетические фикстуры созданы под правдоподобные `data-testid`. Уточнятся только когда пройдёт реальный smoke (после Camoufox). При расхождении правка в `app/wellfound/selectors.ts` + фикстуры.
- **Карьерные страницы компаний** (source kind `"company"` уже в enum) — не в этой фазе.
- **Другие агреграторы** (Хабр Карьера, SuperJob и т.д.) — добавятся по образцу `app/wellfound/` позже.

## Verification

```
npm run typecheck        → без ошибок
npm test                 → 80/80 (10 files): smoke 3, resume 12, ai-zai 10, generate 5,
                          hh-parsers 12, hh-filter 8, hh-collect 5,
                          wellfound-parsers 13, wellfound-filter 5, wellfound-collect 7
npm run db:generate      → "No schema changes" (enum — runtime-check, не DDL)
npm run db:migrate       → applied (миграции 0000/0001)
npm run wellfound:seed   → ✓ source id=2 (aggregator) + profile id=2, связаны
```

## Known limitations

1. **Ручной smoke не пройдён.** Cloudflare блокирует Playwright-браузер по IP.
   Код готов и покрыт автотестами на фикстурах, но **реальная структура Wellfound
   не проверена** — селекторы в `app/wellfound/selectors.ts` правдоподобны, но
   могут не совпасть с реальностью. Лечится после Camoufox-эскалации.
2. **stealth languages захардкожены `ru-RU`** в `app/hh/stealth.ts` (init-script).
   Для Wellfound (en-US locale) это лёгкая неконсистентность fingerprint'а
   (en-US есть в списке, поэтому не критично). При Camoufox-миграции станет неактуально.
3. **`pickEmploymentType` дублирован** в `app/wellfound/collect.ts` и `app/hh/collect.ts`
   (тривиальный хелпер). Можно вынести в общий модуль, но пока не критично.
4. **Wellfound ToS** — парсинг может нарушать ToS. single-user локально = низкий риск.

## Files Touched

- Created: 13 (app/browser/session.ts, app/wellfound/* × 4, scripts × 3, tests/fixtures × 2, tests × 3)
- Modified: 3 (app/db/schema.ts, app/hh/session.ts, package.json)

## Next

Фаза 06 завершена на уровне кода + автотестов. Ручной smoke отложен до эскалации
анти-детекта. **Следующий план:** `camoufox-stealth-upgrade` (или фаза 07) —
переход на Camoufox как общий браузер-стек для hh + wellfound, затем повторный
smoke обоих источников. После этого — ROADMAP фаза 07 (source-telegram).
