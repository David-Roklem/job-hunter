---
phase: 05
plan: source-hh
status: planned
created: 2026-07-10
must_haves:
  truths:
    - "Сбор вакансий hh.ru через Playwright (НЕ официальный API — от него отказались из-за OAuth, решение в STATE.md)."
    - "Анти-детект уровень 2: ручные init-scripts (navigator.webdriver=false, window.chrome, navigator props, webgl, plugins) + поведенческая имитация + persisted context. БЕЗ устаревших playwright-extra/stealth (2023, несовместимы с Playwright 1.61)."
    - "storageState (куки+localStorage) персистится в data/hh-session.json. Первый запуск — ручной логин в headed-режиме, далее headless."
    - "Запуск — standalone CLI scripts/collect-hh.ts (не RR action): сессия долгая (~минуты), не для HTTP."
    - "Бинарный include/exclude фильтр при сборе → vacancy.status = 'matched' | 'rejected'. НЕ скоринг (matcher 08). НЕ авто-отклик (apply-hh 11)."
    - "Парсим список (search results) + детальные страницы (для key_skills/тегов, нужных фильтру). cheerio для парсинга HTML."
    - "Дедупликация вакансий: UNIQUE(source_id, external_id) уже в схеме (фаза 02). external_id = hh vacancy id из URL."
    - "Критерии — новая таблица search_profiles (несколько профилей под роли). source.config хранит привязку: какой профиль к какому source."
    - "Мок Playwright (vi.mock) в автотестах; ручной smoke с реальным hh отдельно (нужен логин)."
---

# Plan: 05 — source-hh

## Goal

Первый источник вакансий: автоматический сбор с hh.ru через Playwright с
сохранением сессии (storageState), парсингом списка и детальных страниц,
бинарной фильтрацией include/exclude под профили критериев и записью в БД
(с дедупликацией). Даёт matcher'у (08) и draft-generator'у (09) реальные данные.

**Режим:** single-user локальный. Сбор запускается вручную (CLI) или
планировщиком (фаза 12). Логин — один раз вручную (капча/2FA), далее куки
переиспользуются.

## Не-цели (out of scope)

- **Авто-отклик** на hh.ru (заполнение формы отклика) — фаза 11 (apply-hh).
- **Полный скоринг** вакансия↔резюме (match_score 0–100) — фаза 08 (matcher).
  Здесь только бинарный matched/rejected по include/exclude ключевым словам.
- **UI** для редактирования search_profiles — фаза 10 (review-ui) или позже.
  Пока профили создаются в БД напрямую / seed-скриптом.
- **Очередь задач / планировщик** (jobs table уже есть, но collect_vacancies
  job запускается планировщиком в фазе 12). Здесь — синхронный CLI-вызов.
- **Официальный HH API** — отказались (OAuth-бюрократия), см. STATE.md.

## Background / референсы

- **Стиль feature-модуля** — `app/resumes/` (фаза 03), `app/ai/` (фаза 04):
  feature-код в `app/<feature>/`, обращается к данным через репозитории.
- **Стиль репозитория** — `app/db/repositories/sources.ts` (эталон) +
  `vacancies.ts` (CreateVacancyInput: source_id, external_id, company_id,
  title, description, salary_from/to, currency, location, employment_type,
  url, raw, collected_at).
- **Дедупликация** — `vacancies` имеет UNIQUE(source_id, external_id);
  `vacanciesRepo.create` использует onConflictDoNothing (фаза 02).
- **ENUM'ы:** sourceKinds=["hh","company","telegram"]; employmentTypes=
  ["full","part","contract","project"]; vacancyStatuses=["new","matched",
  "applied","rejected","closed"]. Фильтр выставляет matched/rejected.
- **Тест-эталон** — `tests/resume-templates.test.ts` (vi.mock + in-memory
  SQLite + migrate).
- **Smoke-эталон** — `scripts/smoke-zai.ts` (фаза 04): standalone tsx-скрипт,
  .env грузится вручную.
- **HH структура (для Playwright, не API):** поиск — `hh.ru/search/vacancy`;
  external_id вакансии — в URL (`/vacancy/<id>`); key_skills — на детальной
  странице. Возможна капча (детектить и граcceful-exit).

## Решения (из discuss)

1. **Объём:** только сбор вакансий (без отклика, без скоринга).
2. **Сессия:** storageState в `data/hh-session.json` (headed ручной логин → headless reuse).
3. **Парсинг:** список + детальные страницы (теги/навыки для фильтра).
4. **Запуск:** CLI `scripts/collect-hh.ts`.
5. **Фильтр:** бинарный include/exclude → vacancy.status matched/rejected.
6. **Критерии:** таблица `search_profiles` (несколько профилей).
7. **Тесты:** vi.mock Playwright + ручной smoke.

## Steps

### 1. Зависимости — `package.json`

```bash
npm install playwright cheerio
```

- `playwright` (НЕ `@playwright/test` — это для e2e-тестов; нам нужна библиотека автоматизации).
- `cheerio` — server-side парсинг HTML (без браузера, тестируемо).
- Браузеры: `npx playwright install chromium` (один, не все три — экономия места).

В `package.json` добавить скрипты:
```json
"hh:login": "tsx scripts/hh-login.ts",
"hh:collect": "tsx scripts/collect-hh.ts",
"hh:stealth-check": "tsx scripts/stealth-check.ts"
```

**Acceptance:** `playwright` + `cheerio` в dependencies; chromium установлен; typecheck чистый.

### 2. Миграция: таблица `search_profiles` — `app/db/schema.ts` + `drizzle/`

Новая таблица для критериев поиска (несколько профилей под роли):

```ts
export const searchProfiles = sqliteTable("search_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),                  // "Backend", "Frontend", ...
  // Текст запроса на hh (как в строке поиска).
  query: text("query").notNull(),                // "Node.js backend"
  // Регионы/города (текст — hh area names, маппится в URL). Массив → JSON.
  areas_json: text("areas_json").notNull().default("[]"),
  // Допустимые типы занятости (наш enum employmentTypes). Массив → JSON.
  employment_types_json: text("employment_types_json").notNull().default("[]"),
  // Ключевые слова include: вакансия подходит, если есть в title/desc/skills.
  include_keywords_json: text("include_keywords_json").notNull().default("[]"),
  // Ключевые слова exclude: вакансия отбрасывается, если есть.
  exclude_keywords_json: text("exclude_keywords_json").notNull().default("[]"),
  min_salary: integer("min_salary"),
  is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});
```

+ relation: searchProfiles не ссылается на sources (профиль может применяться
  к нескольким source через их config). Привязка profile→source живёт в
  `sources.config_json = { search_profile_id: <id> }`.

Сгенерировать миграцию (`npm run db:generate`) + применить (`npm run db:migrate`).

**Acceptance:** таблица создана; миграция применена; typecheck чистый.

### 3. Репозиторий `search_profiles` — `app/db/repositories/search_profiles.ts`

Паритет с `sources.ts`. DTO с распарсенными JSON-массивами (через zod):

```ts
const stringArray = z.array(z.string());
const employmentTypeArray = z.array(employmentTypeSchema);

export type SearchProfileDTO = {
  id: number; name: string; query: string;
  areas: string[]; employment_types: EmploymentType[];
  include_keywords: string[]; exclude_keywords: string[];
  min_salary: number | null; is_active: boolean;
  created_at: Date; updated_at: Date;
};
// create / findById / list / update / remove + barrel-export searchProfilesRepo.
```

**Acceptance:** CRUD работает; DTO парсит JSON; typecheck чистый.

### 4. Анти-детект: stealth init-scripts — `app/hh/stealth.ts`

Ручные evasion-патчи через `page.addInitScript` (ядро любого stealth-плагина,
без устаревших зависимостей). Каждый скрипт патчит отпечаток ДО загрузки страницы:

```ts
// app/hh/stealth.ts
import type { BrowserContext } from "playwright";

/** Применить все evasion-патчи к context (addInitScript). */
export async function applyStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript(maskWebDriver);
  await context.addInitScript(maskChromeRuntime);
  await context.addInitScript(maskNavigatorProps);
  await context.addInitScript(maskWebGL);
  await context.addInitScript(maskPlugins);
}

// 1. navigator.webdriver = false (главный флаг headless/автоматизации).
const maskWebDriver = `Object.defineProperty(navigator, 'webdriver', { get: () => undefined });`;

// 2. window.chrome runtime (headless Chromium его не имеет → детект).
const maskChromeRuntime = `window.chrome = window.chrome || { runtime: {} };`;

// 3. navigator: languages, platform, vendor — согласовано с UA.
const maskNavigatorProps = `
  Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU', 'ru', 'en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5].map(i => ({name:'Plugin'+i})) });
`;

// 4. WebGL vendor/renderer (headless имеет характерный SwiftShader).
const maskWebGL = `
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(p) {
    if (p === 37445) return 'Intel Inc.';       // UNMASKED_VENDOR_WEBGL
    if (p === 37446) return 'Intel Iris OpenGL'; // UNMASKED_RENDERER_WEBGL
    return getParameter.call(this, p);
  };
`;

const maskPlugins = ``;  // (объединено в maskNavigatorProps выше)
```

**Дополнительно — на уровне context (не init-script):**
- `userAgent`: убрать суффикс HeadlessChrome (launchPersistentContext с реальным UA).
- `locale: 'ru-RU'`, `timezoneId: 'Europe/Moscow'`.
- `viewport` случайный из списка типичных десктопных.

**Проверка:** `scripts/stealth-check.ts` — открыть `https://bot.sannysoft.com/`,
снять отпечаток, вывести `navigator.webdriver`, кол-во plugins, webgl vendor.
Цель: webdriver=undefined, plugins>0, webgl=Intel. (Ручной diagnostic-скрипт.)

**Acceptance:** `applyStealth` применяется к context; stealth-check показывает
чистый отпечаток (вручную); typecheck чистый.

### 5. Playwright-сессия (persisted context + storageState) — `app/hh/session.ts`

Feature-модуль `app/hh/` (как `app/ai/`, `app/resumes/`).

Используем `launchPersistentContext` (реальный профиль, а не изолированный
newContext каждый раз — правдоподобнее с точки зрения fingerprint):

```ts
const PROFILE_DIR = path.join(process.cwd(), "data", "hh-profile");
// launchPersistentContext хранит куки/localStorage/cache в PROFILE_DIR.

export async function createContext(opts: { headed?: boolean }): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !opts.headed,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    viewport: randomViewport(),
    userAgent: DESKTOP_UA,  // без HeadlessChrome
  });
  await applyStealth(context);   // evasion init-scripts
  return context;
}

/** Проверить, залогинен ли (селектор аккаунта на hh). */
export async function isLoggedIn(page: Page): Promise<boolean> { ... }
```

**Примечание:** storageState-файл из исходного плана заменён на
launchPersistentContext — он покрывает то же (куки+localStorage персистятся)
+ cache/indexedDB (правдоподобнее). data/hh-profile в .gitignore.

**Acceptance:** функции экспортируются; typecheck чистый; (ручная проверка в smoke).

### 6. Логин-скрипт — `scripts/hh-login.ts`

Standalone tsx-скрипт (как smoke-zai): открывает headed-браузер на hh.ru/login,
ждёт пока пользователь залогинится (детект по селектору аккаунта).
session персистится автоматически через launchPersistentContext (data/hh-profile).

```ts
// 1. createContext({ headed: true }) — launchPersistentContext создаёт/переиспользует data/hh-profile.
// 2. page.goto("https://hh.ru/account/login").
// 3. console.log("Залогиньтесь в открывшемся браузере (с капчей/2FA).")
//    — poll isLoggedIn каждые 2с (до 5 минут).
// 4. await context.close() — куки/localStorage автоматически сохраняются в data/hh-profile.
// 5. console.log("Сессия сохранена в data/hh-profile").
```

**Acceptance:** скрипт запускается (`npm run hh:login`); после ручного логина
`data/hh-profile/` содержит куки (вручную в smoke).

### 7. Парсеры hh.ru — `app/hh/parsers.ts`

Чистые функции (без Playwright-зависимости в сигнатуре — принимают DOM-строку /
данные), чтобы тестироваться без браузера:

```ts
/** Распарсить HTML списка вакансий → массив карточек. */
export function parseSearchResults(html: string): ParsedVacancyCard[] {
  // cheerio (добавить dep) ИЛИ regex/DOMParser.
  // Карточка: title, company_name, salary_text, url (→ external_id), location.
}

/** Распарсить HTML детальной страницы → полное description + key_skills. */
export function parseVacancyDetail(html: string): { description: string; key_skills: string[] } { ... }

/** Извлечь external_id из URL вакансии (/vacancy/12345678 → "12345678"). */
export function extractExternalId(url: string): string | null { ... }

/** Нормализовать зарплату из текста ("100 000–150 000 руб." → {from,to,currency}). */
export function parseSalary(text: string): { from?: number; to?: number; currency?: string } { ... }
```

**Парсинг HTML:** использовать `cheerio` (добавить dep) — server-side DOM,
надёжнее regex и не требует браузера в тестах. Селекторы hh вынести в константы
(`app/hh/selectors.ts`) — они часто меняются, проще править в одном месте.

**Acceptance:** функции чистые, тестируемые; cheerio в deps; selectors изолированы.

### 8. Фильтр include/exclude — `app/hh/filter.ts`

```ts
import type { SearchProfileDTO } from "~/db/repositories/search_profiles";

export type VacancyForFilter = {
  title: string; description: string; key_skills: string[];
};

/** Бинарный фильтр: matched (подходит) | rejected (нет). */
export function filterVacancy(
  vacancy: VacancyForFilter,
  profile: SearchProfileDTO,
): "matched" | "rejected" {
  const haystack = [
    vacancy.title, vacancy.description, vacancy.key_skills.join(" "),
  ].join(" ").toLowerCase();

  // exclude имеет приоритет: если хоть одно exclude-слово есть → rejected.
  const hasExclude = profile.exclude_keywords.some((kw) =>
    haystack.includes(kw.toLowerCase()));
  if (hasExclude) return "rejected";

  // include: если заданы — нужно хотя бы одно совпадение; если не заданы — проходит.
  if (profile.include_keywords.length === 0) return "matched";
  const hasInclude = profile.include_keywords.some((kw) =>
    haystack.includes(kw.toLowerCase()));
  return hasInclude ? "matched" : "rejected";
}
```

**Acceptance:** чистая функция; exclude приоритетнее include; typecheck чистый.

### 9. Оркестратор сбора — `app/hh/collect.ts`

```ts
export type CollectOptions = {
  sourceId: number;            // source в БД (kind="hh")
  profileId: number;           // search_profile с критериями
  maxVacancies?: number;       // лимит для dev/анти-бана
  headless?: boolean;
};

/** Основной цикл сбора. Возвращает статистику. */
export async function collectVacancies(opts: CollectOptions): Promise<CollectStats> {
  const source = sourcesRepo.findById(opts.sourceId);
  const profile = searchProfilesRepo.findById(opts.profileId);
  // 1. createContext (headless по умолчанию).
  // 2. Цикл по страницам поиска hh.ru/search/vacancy?text=<query>&area=...&...
  //    - parseSearchResults(page.content())
  //    - для каждой карточки: если ещё не в БД (findByExternalId) →
  //      a) открыть детальную страницу (с задержкой!),
  //      b) parseVacancyDetail → description + key_skills,
  //      c) filterVacancy → matched/rejected,
  //      d) vacanciesRepo.create({...status}) — onConflictDoNothing для дублей.
  //    - задержка между запросами (random 3–7с) — анти-лимит.
  // 3. Детект капчи (селектор/URL) → graceful exit + понятная ошибка.
  // 4. Вернуть { collected, matched, rejected, duplicates, captcha }.
}
```

**Анти-лимиты + поведенческая имитация (часть анти-детекта уровня 2):**
- случайная задержка 3–7с между детальными страницами;
- human-like поведение перед кликом/загрузкой: `humanDelay()` (random),
  лёгкий `page.mouse.move()` к элементу, `scrollIntoViewIfNeeded`;
- рандомизация порядка посещения (не строго top→bottom);
- лимит `maxVacancies` (дефолт 20 для dev);
- детект капчи (URL `/checks/captcha` или селектор) → `HhCaptchaError` + graceful exit.

Хелперы поведения вынести в `app/hh/human.ts`: `humanDelay(page, minMs, maxMs)`,
`humanScroll(page)`, `humanMouseMove(page, selector)`. Тестируются моками.

**Acceptance:** функция оркестрирует сбор; записывает вакансии со статусом;
задержки; детект капчи; typecheck чистый.

### 10. CLI-скрипт сбора — `scripts/collect-hh.ts`

Standalone tsx (как smoke-zai, hh-login): грузит .env, читает sourceId/profileId
из аргументов (`tsx scripts/collect-hh.ts --source=1 --profile=1`), вызывает
`collectVacancies`, печатает статистику.

```ts
// args: --source=<id> --profile=<id> [--max=<n>] [--headed]
// .env вручную (как smoke-zai).
// console.log статистика: "Собрано 15 (matched 8, rejected 7), дублей 3".
```

**Acceptance:** `npm run hh:collect -- --source=1 --profile=1` работает (вручную).

### 11. Тесты (моки Playwright + чистые парсеры) — `tests/hh-*.test.ts`

**10a. `tests/hh-parsers.test.ts`** — чистые функции, без браузера:
- `extractExternalId`: URL → id; невалидный URL → null.
- `parseSalary`: "100 000–150 000 руб." → {from:100000,to:150000,currency:"RUB"};
  "от 80 000" → {from:80000}; "" → {}.
- `parseSearchResults`: фикстура HTML (сохранить как `tests/fixtures/hh-search.html`)
  → массив карточек с ожидаемыми полями.
- `parseVacancyDetail`: фикстура `tests/fixtures/hh-vacancy.html` → description + skills.

**10b. `tests/hh-filter.test.ts`** — чистая функция filterVacancy:
- include попадает → matched; include не попадает → rejected.
- exclude попадает → rejected (даже если include есть).
- include пустой → matched (если нет exclude).
- регистронезависимость.

**10c. `tests/hh-collect.test.ts`** — интеграционный, vi.mock playwright:
- мок `chromium.launch` → фиктивный page с заглушками content().
- seed: source + search_profile в in-memory БД.
- вызов collectVacancies → проверяем, что вакансии записаны со статусом matched/rejected.
- мок детекта капчи → бросок HhCaptchaError, ничего не записано.

**Acceptance:** все тесты зелёные; реальный браузер/сеть не дёргается.

### 12. Seed search_profile + ручной smoke

**11a. `scripts/seed-hh.ts`** (опционально) — создать source (kind="hh") и
search_profile для первого прогона. ИЛИ документировать в README, как создать
через существующие инструменты.

**11b. Ручной smoke** (документировать в SUMMARY, не автотест):
```bash
npm run hh:login          # ручной логин → data/hh-session.json
npm run hh:collect -- --source=1 --profile=1 --max=5
# проверить: в БД появились вакансии со статусами matched/rejected.
```

**Acceptance:** задокументированный путь; (прогон в конце фазы с реальным логином).

## Acceptance (общие для фазы)

- [ ] `npm run typecheck` — без ошибок.
- [ ] `npm test` — все тесты зелёные (существующие + hh-parsers + hh-filter + hh-collect).
- [ ] `playwright` + `cheerio` в dependencies.
- [ ] Таблица `search_profiles` создана и мигрирована.
- [ ] `searchProfilesRepo`, `sourcesRepo`, `vacanciesRepo` используются корректно.
- [ ] `collectVacancies` записывает вакансии со status matched/rejected; дубли не дублируются.
- [ ] **Анти-детект уровень 2:** applyStealth (init-scripts) + persisted context + поведенческая имитация (human-* хелперы). stealth-check показывает чистый отпечаток.
- [ ] Анти-лимиты (задержки) + детект капчи.
- [ ] Существующие фазы 03/04 не сломаны (UI resumes, ai-provider).
- [ ] Ручной smoke задокументирован (login → stealth-check → collect → проверка БД).

## Риски / открытые точки (решить при реализации)

1. **Селекторы hh меняются часто.** Вынести в `app/hh/selectors.ts`, фиксировать
   в SUMMARY, что при поломке парсинга править там. Фикстуры HTML в тестах
   зафиксируют ожидаемый формат — если селектор сломается, тесты (на фикстурах)
   всё равно зелёные, но реальный smoke поймает.
2. **Капча.** hh показывает капчу при подозрительной активности. Детектить по
   URL/селектору → `HhCaptchaError` + graceful exit (не падать, сообщить
   пользователю «нужен повторный логин» или снизить частоту). Решить точный
   детектор на шаге 8 (селектор капчи).
3. **cheerio vs DOMParser.** cheerio — server-side, без браузера, идеально для
   парсинга в тестах. Добавить dep (~легковесный). Альтернатива — regex (хрупко).
   Принять cheerio.
4. **Параметры поиска в URL.** hh использует `?text=`, `?area=` (id регионов),
   `?employment=` и т.д. Маппинг area-name → area-id хрупкий (id числовые на hh).
   Решение: в search_profile.areas хранить УЖЕ id (числа как строки) ИЛИ
   захардкодить таблицу популярных регионов. Решить на шаге 8 — начать с id.
5. **Задержки и maxVacancies.** Дефолты: 3–7с между детальными страницами,
   maxVacancies=20 (dev). Для прод (~100/день по vision) — фаза 12 (scheduler)
   настроит. Здесь — безопасные дефолты.
6. **Браузер Playwright в Windows/cyrillic-cwd.** Проверить, что chromium
   запускается из директории с кириллицей в пути (рабочий стол). Если проблема —
   PLAYWRIGHT_BROWSERS_PATH в env. Проверить на шаге 6 (hh-login smoke).
7. **Степень stealth vs реальность.** Уровень 2 (init-scripts + поведение) —
   защищает от простых бот-детекторов (navigator.webdriver, fingerprint-аномалии).
   НЕ защищает от продвинутых (TLS/JA3, продвинутый behavioural-анализ). Для hh.ru
   и single-user объёма (~100/день) достаточно. Если банят — эскалация до уровня 3
   (анти-детект браузер Camoufox) в отдельной фазе. Зафиксировать в SUMMARY.
