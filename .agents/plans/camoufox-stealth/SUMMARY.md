---
plan: camoufox-stealth
type: insert  # между фазой 06 и 07
title: "Camoufox через Python-bridge — обход Cloudflare bot-detect"
status: complete
duration: "~2h"
started: 2026-07-13T08:50:00Z
completed: 2026-07-13T10:55:00Z
files_created: 4
files_deleted: 2
files_modified: 6
tags: [camoufox, anti-detect, python-bridge, cloudflare, stealth, firefox]
key-files:
  created:
    - python-bridge/serve.py
    - python-bridge/pyproject.toml
    - python-bridge/uv.lock
    - python-bridge/package.json
    - app/browser/launcher.ts
  deleted:
    - app/hh/stealth.ts
    - app/browser/camoufox.ts
  modified:
    - app/browser/session.ts
    - app/hh/human.ts
    - app/hh/session.ts
    - app/wellfound/session.ts
    - app/wellfound/selectors.ts
    - package.json
    - README.md
key-decisions:
  - "Camoufox (Firefox-based, FingerprintForge) — ОБЩИЙ браузер-стек для всех источников"
  - "Python-bridge архитектура: Python launch_server → firefox.connect (CDP/playwright-server protocol)"
  - "JS-порт camoufox@0.1.19 ОТВЕРГНУТ (3 бага: ESM dynamic-require, geoip proxy, viewport skew)"
  - "playwright pinned 1.50.0 (protocol match с Python-Camoufox-driver; 1.61 даёт WS-handshake fail)"
  - "Главный результат: Cloudflare bot-detect на Wellfound ПРОЙДЕН (логин успешен)"
---

# camoufox-stealth — Summary

Эскалация анти-детекта после Cloudflare-блока Wellfound'а в фазе 06.
**Цель достигнута:** Camoufox (модифицированный Firefox) через Python-bridge
прошёл Cloudflare bot-detect, на котором споткнулся обычный Playwright/Chromium.
Пользователь успешно залогинился на Wellfound вручную.

## Duration  ~2h (08:50 → 10:55 UTC)

## Что сделано (key result)

**Camoufox через Python-bridge — рабочий стек анти-детекта:**
- Python (`camoufox@0.4.11`, стабилен) запускает Camoufox как Playwright-server
- Node подключается через `firefox.connect(wsEndpoint)`, сбор/парсинг/фильтр в TS
- spawn-on-demand: Python-процесс стартует перед запуском, закрывается после

**Smoke подтверждения (реальный браузер, не моки):**
- `hh:stealth-check`: `navigator.webdriver=false`, `plugins=5`, `WebGL=NVIDIA` (не SwiftShader)
- `wellfound:login`: страница логина открылась **без** «Access temporarily restricted»,
  пользователь залогинился, куки персистятся в `data/wellfound-profile/`

## Архитектурный путь (с отклонениями)

### Попытка 1: JS-порт camoufox@0.1.19 — ОТВЕРГНУТ
Реализованы шаги 1-6 (94/94 тестов), но реальный запуск упёрся в 3 бага:
1. ESM dynamic-require (обошёл createRequire wrapper)
2. `geoip:true` publicIP валится на proxy-handling (отключил)
3. `Browser.setDefaultViewport` protocol error (Playwright 1.61 vs Juggler skew) — непроходимый

JS-порт (2 stars, 2025-09) сырой. Решение пользователя: Python-Camoufox через subprocess.

### Попытка 2: Python-bridge — УСПЕХ
- POC доказан end-to-end: Python `launch_server` → `firefox.connect` → fingerprint OK
- Два критичных условия найдены эмпирически:
  - **playwright pinned 1.50.0** (протокольный матч с Python-driver; 1.61 → WS-handshake fail)
  - **`python-bridge/package.json` без type:module** (camoufox's launchServer.js — CJS,
    без нейтрального package.json «заражается» корневым ESM-флагом)

## Tasks (финальные)

- **A** (`81998b8`): python-bridge — uv + serve.py (launch_server) + pyproject (camoufox, playwright==1.50.*)
- **B** (`2207e81`): app/browser/launcher.ts — spawn uv, parse wsEndpoint, stop() с graceful kill
- **C** (`51e5575`): session.ts → launchCamoufoxServer + firefox.connect, обёртка close()→stop()
- **D** (`875b485`): тесты — browser-session (8) + browser-launcher (5), playwright pinned 1.50.0
- **E** (`2a43e5c`): README (uv sync + camoufox fetch), убрать JS camoufox dep + fetch script
- **fixes**: URL `/login` (`ca93907`), убрать shell:true из spawn (Windows path encoding, `fbc0e87`)
- **из фазы 06, переиспользовано**: stealth.ts удалён, human.ts почищен (humanMouseMove убран)

## Deviations from Plan

**[Rule 1 — Bug] JS-порт camoufox@0.1.19: 3 каскадных бага**
- Found during: шаг 7 (smoke), последовательно
- Issue: ESM dynamic-require → geoip proxy → viewport protocol skew. Последний непроходим.
- Fix: полный pivot на Python-bridge (решение пользователя после ask_pro).
- Files: app/browser/camoufox.ts удалён, session.ts переписан · Commits: `166aec4`, затем A-E

**[Rule 1 — Bug] spawn shell:true ломает Windows-пути с кириллицей**
- Found during: шаг F (smoke stealth-check)
- Issue: с `shell:true` args не экранируются, путь `...Рабочий стол...` разбивается/кодировка ломается,
  serve.py получает кракозябры вместо --profile.
- Fix: убрать `shell:true`, прямой spawn `uv` (uv в PATH).
- Files: app/browser/launcher.ts · Commit: `fbc0e87`

**[Rule 1 — Missing impl detail] Wellfound URL был неверный**
- Found during: шаг F (smoke wellfound:login)
- Issue: `WF_LOGIN_URL = wellfound.com/users/sign_in` — реальный URL `wellfound.com/login`.
- Fix: константа + isLoggedIn URL-чек обновлены.
- Files: app/wellfound/selectors.ts, app/wellfound/session.ts · Commit: `ca93907`

**[Эмпирическая находка] playwright version skew — критичное условие**
- POC показал: JS-playwright должен быть 1.50.0 (не 1.61), иначе WS-handshake fail.
- Python-Camoufox использует playwright-driver 1.50; протоколы должны совпадать.
- Не описано в PLAN, найдено в POC. Зафиксировано в pyproject.toml + package.json pin.

**Total deviations:** 3 auto-fixed (Rule 1) + 1 эмпирическая находка (version pin).
**Pivot:** 1 (JS-порт → Python-bridge, по решению пользователя).

## Out-of-Scope Issues (перенесено в следующую работу)

- **Селекторы Wellfound не совпадают с реальностью** — главная незакрытая нить.
  Smoke нашёл: `data-testid` атрибутов НЕТ (best-guess из фазы 06 неверный),
  карточки на Tailwind-классах + `a[href*="/jobs/ID-slug"]`. collect-wellfound
  собирает 0 вакансий. Нужна переписка selectors.ts + parsers.ts под реальный
  дамп + обновление фикстур. **Это работа уровня фазы 06 (source-aggregators),
  не stealth-эскалации** — пользователь явно решил закрыть camoufox-stealth
  на достигнутом (Camoufox прошёл Cloudflare = главная цель).
- **hh:login smoke** — не запускался в этой фазе (wellfound:login доказал
  Camoufox работает; hh использует тот же createContext). Поверить при
  следующем запуске hh-сбора.
- **Camoufox launchServer.js CJS-фикс** — workaround через нейтральный
  python-bridge/package.json. Если автор camoufox починит — можно убрать.

## Verification

```
npm test                 → 99/99 (13 files): +19 тестов (browser-session 8, browser-launcher 5, human 6)
npm run typecheck        → без ошибок
npm run hh:stealth-check → webdriver=false, plugins=5, WebGL=NVIDIA ✓
npm run wellfound:login  → Cloudflare НЕ заблокировал, логин успешен ✓
                          (куки в data/wellfound-profile/)
npm run wellfound:collect→ работает (Cloudflare пропускает headless),
                          но 0 вакансий из-за несовпадения селекторов (см. out-of-scope)
uv sync (python-bridge)  → окружение готово
camoufox fetch           → Firefox скачан (~1 GB)
```

## Known limitations

1. **Селекторы Wellfound не совпадают** — best-guess `data-testid` неверный,
   реальная структура: `a[href*="/jobs/"]` + Tailwind-классы. collect собирает 0.
   Лечится перепиской парсеров (отдельная работа).
2. **uv должен быть предустановлен** — документировано в README. На CI/новой
   машине нужно ставить uv отдельно.
3. **Windows path с кириллицей** — POC/smoke прошли из `...Рабочий стол...`,
   но spawn без shell:true полагается на uv в PATH.
4. **playwright version lock** — JS pinned 1.50.0, Python pinned 1.50.*.
   Обновление любой стороны может сломать WS-handshake. Зафиксировано в обоих
   манифестах с комментариями.
5. **persist vs connect** — firefox.connect создаёт remote context; куки
   персистятся через Camoufox data_dir (Python-side), не через storageState.
   Работает, но lifecycle отличается от launchPersistentContext.

## Files Touched

- Created: 6 (python-bridge/{serve.py,pyproject.toml,uv.lock,package.json}, app/browser/launcher.ts + тесты)
- Deleted: 2 (app/hh/stealth.ts, app/browser/camoufox.ts)
- Modified: 7 (session.ts ×3, human.ts, selectors.ts, package.json, README.md)

## Next

**Camoufox-stealth закрыт на главной цели** (Cloudflare пройден). Открытая нить —
селекторы Wellfound. Рекомендация: следующий план `wellfound-selectors-fix`
(или доработка в рамках фазы 06) — переписать selectors.ts + parsers.ts под
реальный дамп, обновить фикстуры, повторить collect-smoke. После — ROADMAP
фаза 07 (source-telegram).
