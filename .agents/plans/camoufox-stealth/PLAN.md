---
plan: camoufox-stealth
type: insert  # между фазой 06 и 07
status: in-progress (POC proven, implementation pending)
created: 2026-07-13
updated: 2026-07-13
trigger: Cloudflare bot-detect заблокировал Playwright/Chromium на Wellfound (SUMMARY фазы 06)
must_haves:
  truths:
    - "Эскалация анти-детекта: Camoufox (модифицированный Firefox, FingerprintForge на уровне движка) как ОБЩИЙ браузер-стек для всех источников (hh + wellfound)."
    - "Архитектура: CDP/Playwright-server bridge. Python (camoufox@0.4.11, стабилен) запускает Camoufox как Playwright-server (launch_server), печатает wsEndpoint в stdout. Node (JS-playwright) подключается через firefox.connect(ws), сбор/парсинг/фильтр остаются в TS."
    - "POC ДОКАЗАН end-to-end (2026-07-13): Python-server → firefox.connect → page.goto bot.sannysoft.com → fingerprint {webdriver:false, plugins:5, Firefox/135}. Архитектура работает."
    - "JS-порт camoufox@0.1.19 ОТВЕРГНУТ: 3 бага (ESM dynamic-require, geoip proxy, viewport protocol skew). Python-порт стабильнее."
    - "ДВА КРИТИЧНЫХ УСЛОВИЯ: (1) JS-playwright PINNED to 1.50.0 (протокол сошёлся с Python-Camoufox-driver 1.50; 1.61 даёт WS-handshake fail); (2) python-bridge/package.json без type:module (иначе camoufox's launchServer.js CJS заражается ESM-флагом)."
    - "Spawn-on-demand: Python-процесс стартует перед каждым запуском сбора/логина, закрывается после. uv-окружение в python-bridge/ (uv 0.9.15 уже установлен)."
    - "app/hh/stealth.ts УДАЛЁН (фаза camoufox-3 уже сделана). human.ts почищен (humanMouseMove убран)."
    - "Acceptance = реальный smoke ОБЯЗАТЕЛЕН: wellfound:login НЕ блокируется Cloudflare + collect-wellfound собирает >=1 вакансию + hh:login работает."
---

# Plan: camoufox-stealth (revised after POC)

Эскалация анти-детекта после Cloudflare-блока Wellfound'а в фазе 06.
Camoufox (Firefox-based) как общий браузер-стек через **CDP/Playwright-server bridge**:
Python запускает браузер, Node подключается и собирает.

## Goal

Связать Python-Camoufox (стабильный) с TS-кодовой базой через Playwright-server
WebSocket. Заменить прямые вызовы `chromium.launchPersistentContext` в
`app/browser/session.ts` на spawn Python-сервера + `firefox.connect(wsEndpoint)`.
Реальный smoke Wellfound (login + collect) и hh (login) обязателен.

## POC findings (уже доказано, 2026-07-13)

- Python `camoufox.server.launch_server(**kwargs)` печатает `ws://localhost:PORT/HASH`.
- JS `firefox.connect(ws)` подключается, открывает страницы, fingerprint правдоподобен.
- **Условие 1:** JS-playwright должен быть **1.50.0** (1.61 → WS-handshake fail, protocol skew).
- **Условие 2:** `python-bridge/package.json` нужен без `type:module` (camoufox's launchServer.js — CJS).
- Архитектура end-to-end работает: `webdriver:false, plugins:5, Firefox/135`.

## Already done (на ветке camoufox-stealth)

- ✅ Шаги 1-6 (JS-порт подход) реализованы, 94/94 тестов зелёные.
- ✅ `app/hh/stealth.ts` удалён, `human.ts` почищен.
- ✅ `app/browser/session.ts` переписан (сейчас через JS-Camoufox-wrapper — БУДЕТ ЗАМЕНЁН на Python-bridge).
- ✅ README, package.json (`camoufox:fetch`), тесты — обновятся.

## Steps (revised)

### Step A — Python-bridge infrastructure
- `python-bridge/pyproject.toml` (uv, уже создано): `camoufox@0.4.11`, `playwright==1.50.*` (pin!).
- `python-bridge/package.json`: `{"name":"python-bridge-runner","private":true}` — НЕ type:module (фикс условия 2).
- `python-bridge/serve.py`: argparse (--profile, --headed, --locale), вызывает `launch_server()`.
  Выводит wsEndpoint в stdout в машино-читаемом формате (`WSENDPOINT: ws://...`) для парсинга из Node.
- `.gitignore`: игнорировать `python-bridge/.venv/`, `python-bridge/uv.lock` (или коммитить lock? — решить).
- Commit: `feat(camoufox-A): python-bridge (uv + serve.py + launch_server)`.

### Step B — Node-side launcher (spawn + wsEndpoint parse)
- Новый `app/browser/launcher.ts`:
  - `launchCamoufoxServer({profileDir, headed, locale}): Promise<{wsEndpoint, stop}>`
  - spawn: `uv run python python-bridge/serve.py --profile ... --headed ... --locale ...`
  - читает stdout, ждёт строку `WSENDPOINT: <ws>`, возвращает wsEndpoint
  - `stop()`: kill процесса Python + дочерних (browser close)
  - cwd = `python-bridge/` (условие 2)
- Commit: `feat(camoufox-B): Node launcher (spawn uv + parse wsEndpoint)`.

### Step C — Rewrite `app/browser/session.ts` (Camoufox → Python-bridge)
- `createContext({profileDir, headed, locale})`:
  1. `const { wsEndpoint, stop } = await launchCamoufoxServer(opts)`
  2. `const browser = await firefox.connect(wsEndpoint)`
  3. вернуть обёртку: `{ newPage: () => browser.contexts[0]?.newPage() || ctx.newPage(), close: stop }`
     (контракт BrowserContext)
- убрать старый JS-Camoufox-wrapper (`app/browser/camoufox.ts`) — больше не нужен.
- PIN JS-playwright to 1.50.0 в package.json (замена ^1.61.1).
- Commit: `feat(camoufox-C): createContext via Python-bridge (firefox.connect)`.

### Step D — Tests update
- `tests/browser-session.test.ts`: переписать под новую архитектуру.
  Мокать `~/browser/launcher` (launchCamoufoxServer) и `playwright/firefox` (connect).
  Проверять: createContext вызывает launcher с правильными опциями, вызывает firefox.connect(ws).
- `tests/browser-launcher.test.ts`: мокать child_process.spawn, проверять парсинг WSENDPOINT, kill на stop.
- Существующие collect-тесты (мокают `~/hh/session`) — не меняются.
- Commit: `test(camoufox-D): rewrite browser-session tests + add launcher tests`.

### Step E — README + package.json cleanup
- README: шаг `uv sync` в python-bridge/ вместо (или вместе с) `camoufox:fetch`.
- Убрать `camoufox:fetch` npm-скрипт (это было для JS-порта; Python сам тянет браузер).
- Убрать dep `camoufox` (JS) из package.json.
- Commit: `docs(camoufox-E): README + package.json cleanup (Python-bridge setup)`.

### Step F — Manual smoke (ACCEPTANCE GATE)
1. `cd python-bridge && uv sync && cd ..` — Python-окружение готово.
2. `npm run wellfound:login` → spawn Python-Camoufox, firefox.connect, headed браузер.
   УСПЕХ: нет «bot activity», залогинился.
3. `npm run wellfound:collect -- --source=2 --profile=2 --max=3` → headless сбор, >=1 вакансия.
4. `npm run hh:login` → повтор для hh.
5. `npm test && npm run typecheck` зелёные.

## Acceptance

- [ ] `python-bridge/serve.py` через `launch_server()` печатает wsEndpoint.
- [ ] `app/browser/launcher.ts` spawn'ит uv, парсит wsEndpoint, корректно kill'ит.
- [ ] `app/browser/session.ts` createContext → launcher + firefox.connect.
- [ ] JS-playwright pinned 1.50.0 (protocol match).
- [ ] `python-bridge/package.json` без type:module.
- [ ] `app/browser/camoufox.ts` (JS-wrapper) удалён.
- [ ] `app/hh/stealth.ts` удалён (уже), `human.ts` почищен (уже).
- [ ] 94+ тестов зелёные, typecheck чистый.
- [ ] **ГЛАВНОЕ — smoke:** wellfound login+collect (>=1 вакансия), hh login.

## Risks

1. **uv sync на CI/другой машине** — uv должен быть предустановлен. Документировать в README.
2. **Windows path with кириллица/пробелы** (Рабочий стол) — uv/node spawn должен это пережить.
   POC работал из `python-bridge/` (поддиректория с пробелом в пути) — обнадёживает.
3. **firefox.connect vs launchPersistentContext** — connect создаёт новый context, не persistent.
   Для персистентности куки: либо Camoufox's data_dir (Python-side) + Node переподключается,
   либо вручную storageState. Проверить в шаге C/F.
4. **Жизненный цикл browser/context** — при connect() context управляется сервером. close() behaviour отличается от launchPersistentContext. Уточнить в шаге C.

## Out of scope

- uv.lock коммитить или нет — решить в шаге A (recommended: коммитить для воспроизводимости).
- Python-код запускается только через uv run (не venv-activate) — единая точка входа.
- Фаза 07 (source-telegram) — следующий план.
