# camoufox-stealth — CONTEXT (обсуждение завершено 2026-07-13)

> Insert-план между фазой 06 (source-aggregators) и 07 (source-telegram).
> Эскалация анти-детекта, вызванная Cloudflare bot-detect'ом Wellfound'а
> в фазе 06 (см. SUMMARY фазы 06).

## Domain

Эскалация анти-детекта: переход с Chromium/Playwright на **Camoufox**
(модифицированный Firefox с FingerprintForge на уровне движка C++) как
**общий браузер-стек для всех источников** (hh + wellfound). Заменяет ядро
`app/browser/session.ts`: вместо `chromium.launchPersistentContext` +
`applyStealth` (ручные init-scripts) используется
`Camoufox({data_dir, headless, humanize:true, geoip:true, locale}) → BrowserContext`.

`geoip:true` автоматически вычисляет timezone/locale/country по IP
(согласованный fingerprint, убирает ручные `timezoneId`, убирает
рассогласование timezone vs IP-геолокации, которое было при ручном
`Europe/Moscow`).

Полностью удаляется `applyStealth` (Chromium-патчи не нужны во Firefox,
конфликтуют с Camoufox fingerprint-генератором). `human.ts`: оставляем
`humanDelay` + `humanScroll`, убираем `humanMouseMove` (дублирует Camoufox
`humanize` через BrowserForge).

**Acceptance: реальный smoke обязателен** — `wellfound:login` не блокируется
Cloudflare + `collect-wellfound` собирает ≥1 вакансию, `hh:login` работает.
В отличие от фазы 06 (где smoke был best-effort), здесь это главный критерий
успеха эскалации.

## Decisions

| Category | Choice | Rationale |
|----------|--------|-----------|
| **stealth.ts судьба** | Удалить полностью — `applyStealth` не вызывается, файл `app/hh/stealth.ts` удаляется | Camoufox — модифицированный Firefox (FingerprintForge на уровне C++). Ручные init-scripts (navigator.webdriver, chrome.runtime, plugins, WebGL, permissions) — Chromium-патчи: не нужны во Firefox и конфликтуют с fingerprint-генератором Camoufox. |
| **human.ts обработка** | Оставить `humanDelay` + `humanScroll`, убрать `humanMouseMove` (`humanPretend` пересобрать без mousemove) | `humanDelay` — паттерн взаимодействия (не fingerprint), нужен. `humanMouseMove` дублирует Camoufox `humanize:true` (BrowserForge генерирует движения курсора), наши 5-step move хуже/конфликтуют. `humanScroll` оставляем — полезный поведенческий сигнал. |
| **geoip стратегия** | `geoip: true` — автоопределение timezone/locale/country по IP | Camoufox сам вычисляет по IP и выставляет согласованно. Под VPN — IP шлюза, всё сходится. Убирает ручные `timezoneId`, убирает рассогласование. |
| **API Camoufox** | `Camoufox({data_dir, headless, humanize, geoip, locale}) → BrowserContext` напрямую | Простейший API, persistent context нативно через `data_dir` (эквивалент нашего `profileDir`). Меньше кода. Возвращает `BrowserContext` при наличии `data_dir` — совместимо с текущим типом `createContext`. |
| **Acceptance smoke** | Реальный smoke **обязателен** для закрытия фазы | Вся суть эскалации — пройти Cloudflare. Если smoke опять блокируется, цель не достигнута, фаза не закрыта. Главный критерий успеха (в отличие от best-effort в фазе 06). |
| **Установка браузера** | npm-скрипт `camoufox:fetch` (`npx camoufox fetch`) + README | Camoufox требует скачать Firefox (~100MB) + GeoIP-базу после install. Явный скрипт + README — предсказуемо, не замедляет каждый install (в отличие от postinstall), не удивляет на CI. Запуск один раз вручную. |
| **Тесты** | Покрыть `createContext` + `human` новыми тестами, обновить существующие collect-тесты под `vi.mock('camoufox')` | `vi.mock('camoufox')` вместо `vi.mock('playwright')`. Новые тесты: createContext передаёт `geoip/headless/data_dir`, `humanMouseMove` убран, `humanDelay/humanScroll` остались, `applyStealth` не вызывается. Без реального браузера в тестах. |

## Codebase context (reusable assets)

- **`app/browser/session.ts`** — ЯДРО замены. `createContext(profileDir,headed,locale,timezone)` → `chromium.launchPersistentContext` + `applyStealth`. Меняется на `Camoufox({data_dir:profileDir, headless:!headed, humanize:true, geoip:true, locale})`. `isLoggedIn` не меняется.
- **`app/hh/stealth.ts`** — УДАЛЯЕТСЯ полностью.
- **`app/hh/human.ts`** — ЧАСТИЧНО: `humanDelay`+`humanScroll` остаются, `humanMouseMove` убирается, `humanPretend` пересобирается.
- **`app/hh/session.ts` / `app/wellfound/session.ts`** — тонкие обёртки, вызов `createContext` упрощается (geoip убирает ручной timezone; locale оставляем для языкового интерфейса).
- **`app/hh/collect.ts` / `app/wellfound/collect.ts`** — НЕ МЕНЯЮТСЯ (работают с `BrowserContext`/`Page`). Проверить вызовы `humanMouseMove`/`humanPretend` и убрать mousemove.
- **`tests/hh-collect.test.ts` / `tests/wellfound-collect.test.ts`** — `vi.mock('playwright')` → `vi.mock('camoufox')`, обновить мок `createContext`.
- **`package.json`** — добавить dep `camoufox` + script `camoufox:fetch`.

## Camoufox API reference (verified against npm camoufox@0.1.19, 2026-07-13)

```ts
import { Camoufox } from "camoufox";  // pkg name on npm: "camoufox"
// types: dist/index.d.ts

const browserOrContext = await Camoufox({
  data_dir?: string,        // = наш profileDir → возвращает BrowserContext (persistent)
  headless?: boolean | "virtual",  // дефолт false
  humanize?: boolean | number,  // cursor movement через BrowserForge
  geoip?: string | boolean,  // true = автоопределение по IP
  locale?: string | string[],
  os?: string | string[],  // fingerprint OS
  // ... block_images, proxy, addons, screen, window, ...
});
// npx camoufox fetch — скачать Firefox (~100MB) + GeoIP-базу (обязательно после install)
```

## Canonical refs (для планировщика)

- `.agents/docs/vision.md`
- `.agents/plans/06-source-aggregators/PLAN.md` + `SUMMARY.md` (почему эскалируем)
- `.agents/plans/05-source-hh/PLAN.md` (origin stealth/human дизайна)
- `app/browser/session.ts`, `app/hh/stealth.ts`, `app/hh/human.ts`
- `app/hh/session.ts`, `app/wellfound/session.ts`

## Deferred ideas (для будущих фаз)

- Camoufox `launchServer` (websocket) — удалённый сервер. Не нужно для single-user.
- BrowserForge кастомные fingerprints (опция `fingerprint`). Избыточно, geoip+random достаточно.
- Proxy support (опция `proxy`). Сейчас системный VPN. Ротация прокси — если понадобится.
- `block_images`/`block_webgl` — оптимизация. Не сейчас.
