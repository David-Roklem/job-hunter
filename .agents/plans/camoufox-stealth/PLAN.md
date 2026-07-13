---
plan: camoufox-stealth
type: insert  # между фазой 06 и 07; не отдельная ROADMAP-фаза
status: planned
created: 2026-07-13
parent_phase: 06
trigger: Cloudflare bot-detect заблокировал Playwright/Chromium на Wellfound (см. SUMMARY фазы 06)
must_haves:
  truths:
    - "Эскалация анти-детекта: переход с Chromium/Playwright на Camoufox (модифицированный Firefox, FingerprintForge на уровне движка C++) как ОБЩИЙ браузер-стек для всех источников (hh + wellfound)."
    - "Camoufox запускается напрямую: `import { Camoufox } from 'camoufox'` → `Camoufox({data_dir, headless, humanize:true, geoip:true, locale})` возвращает BrowserContext (persistent при наличии data_dir). Эквивалент playwright launchPersistentContext."
    - "geoip:true — Camoufox сам вычисляет timezone/locale/country по IP и выставляет согласованно. Убирает ручные timezoneId, убирает рассогласование timezone vs IP-геолокации."
    - "app/hh/stealth.ts УДАЛЯЕТСЯ ПОЛНОСТЬЮ (applyStealth + 5 init-scripts). Camoufox покрывает всё нативно на уровне движка; ручные патчи — Chromium-specific и конфликтуют с fingerprint-генератором."
    - "app/hh/human.ts ЧАСТИЧНО: humanDelay + humanScroll остаются (поведенческий паттерн, не fingerprint), humanMouseMove убирается (дублирует Camoufox humanize через BrowserForge). humanPretend пересобирается без mousemove."
    - "Acceptance = реальный smoke ОБЯЗАТЕЛЕН: wellfound:login НЕ блокируется Cloudflare + collect-wellfound собирает >=1 вакансию + hh:login работает. Главный критерий успеха (в отличие от best-effort в фазе 06)."
    - "Установка: npm-скрипт camoufox:fetch (npx camoufox fetch) скачивает Firefox ~100MB + GeoIP-базу; документация в README. Запуск вручную один раз после npm install."
    - "Тесты: vi.mock('camoufox') вместо vi.mock('playwright'). Новые тесты createContext (проверка передачи geoip/headless/data_dir) + human (humanMouseMove убран, delay/scroll остались, applyStealth не вызывается). Существующие hh/wellfound collect-тесты обновляются под новый mock."
    - "app/hh/collect.ts и app/wellfound/collect.ts НЕ МЕНЯЮТСЯ (работают с BrowserContext/Page, не с запуском браузера). Только убрать вызовы humanMouseMove/humanPretend→mousemove."
---

# Plan: camoufox-stealth

Эскалация анти-детекта после Cloudflare-блока Wellfound'а в фазе 06.
Замена ядра браузерного движка: **Chromium/Playwright → Camoufox (Firefox-based)**
как общий стек для всех источников. Цель — пройти Cloudflare bot-detect.

## Goal

Перевести `app/browser/session.ts` с `chromium.launchPersistentContext` + ручных
stealth init-scripts на **Camoufox** (`Camoufox({data_dir, headless, humanize, geoip, locale})`).
Удалить `app/hh/stealth.ts` целиком, почистить `app/hh/human.ts` (убрать
`humanMouseMove`). Реальный smoke против Wellfound (login + collect) и hh (login)
**обязателен** для закрытия плана — это проверка, что эскалация решает bot-detect.

## Steps

### Step 1 — Dependencies + install workflow
- `npm install camoufox` (npm-пакет `camoufox@^0.1.19`, exposes `Camoufox`, `launchOptions`).
- Добавить npm-скрипт `"camoufox:fetch": "camoufox fetch"` в `package.json` (скачивает
  модифицированный Firefox ~100MB + GeoIP-базу MaxMind; требуется один раз после install).
- НЕ postinstall-хук (явный скрипт — предсказуемо, не замедляет каждый install).
- **Smoke-действие в этой сессии:** запустить `npm run camoufox:fetch` → убедиться, что
  Firefox скачался в кеш Camoufox. Если не качается (РФ-сеть) — fallback: запустить под VPN.
- Commit: `feat(camoufox-1): add camoufox dep + camoufox:fetch script`.

### Step 2 — Rewrite `app/browser/session.ts`
- Заменить импорт: `import { chromium } from "playwright"` → `import { Camoufox } from "camoufox"`.
- Убрать импорт `applyStealth` из `~/hh/stealth`.
- Убрать `DESKTOP_UA` (Camoufox сам генерирует fingerprint с UA через BrowserForge).
- Убрать `VIEWPORTS`/`randomViewport` (Camoufox генерирует screen/window из fingerprint).
- `createContext({profileDir, headed, locale})`:
  ```ts
  const ctx = await Camoufox({
    data_dir: opts.profileDir,        // persistent context (наш profileDir)
    headless: !opts.headed,            // дефолт false → Camoufox headed по умолчанию
    humanize: true,                    // реалистичные движения курсора (BrowserForge)
    geoip: true,                       // авто timezone/locale/country по IP
    locale: opts.locale,               // языковой интерфейс (ru-RU для hh, en-US для wellfound)
  });
  return ctx as BrowserContext;
  ```
- **Убрать `timezone` из `CreateContextOptions`** — больше не нужен (`geoip:true` берёт на себя).
  Обёртки `app/hh/session.ts`/`app/wellfound/session.ts` перестают передавать `timezone`.
- `isLoggedIn` не меняется.
- Commit: `feat(camoufox-2): rewrite createContext to use Camoufox (geoip + humanize)`.

### Step 3 — Delete `app/hh/stealth.ts`, clean `app/hh/human.ts`
- **Удалить `app/hh/stealth.ts`** целиком (applyStealth + maskWebDriver + maskChromeRuntime
  + maskNavigatorProps + maskWebGL + maskPermissions). Camoufox покрывает нативно.
- **`app/hh/human.ts`:**
  - Оставить: `humanDelay`, `humanScroll`.
  - **Удалить: `humanMouseMove`.**
  - Пересобрать `humanPretend`: `humanScroll` + `humanDelay` (без mousemove).
- Проверить потребителей: `grep -rn "humanMouseMove\|humanPretend\|applyStealth" app/ scripts/`.
  - `app/hh/collect.ts`, `app/wellfound/collect.ts`: заменить `humanPretend` на пересобранный
    (без mousemove), убрать прямые `humanMouseMove`.
- Commit: `refactor(camoufox-3): delete stealth.ts, prune human.ts (remove humanMouseMove)`.

### Step 4 — Update source session wrappers
- `app/hh/session.ts`: убрать `timezone: "Europe/Moscow"` из вызова `createContext`
  (geoip берёт на себя). `locale: "ru-RU"` оставить (русский интерфейс hh).
- `app/wellfound/session.ts`: убрать `timezone: "America/New_York"`. `locale: "en-US"` оставить.
- `CreateContextOptions.timezone` удалить из типа (Step 2).
- Commit: `refactor(camoufox-4): drop manual timezone from hh/wellfound sessions (geoip)`.

### Step 5 — Update tests (mocks)
- **`tests/hh-collect.test.ts`, `tests/wellfound-collect.test.ts`:**
  - `vi.mock("playwright", ...)` → `vi.mock("camoufox", ...)` если мокается на уровне session,
    ИЛИ оставить мок `~/browser/session` (как сейчас) — проверить, какой уровень мокается.
  - Мок `createContext` возвращает тот же fake `{ newPage, close }` (контракт не изменился).
- **Новый `tests/browser-session.test.ts`:**
  - `vi.mock("camoufox")` → проверить, что `createContext` вызывает `Camoufox` с правильными
    опциями: `data_dir` = переданный profileDir, `headless` = `!headed`, `humanize: true`,
    `geoip: true`, `locale` передан.
  - Проверить ошибку при пустом `profileDir`.
- **Новый/расширенный `tests/hh-human.test.ts`:**
  - `humanMouseMove` НЕ экспортируется (убран).
  - `humanDelay`, `humanScroll`, `humanPretend` экспортируются и работают.
- **Проверить:** `grep -rn "applyStealth\|stealth" tests/` — тестов на stealth не должно
  остаться (если были — удалить вместе с файлом).
- Commit: `test(camoufox-5): mock camoufox in collect tests; add session+human tests`.

### Step 6 — README: install instructions
- Секция «Установка» / «First run»: после `npm install` выполнить `npm run camoufox:fetch`
  (скачивает браузер). Без этого `npm run wellfound:login` / `hh:login` упадут с ошибкой
  «browser not found».
- Упомянуть: для обхода Cloudflare при РФ-IP — запуск под VPN (Camoufox + geoip берёт IP
  шлюза, fingerprint сходится).
- Commit: `docs(camoufox-6): README — camoufox:fetch install step + VPN note`.

### Step 7 — Manual smoke (ACCEPTANCE GATE, обязательно)
Это главный критерий успеха плана. Запускается вручную в этой сессии.

1. `npm run camoufox:fetch` → Firefox скачан.
2. `npm run wellfound:login` → открыть headed Camoufox, залогиниться вручную.
   - **УСПЕХ:** нет страницы «Access is temporarily restricted / bot activity».
   - **ПРОВАЛ:** если Cloudflare снова блокирует → план НЕ закрыт, разбираемся
     (возможно: VPN обязателен, или нужны Camoufox-опции `addons`/`proxy`).
3. `npm run wellfound:collect -- --source=2 --profile=2 --max=3` → headless сбор.
   - **УСПЕХ:** >=1 вакансия в БД (`SELECT count(*) FROM vacancies WHERE source_id=2`).
   - При расхождении селекторов — правка `app/wellfound/selectors.ts` + фикстуры.
4. `npm run hh:login` → повторить для hh (убедиться, что Camoufox не сломал рабочий hh).
5. Все автотесты зелёные: `npm test && npm run typecheck`.
- Если smoke пройден → SUMMARY + STATE/ROADMAP (вставить строку про camoufox-stealth
  между фазой 06 и 07). Если нет — зафиксировать в SUMMARY как blocker, НЕ закрывать план.

## Acceptance

- [ ] `camoufox` в `package.json` deps, `camoufox:fetch` скрипт работает (браузер скачан).
- [ ] `app/browser/session.ts` использует `Camoufox({data_dir, headless, humanize:true, geoip:true, locale})`, `applyStealth` не вызывается.
- [ ] `app/hh/stealth.ts` удалён, `grep -rn applyStealth app/` пуст.
- [ ] `app/hh/human.ts`: `humanMouseMove` убран, `humanDelay`/`humanScroll`/`humanPretend` остались.
- [ ] `timezone` убран из `CreateContextOptions` и из hh/wellfound session wrappers.
- [ ] `app/hh/collect.ts` + `app/wellfound/collect.ts` работают без `humanMouseMove`.
- [ ] `npm test` зелёные (старые тесты обновлены под мок camoufox + новые session/human тесты).
- [ ] `npm run typecheck` чистый.
- [ ] README описывает `camoufox:fetch` + VPN-заметку.
- [ ] **ГЛАВНОЕ — реальный smoke:**
  - `wellfound:login` не блокируется Cloudflare (нет «bot activity» страницы),
  - `collect-wellfound` собирает >=1 вакансию в БД,
  - `hh:login` работает (Camoufox не сломал hh).

## Risks

1. **Cloudflare всё равно блокирует Camoufox** — главный риск. Если `geoip:true` +
   humanize недостаточно: добавить `addons: [DefaultAddons.UBO]` (uBlock Origin —
   режет ads/трекеры, меняет fingerprint-поверхность) или `proxy` (VPN обязателен).
   Worst case: Camoufox + Cloudflare проигрывает → пробовать patchright (Chromium drop-in)
   или отложить smoke до proxy-инфраструктуры.
2. **`camoufox:fetch` не качается в РФ-сети** — Firefox-бинарник и MaxMind GeoIP
   тянутся с зарубежных хостов. Fallback: запустить под VPN один раз (браузер кешируется).
3. **Camoufox API несовместим** — пакет `camoufox@0.1.19` молодой (2 stars, обновлён
   2025-12). Если `Camoufox()` ведёт себя не как ожидается → fallback на `launchOptions()`
   + `firefox.launchPersistentContext` из playwright-core (см. CONTEXT.md, deferred).
4. **locale vs geoip конфликт** — мы передаём `locale:"ru-RU"` для hh, но `geoip:true`
   может отдать другой locale по IP. Проверить в smoke: если Camoufox игнорирует наш locale
   при geoip — оставить только geoip (решить эмпирически).
5. **Существующие hh-тесты падают** — мок playwright был завязан на `chromium`. После
   замены на мок camoufox контракт `createContext → BrowserContext` тот же, но проверить
   все 5 hh-collect + 7 wellfound-collect тестов.

## Out of scope

- Camoufox `launchServer` (websocket-сервер) — single-user локально, не нужно.
- BrowserForge кастомные fingerprints — избыточно, geoip+random достаточно.
- Proxy-ротация — сейчас системный VPN. Отдельная задача, если понадобится.
- `block_images`/`block_webgl` оптимизации — не сейчас.
- Фаза 07 (source-telegram) — следующий план после этого.
