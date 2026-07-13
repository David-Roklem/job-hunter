---
phase: 06
plan: source-aggregators
status: planned
created: 2026-07-13
must_haves:
  truths:
    - "Фокус проекта СМЕЩЁН на международный/зарубежный рынок + hh.ru (vision.md обновлён 2026-07-13). Wellfound — первый зарубежный источник, НЕ противоречит vision."
    - "Wellfound (wellfound.com) — SPA (React), публичные job listings доступны без логина, но полный доступ/контакты требуют логина. Используем Playwright (НЕ fetch) — переиспользуем инфраструктуру hh (createContext, stealth, human)."
    - "Полное переиспользование инфраструктуры фазы 05: те же таблицы (vacancies, companies, sources), тот же include/exclude фильтр (filterVacancy), те же search_profiles, тот же collect-цикл (детект дубликатов → детальная → фильтр → onConflictDoNothing)."
    - "ENUM sourceKinds расширен: добавлено значение 'aggregator' (Wellfound и будущие агреграторы). Миграция 0002. Существующие sourceKinds=['hh','company','telegram'] остаются."
    - "Парсеры — чистые функции на cheerio, принимают HTML (от page.content()), тестируются на фикстурах без браузера (паттерн hh-parsers.test.ts). Селекторы изолированы в одном файле."
    - "Логин Wellfound — ручной (headed), паттерн hh:login (persistent context в data/wellfound-profile, куки персистятся). Сбор — headless. Детект залогиненности через селектор."
    - "Запуск — standalone CLI scripts/collect-wellfound.ts (НЕ RR action): Playwright-сессия долгая. Тесты: vi.mock playwright + cheerio-парсеры на фикстурах; ручной smoke включён в acceptance (с реальным Wellfound в этой сессии)."
    - "Анти-детект и задержки переиспользуются полностью (stealth.ts, human.ts) — Wellfound может иметь rate-limits/bot-детект. Профиль браузера ОТДЕЛЬНЫЙ (data/wellfound-profile) — не смешивать куки hh и Wellfound."
    - "Новый source.config хранит search_profile_id (как hh) + wellfound-specific опции (job_role slug, location, remote-only). Параметризуется через source.config_json."
---

# Plan: 06 — source-aggregators

## Goal

Второй источник вакансий: автоматический сбор с **Wellfound** (wellfound.com) —
первого зарубежного агрегратора после смены фокуса проекта на международный рынок.
Сбор через Playwright с переиспользованием инфраструктуры hh (анти-детект,
поведенческая имитация, persistent context), парсингом списка и детальных страниц,
бинарной фильтрацией include/exclude и записью в БД (с дедупликацией).

Wellfound — **React SPA**, поэтому чистый fetch не подходит (HTML пуст до рендера);
используем Playwright → `page.content()` после рендера → cheerio. Это первая
реализация «адаптивных селекторов» по roadmap: Wellfound служит образцом
aggregator-парсера, по которому позже добавляются другие площадки.

**Режим:** single-user локальный. Сбор запускается вручную (CLI) или планировщиком
(фаза 12). Логин — один раз вручную (Wellfound требует аккаунт для полного доступа),
далее куки переиспользуются.

## Не-цели (out of scope)

- **Другие агреграторы** (SuperJob, Хабр Карьера, rabota.ru и т.д.) — Wellfound
  здесь как единственный референс; остальные добавляются по тому же шаблону позже.
- **Карьерные страницы компаний** (у каждой своя вёрстка) — отдельный под-тип
  source kind, не в этой фазе. (Возможно, `sourceKinds` расширится значением
  `company` позже — оно уже в enum, но без реализации.)
- **Полный скоринг** вакансия↔резюме — фаза 08 (matcher). Здесь только бинарный
  matched/rejected по include/exclude (переиспользуем filter.ts из фазы 05).
- **Авто-отклик** на Wellfound — не планируется (Wellfound отклики сложнее hh,
  фокус авто-отклика — на hh, фаза 11). Здесь только сбор.
- **UI** для управления источниками/профилями — фаза 10 (review-ui) или позже.
  Пока source/profile создаются seed-скриптом или БД напрямую.
- **Очередь задач / планировщик** (фаза 12). Здесь — синхронный CLI.

## Background / референсы

- **Feature-модуль фазы 05** — `app/hh/` (эталон для нового `app/wellfound/`):
  - `session.ts` — `createContext({ headed })` → `chromium.launchPersistentContext`
    + `applyStealth`. Переиспользуем целиком, но с ОТДЕЛЬНЫМ profile dir.
  - `stealth.ts`, `human.ts` — переиспользуются без изменений.
  - `parsers.ts` — чистые cheerio-функции (эталон для wellfound/parsers.ts).
  - `selectors.ts` — изоляция селекторов в одном файле (эталон).
  - `filter.ts` — `filterVacancy(vacancy, profile)` → matched/rejected. Переиспользуем БЕЗ изменений.
  - `collect.ts` — orchestrator-цикл (эталон структуры wellfound/collect.ts).
- **Схема БД** (фаза 02):
  - `vacancies` UNIQUE(source_id, external_id); `vacanciesRepo.create` использует
    `onConflictDoNothing`. `external_id` для Wellfound — slug/id вакансии из URL.
  - `companies` — find-or-create по имени (фаза 05: `findOrCreateCompany`).
  - `sourceKinds = ["hh","company","telegram"]` — **расширяем** до `["hh","company","telegram","aggregator"]`.
  - `search_profiles` — переиспользуем (include/exclude, query). Wellfound-specific
    параметры (role slug, location) — в `sources.config_json`.
- **Репозитории** — `app/db/repositories/{sources,search_profiles,vacancies}.ts`.
- **Тест-эталон** — `tests/hh-parsers.test.ts` (cheerio на фикстурах, без браузера)
  + `tests/hh-collect.test.ts` (vi.mock playwright + in-memory SQLite).
- **CLI-эталон** — `scripts/{hh-login,collect-hh,seed-hh}.ts`.

## Решения (из discuss)

1. **Скоуп:** только aggregator-сайты (не карьерные страницы компаний).
2. **Референс:** Wellfound (wellfound.com) — единственный реализуемый парсер.
3. **Техника:** Playwright (переиспользование из фазы 05), НЕ fetch — Wellfound SPA.
4. **Переиспользование:** полное — те же БД-таблицы, filter.ts, search_profiles.
5. **Анти-детект:** полный (stealth + human + persistent context).
6. **Логин:** ручной (headed), паттерн hh:login. Отдельный profile dir.
7. **Ручной smoke:** включён в acceptance (в этой сессии).
8. **Source kind:** новое значение `aggregator` в enum + миграция 0002.

## Технические замечания

- **Wellfound — SPA.** `page.goto()` с `waitUntil: "domcontentloaded"` может
  отдать пустой shell. Нужен `waitUntil: "networkidle"` ИЛИ ожидание селектора
  карточки (`page.waitForSelector(WF_SELECTORS.search.vacancyCard)`). Это
  отличие от hh (там SSR, domcontentloaded достаточно).
- **URL вакансии Wellfound:** `wellfound.com/jobs/<id>-<slug>` → external_id =
  часть до `-` (например `1234567` из `1234567-senior-backend-engineer`).
- **Пагинация Wellfound:** бесконечный скролл или `?page=N`. Уточняется в smoke.
  Заглушка: пробуем `?page=N` (проще для Playwright), fallback — скролл.
- **Зарплата на Wellfound:** часто не указана (американский рынок, equity-only).
  `parseSalary` из hh не переиспользуем напрямую (русские паттерны «руб.», «от»);
  пишем `wellfound/parseSalary` под `$`, `k`, `K`, `equity`.
- **Локаль/UA браузера:** Wellfound — англоязычный, американский. Профиль
  браузера должен выглядеть как англоязычный пользователь (locale: "en-US",
  timezone: "America/New_York", UA тот же десктопный Chrome). Это ОТЛИЧАЕТСЯ от
  hh (ru-RU/Europe-Moscow). → Нужен параметризованный `createContext` с опцией
  locale/timezone, ИЛИ отдельный `createWellfoundContext`.

## Steps

### 1. Расширение ENUM + миграция — `app/db/schema.ts`, `drizzle/`

В `app/db/schema.ts`:

```ts
export const sourceKinds = ["hh", "company", "telegram", "aggregator"] as const;
```

Генерация миграции:

```bash
npm run db:generate    # создаст drizzle/0002_*.sql
npm run db:migrate     # применит
```

Миграция 0002 — `ALTER` ничего не требует (text enum в SQLite — это CHECK на
уровне Drizzle, не БД); drizzle-kit сгенерирует пустой/минимальный SQL.
Проверить: если миграция пустая, всё равно зафиксировать (для консистентности
chain) и применить.

**Acceptance:** `sourceKinds` содержит `"aggregator"`; typecheck зелёный;
`npm run db:migrate` применяет 0002 без ошибок.

### 2. Параметризация createContext — `app/hh/session.ts` (или новый общий модуль)

`createContext({ headed, locale?, timezone? })` — добавить опциональные
параметры с дефолтами `ru-RU` / `Europe-Moscow` (чтобы hh не сломался).
Wellfound передаст `locale: "en-US"`, `timezone: "America/New_York"`.

Альтернатива: вынести `createContext` в общий `app/browser/session.ts`
(переиспользуется hh + wellfound + будущими источниками). **Решение: вынести** —
это правильная абстракция, hh и wellfound оба переиспользуют.

```ts
// app/browser/session.ts
export type CreateContextOptions = {
  headed?: boolean;
  locale?: string;        // дефолт "ru-RU"
  timezone?: string;      // дефолт "Europe/Moscow"
  profileDir: string;     // ОБЯЗАТЕЛЬНЫЙ — каждый источник свой
};

export async function createContext(opts: CreateContextOptions): Promise<BrowserContext>;
export async function isLoggedIn(page: Page, markers: string[]): Promise<boolean>;
```

`app/hh/session.ts` → тонкая обёртка: `PROFILE_DIR` + дефолты ru-RU, экспортирует
`createContext` (для обратной совместимости с hh-login/collect) или hh переходит
на прямой импорт из `app/browser/session.ts`.

**Acceptance:** hh-скрипты (`hh:login`, `hh:collect`) работают без изменений;
typecheck зелёный; `stealth.ts`, `human.ts` импортируются из нового места
(или остаются в `app/hh/` и реэкспортируются — решение в реализации).

### 3. Wellfound-модуль — `app/wellfound/`

Структура (зеркало `app/hh/`):

- `app/wellfound/selectors.ts` — CSS-селекторы Wellfound (изолированы).
  Зафиксированы по состоянию на 2026-07; проверяются в smoke. Включает:
  - `search.vacancyCard`, `search.titleLink`, `search.companyName`,
    `search.location`, `search.salary` (если есть), `search.jobTags`.
  - `detail.description`, `detail.skills`, `detail.equity`.
  - `WF_SEARCH_URL = "https://wellfound.com/jobs"`.
  - `WF_LOGIN_URL = "https://wellfound.com/users/sign_in"`.
  - `isLoggedInMarkers` — селекторы залогиненного состояния.
  - `isBotBlockUrl(url)` — детект анти-бот страницы Wellfound (если есть).

- `app/wellfound/parsers.ts` — чистые cheerio-функции:
  - `parseSearchResults(html): { cards: ParsedVacancyCard[] }`.
  - `parseVacancyDetail(html): { description, key_skills, equity? }`.
  - `extractExternalId(url): string | null` — из `/jobs/<id>-<slug>`.
  - `parseSalary(text): { from?, to?, currency? }` — `$`, `k`/`K`, equity.
  - Типы: `ParsedVacancyCard`, `ParsedSearchResult`, `ParsedVacancyDetail`
    (совместимы с hh-аналогами по форме — `external_id`, `title`, `url`,
    `company_name`, `salary_text`, `location`).

- `app/wellfound/collect.ts` — orchestrator (зеркало `hh/collect.ts`):
  - `collectVacancies(opts: CollectOptions): Promise<CollectStats>`.
  - Цикл: страницы поиска (`?page=N`) → ожидание селектора (SPA!) → карточки →
    дедупликация (`vacanciesRepo.findByExternalId`) → детальная (с задержками
    из human.ts) → `parseVacancyDetail` → `filterVacancy` → find-or-create
    company → `vacanciesRepo.create` (onConflictDoNothing) → выставить status.
  - Параметры задержек переиспользуются (`DETAIL_DELAY_MS`, `PAGE_DELAY_MS`).
  - Детект блокировки/капчи → graceful exit с понятной ошибкой
    (`WellfoundBlockError`).
  - `CollectOptions`: `{ sourceId, profileId, maxVacancies?, headed?, maxPages? }`.
  - `CollectStats`: `{ collected, matched, rejected, duplicates, blocked }`.

**Acceptance:** модули существуют, экспортируют типизированные функции;
typecheck зелёный.

### 4. Seed для Wellfound — `scripts/seed-wellfound.ts`

Idempotent find-or-create:
- `source` kind=`aggregator`, name=`"Wellfound"`, config=`{ search_profile_id: <id>, job_role: "backend-engineer", location: "Remote" }`.
- `search_profile` name=`"Backend (Wellfound)"`, query=`"backend engineer"`,
  include/exclude под международный рынок (include: `["backend","node","python","golang","engineer"]`,
  exclude: `["frontend-only","intern"]`), employment_types=`["full"]`, areas=`[]`.

CLI: `npm run wellfound:seed`.

**Acceptance:** скрипт отрабатывает без ошибок; повторный запуск — idempotent.

### 5. Логин Wellfound — `scripts/wellfound-login.ts`

Зеркало `hh-login.ts`:
- headed-браузер, profile dir = `data/wellfound-profile`.
- `goto(WF_LOGIN_URL)`, poll `isLoggedIn` (markers из selectors.ts).
- Таймаут 5 минут на ручной логин (Wellfound может требовать email + capcha).
- Сообщение пользователю: «залогиньтесь вручную».

CLI: `npm run wellfound:login`.

**Acceptance:** открывает браузер на странице входа; корректно сообщает
результат (успех/таймаут).

### 6. Сбор Wellfound — `scripts/collect-wellfound.ts`

Зеркало `collect-hh.ts`:
- `npm run wellfound:collect -- --source=<id> --profile=<id> [--max=<n>] [--headed]`.
- Грузит .env, парсит аргументы, вызывает `collectVacancies`, печатает статистику.

CLI: `npm run wellfound:collect`.

**Acceptance:** скрипт парсит аргументы, вызывает orchestrator, печатает stats.

### 7. Фикстуры Wellfound — `tests/fixtures/`

- `wellfound-search.html` — страница выдачи (3–4 карточки, одна без компании,
  одна с equity-only). Селекторы приближены к реальным (уточняются в smoke).
- `wellfound-vacancy.html` — детальная страница (description + skills).

Фикстуры — синтетические (создаются вручную под селекторы), т.к. сохранять
реальный HTML Wellfound в репозиторий — риск (ToS, размер). Селекторы в
selectors.ts помечены «проверить в smoke».

**Acceptance:** фикстуры валидный HTML, покрывают happy path + edge cases.

### 8. Тесты парсеров — `tests/wellfound-parsers.test.ts`

Паттерн `hh-parsers.test.ts`:
- `extractExternalId`: `/jobs/1234567-senior-backend` → `"1234567"`; невалидный → null.
- `parseSalary`: `"$150k–$180k"` → `{from:150000, to:180000, currency:"USD"}`;
  `"$120K"`; `"equity-only"` → `{}`
- `parseSearchResults`: из фикстуры → 3 карточки; проверка полей; пустой HTML → `[]`.
- `parseVacancyDetail`: description + skills из фикстуры.

**Acceptance:** все кейсы зелёные.

### 9. Тесты фильтра Wellfound (переиспользование) — `tests/wellfound-filter.test.ts`

Лёгкий набор: подтверждает, что `filterVacancy` (из `app/hh/filter.ts`) работает
с wellfound-формой вакансии (title на англ., description, skills). 3–4 кейса
(matched/rejected по include/exclude). Это страховка, что переиспользование
корректно — сам filter.ts не дублируем.

**Acceptance:** кейсы зелёные; filter.ts не изменён.

### 10. Тесты collect-интеграции — `tests/wellfound-collect.test.ts`

Паттерн `hh-collect.test.ts`:
- vi.mock playwright (createContext → мок-страница, отдаёт фикстуры по URL).
- in-memory SQLite + migrate.
- `collectVacancies` записывает вакансии со status matched/rejected; дубли не
  пересоздаются; company find-or-create работает.

**Acceptance:** 4–5 кейсов зелёные; дедупликация подтверждена.

### 11. Скрипты в package.json

Добавить:
```json
"wellfound:seed": "tsx scripts/seed-wellfound.ts",
"wellfound:login": "tsx scripts/wellfound-login.ts",
"wellfound:collect": "tsx scripts/collect-wellfound.ts"
```

**Acceptance:** `npm run wellfound:<x>` запускается.

### 12. Ручной smoke (в acceptance)

Последовательность прогонов с реальным Wellfound:

1. `npm run wellfound:seed` → source + profile созданы (id зафиксировать).
2. `npm run wellfound:login` → ручной логин в headed-браузере (5 мин).
3. `npm run wellfound:collect -- --source=<id> --profile=<id> --max=3` → сбор.
4. Проверка БД: `SELECT id,title,status FROM vacancies WHERE source_id=<id>;`.
5. Если селекторы не совпали → правка `app/wellfound/selectors.ts` (фикстуры и
   тесты обновить соответственно), повторить сбор.

**Acceptance:** в БД появились ≥1 вакансии со status matched/rejected; селекторы
подтверждены на реальном Wellfound (либо зафиксировано, какие правки нужны).

## Acceptance (итог)

- ✅ `npm run typecheck` — без ошибок.
- ✅ `npm test` — все тесты (включая новые wellfound-*) зелёные; существующие не сломаны.
- ✅ `npm run db:migrate` — миграция 0002 применена; `sourceKinds` содержит `aggregator`.
- ✅ Модуль `app/wellfound/` (selectors, parsers, collect) + переиспользование filter.ts.
- ✅ CLI `wellfound:{seed,login,collect}` работают.
- ✅ Ручной smoke пройден: реальные вакансии Wellfound в БД (matched/rejected).
- ✅ Wellfound-profile отделён от hh-profile (data/wellfound-profile).
- ✅ Vision.md обновлён (международный фокус) — уже сделано в pre-plan коммите.

## Риски

1. **Селекторы Wellfound** — SPA, динамические class-имена (CSS modules/hashed).
   Хешированные классы ненадёжны → использовать data-атрибуты/роль/текст-паттерны
   где возможно, ИЛИ структурные селекторы. Уточняется в smoke, правится в selectors.ts.
2. **Анти-бот Wellfound** — Cloudflare/переборка. Если блокирует → увеличить
   задержки, убедиться что stealth применён. Запас: headed-режим для сбора (debug).
3. **Бесконечный скролл vs `?page=N`** — если Wellfound только скролл, нужна
   логика скролла+ожидания (humanScroll уже есть в human.ts).
4. **Логин Wellfound** — может требовать email-подтверждение/captcha. Если
   невозможно залогиниться, fallback: парсинг публичных listings без логина
   (проверить, что доступно без аккаунта).
5. **Wellfound ToS** — парсинг может нарушать ToS. single-user локально = низкий
   риск, но задокументировать в SUMMARY как known-limitation.
6. **Кириллица в cwd + persistent context** — риск из фазы 05; проверен в hh
   smoke, переиспользуем тот же профиль-дир для wellfound (проверить в smoke).

## Ссылки

- Переиспользуются: `app/hh/{session,stealth,human,filter,parsers,selectors}.ts`,
  `app/db/schema.ts` (vacancies, companies, sources), репозитории.
- Новое: `app/wellfound/` (3 модуля), `app/browser/session.ts` (общий),
  `scripts/{seed,wellfound-login,collect}-wellfound.ts`, `tests/fixtures/wellfound-*.html`,
  `tests/wellfound-{parsers,filter,collect}.test.ts`, миграция 0002.
- Решения в STATE.md: фаза 6 (Wellfound, фокус-сдвиг, переиспользование).
