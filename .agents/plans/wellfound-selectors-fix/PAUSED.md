# wellfound-selectors-fix — ЗАМОРОЖЕН (блок по IP, лечение отложено)

> **Статус:** заморожен решением пользователя. Блок по IP — Camoufox не помогает.
> Код-предпосылка (дампер) готов и закоммичен. Возвращаемся, когда решится сеть.

## Корневая причина (уточнённая 2026-07-14)

**Wellfound блокирует по IP `202.148.55.56`, не по fingerprint.** Camoufox
меняет fingerprint браузера, но НЕ меняет IP — поэтому:

- Headless-дамп (2026-07-14) → DataDome interstitial (`captcha-delivery.com`)
- Headed-дамп с залогиненным профилем → *«Access is temporarily restricted —
  Automated (bot) activity on your network (IP 202.148.55.56)»*

**Корректировка к SUMMARY camoufox-stealth:** утверждение «Cloudflare пройден,
wellfound:collect работает headless, 0 вакансий из-за селекторов» —
неточное. Реально блок по IP не давал дойти до рендера карточек. «0 вакансий»
объяснялся блокировкой, а не разметкой.

Тот же IP блокировал Wellfound ещё в фазе 06 (до Camoufox) — блок персистентен.

## Что сделано на ветке (полезно, сохранено)

- ✅ `scripts/dump-wellfound-html.ts` — Camoufox-дампер HTML (search + N детальных).
  Различает DataDome / Cloudflare / таймаут; сохраняет блок-дамп для диагностики.
- ✅ `package.json` — npm-скрипт `wellfound:dump`.
- ✅ `.gitignore` — `data/dumps/` (приватные данные сессии).

## Точка продолжения (когда сеть решится)

1. **Выбрать и подключить прокси** (residential рекомендуется; datacenter/VPN
   почти гарантированно снова в блок-листе). Решение за пользователем.
2. **Запланированная архитектура** (код НЕ зависит от типа прокси —
   `launch_server(proxy, geoip=True)` принимает любой URL):
   - `WF_PROXY` в `.env` (формат Playwright: `http://user:pass@host:port`)
   - `python-bridge/serve.py`: `--proxy '{...}'` → `launch_server(proxy=..., geoip=True)`
   - `app/browser/launcher.ts` + `session.ts`: проброс `proxy` (только для Wellfound)
   - `app/wellfound/session.ts`: читает `WF_PROXY`, передаёт в createContext
   - geoip sync: Camoufox выведет timezone/locale/coords из IP выхода
     (консистентный fingerprint: IP США → профиль США)
   - **Только Wellfound**; hh остаётся на прямом соединении
3. После прохождения блока: `npm run wellfound:dump -- --headed` →
   `data/dumps/wellfound-search-*.html` → правка `selectors.ts`/`parsers.ts`
   под реальный HTML → обновить `tests/fixtures/wellfound-*.html` → тесты.

## Подтверждение API (context7, daijro/camoufox, 2026-06)

`launch_server(**kwargs)` принимает те же аргументы, что `Camoufox()`, включая
`proxy` (Playwright-формат `{server, username, password}`) и `geoip`
(`True` — авто-определение IP через прокси). См. STATE.md решение 2026-07-14.

## Контекст для продолжения (canonical refs)

- `app/wellfound/selectors.ts` — текущие неверные селекторы (`data-testid`)
- `app/wellfound/parsers.ts` — `parseSearchResults` / `parseVacancyDetail` /
  `parseSalary` (последний валиден, НЕ трогать)
- `app/wellfound/collect.ts`, `app/wellfound/session.ts`
- `python-bridge/serve.py` — точка добавления `--proxy`
- `app/browser/launcher.ts`, `app/browser/session.ts` — проброс `proxy`
- `scripts/dump-wellfound-html.ts` — **дампер** (готов)
- `tests/wellfound-*.test.ts` + `tests/fixtures/wellfound-*.html` — синтетика
