# Summary: 05 — source-hh

**Статус:** complete ✓ (2026-07-10) — автотесты зелёные; **ручной smoke (логин+сбор) отложен до следующей сессии**.
**План:** [.agents/plans/05-source-hh/PLAN.md](./PLAN.md)

## Что сделано

Первый источник вакансий: автоматический сбор с hh.ru через Playwright с
анти-детектом (уровень 2), парсингом списка + детальных страниц, бинарной
фильтрацией include/exclude и записью в БД (с дедупликацией).

1. **Анти-детект уровень 2** (`app/hh/stealth.ts`) — ручные init-scripts:
   navigator.webdriver=undefined, window.chrome.runtime, navigator.languages/
   plugins, Permissions API. **Без устаревших playwright-extra/stealth**
   (2023, несовместимы с Playwright 1.61).
2. **Сессия** (`app/hh/session.ts`) — `launchPersistentContext` (реальный профиль
   в `data/hh-profile`, куки/localStorage/cache персистятся) + applyStealth +
   согласованные locale/UA/viewport.
3. **Поведенческая имитация** (`app/hh/human.ts`) — humanDelay, mouseMove, scroll,
   humanPretend (имитация живого курсора перед действиями).
4. **Парсеры** (`app/hh/parsers.ts`) — чистые функции на cheerio:
   parseSearchResults, parseVacancyDetail, extractExternalId, parseSalary.
   Селекторы изолированы в `app/hh/selectors.ts`.
5. **Фильтр** (`app/hh/filter.ts`) — бинарный include/exclude → matched/rejected
   (exclude приоритетнее; include пустой → проходит).
6. **Оркестратор** (`app/hh/collect.ts`) — цикл сбора: страницы поиска → карточки
   → детальные (с задержками 3–7с) → фильтр → запись (идемпотентно через
   onConflictDoNothing). Детект капчи → `HhCaptchaError` (graceful exit).
7. **Таблица `search_profiles`** (миграция 0001) — критерии поиска (несколько
   профилей): query, areas, employment_types, include/exclude_keywords, min_salary.
8. **Репозиторий `search_profiles`** — CRUD + DTO с zod-парсингом JSON-массивов.
9. **CLI-скрипты:** `hh:login`, `hh:collect`, `hh:seed`, `hh:stealth-check`
   (все standalone tsx, `.env` грузится через общий `scripts/_env.ts`).

## Acceptance — автотесты зелёные

- ✅ `npm run typecheck` — без ошибок.
- ✅ `npm test` — **55/55** (smoke 3, resume 12, ai-zai 10, generate 5,
  hh-parsers 12, hh-filter 8, hh-collect 5).
- ✅ `playwright` (1.61.1) + `cheerio` (1.2.0) в dependencies; chromium установлен.
- ✅ Таблица `search_profiles` создана и мигрирована.
- ✅ `collectVacancies` записывает вакансии со status matched/rejected;
  дубли не пересоздаются (onConflictDoNothing).
- ✅ **Анти-детект уровень 2:** stealth-check подтвердил 4 маски
  (webdriver=undefined, plugins=5, chrome.runtime, languages).
- ✅ Анти-лимиты (задержки) + детект капчи (тестами).

## ✅ Stealth-check пройден (2026-07-10)

| Признак | Результат | Статус |
|---------|-----------|--------|
| navigator.webdriver | undefined | ✅ скрыт |
| navigator.languages | ru-RU,ru,en-US,en | ✅ |
| navigator.plugins | 5 | ✅ (headless = 0) |
| window.chrome.runtime | object | ✅ (headless не имеет) |
| WebGL vendor | "Google Inc. (NVIDIA)" | ✅ реальный (намеренно не маскируется) |

## ⏳ Ручной smoke — ОТЛОЖЕН (до следующей сессии)

Реальный логин + сбор не прогонялись (требует ручного логина пользователя).
Команды для прогона при возвращении:

```bash
# 0. (уже выполнено) seed создал source=1, profile=1
npm run hh:seed

# 1. Логин — откроется окно браузера, залогиньтесь вручную (капча/2FA).
#    Сессия сохранится в data/hh-profile.
npm run hh:login

# 2. Сбор 3 вакансий (headless, переиспользует сессию):
npm run hh:collect -- --source=1 --profile=1 --max=3

# 3. Проверка БД (должны появиться вакансии со status matched/rejected):
sqlite3 data/job_hunter.sqlite "SELECT id,title,status FROM vacancies;"

# Если капча:
npm run hh:login   # повторный логин
# Если бан — снизить частоту (увеличить DETAIL_DELAY_MS в collect.ts) или эскалация до Camoufox.
```

**Что проверить в smoke:**
- Селекторы hh (`app/hh/selectors.ts`) — если парсинг пуст, править там.
  (Автотесты на фикстурах зелёные, но реальные селекторы могут отличаться.)
- `isLoggedIn` детект (селектор `[data-qa="mainmenu_myResumes"]`) — уточнить.
- Реальный статус matched/rejected на живых вакансиях.
- Капча/бан при первом прогоне.

## Known limitations / решения

- **WebGL НЕ маскируется.** Реальный GPU-отпечаток (NVIDIA через ANGLE) —
  правдоподобный десктоп, не headless-маркер. Подмена на Intel = антипаттерн.
  См. STATE.md (фаза 5).
- **Уровень 2 ≠ полная скрытность.** Не защищает от TLS/JA3, глубокого
  behavioural-анализа. Достаточно для hh + single-user. Эскалация — Camoufox
  (анти-детект браузер) в отдельной фазе.
- **UI для search_profiles отсутствует** — профили создаются через `hh:seed`
  (hardcoded Backend Node.js) или БД напрямую. UI — фаза 10 (review-ui) или позже.
- **Очередь/планировщик** — фаза 12. Здесь синхронный CLI.
- **Селекторы хрупкие** — изолированы в `selectors.ts`, меняются правкой одного
  файла. Тесты на фикстурах не поймают слом реального hh → smoke-проверка.
- **area/employment маппинг** — areas хранят id hh (1=Москва, 2=СПб).
  employment: full/part/probation/project. Захардкожено в collect.ts.

## Риски (для ручного smoke)

1. **Селекторы hh** могут не совпасть с фикстурами → парсинг пуст.
   Лечится правкой `selectors.ts`.
2. **`launchPersistentContext` + кириллица в cwd** — проверить в smoke
   (рабочий стол). Запас: `PLAYWRIGHT_BROWSERS_PATH`.
3. **Капча/бан** при первом прогоне — повторный логин или снижение частоты.

## Ссылки

- Файлы: `app/hh/` (6 модулей), `app/db/repositories/search_profiles.ts`,
  `scripts/{hh-login,collect-hh,seed-hh,stealth-check,_env}.ts`,
  `tests/fixtures/hh-*.html`.
- Решения в STATE.md: фаза 5 (5 записей — объём/сессия/критерии/запуск/анти-детект + WebGL).
