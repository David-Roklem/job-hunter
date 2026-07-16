# Plan: fingerprint-pinning

## Goal

Зафиксировать fingerprint браузера Camoufox между запусками, чтобы hh.ru
перестал инвалидировать сессию. Сейчас `launch_server()` генерирует
случайный fingerprint (BrowserForge) при каждом старте; storageState
хранит только куки, без UA/screen/navigator. hh видит валидную куку
`hhtoken`, но отпечаток не совпадает с тем, при котором кука была выдана →
silent разлогин (гостевая страница с «Войти» ×15).

Решение: один BrowserForge Fingerprint генерируется один раз, сериализуется
в `data/hh-fingerprint.json`, и `serve.py` передаёт его в
`launch_server(fingerprint=...)` при каждом запуске. Login и collect/apply
работают под одним и тем же fingerprint → hh держит сессию.

Пределы: остаёмся на camoufox==0.4.11 + playwright==1.50 (проверенный
стек из camoufox-stealth). `fingerprint_preset` (бандл из 312 пресетов)
отложен — требует camoufox≥0.5.3 → playwright 1.60, риск WS-handshake fail.

## Steps

1. **`python-bridge/fingerprint.py` — сериализация/десериализация.**
   Две функции поверх `browserforge.fingerprints.Fingerprint`:
   - `generate() -> Fingerprint` — `FingerprintGenerator(browser="firefox",
     os="windows").generate()`, плюс `handle_window_size` из
     `camoufox.fingerprints` для фиксированного окна (1920×1080).
   - `from_json(path) -> Fingerprint` — рекурсивный `from_dict` по dataclass-
     полям (ScreenFingerprint, NavigatorFingerprint, VideoCard), чтение JSON.
   - `to_json(fp, path)` — `dataclasses.asdict` → `json.dump`.
   Round-trip доказан руками (см. контекст решения): UA/platform/screen
   совпадают, `from_browserforge(fp)` возвращает валидный CAMOU_CONFIG.

2. **`scripts/gen-fingerprint.py` — CLI генератор (разовый).**
   `python scripts/gen-fingerprint.py` → пишет `data/hh-fingerprint.json`.
   Запускается вручную один раз (или при необходимости регенерации, напр.
   если hh забанил отпечаток). Аналог `npm run hh:login` по духу — точка
   инициализации состояния. Добавить npm-команду `gen:fingerprint`.

3. **`python-bridge/serve.py` — проброс fingerprint в launch_server.**
   Новый CLI-аргумент `--fingerprint <path>` (опциональный). Если задан и
   файл существует — `from_json(path)` → `launch_server(fingerprint=fp, ...)`.
   Если нет — текущее поведение (случайный fingerprint). Узел launcher.ts
   пробрасывает путь: `app/browser/launcher.ts` принимает `fingerprintPath?`
   в `LaunchOptions` и добавляет `--fingerprint <path>` в args spawn'а
   (дефолт — `data/hh-fingerprint.json` для hh; можно `null` чтобы явно
   отключить).

4. **`app/hh/session.ts` — дефолт fingerprint для hh.**
   `createContext` по умолчанию передаёт `fingerprintPath = HH_FINGERPRINT_PATH`
   (`data/hh-fingerprint.json`), аналогично `STORAGE_STATE_PATH`. Передай
   `null`, чтобы отключить. Документация в шапке обновляется: отмечается,
   что fingerprint **должен совпадать** между login и collect/apply.

5. **Тесты.**
   - `tests/browser-launcher.test.ts`: `--fingerprint <path>` пробрасывается
     в args spawn'а (аналогично тесту на `--window`). Проверка:
     `args` содержит `--fingerprint` + путь.
   - `tests/browser-session.test.ts`: `fingerprintPath` по умолчанию
     пробрасывается в `launchCamoufoxServer`.
   - **Python-side тест пока не нужен** — round-trip доказан вручную;
     `from_dict` тривиален и покрыт smoke-прогоном. (Если позже станет
     хрупким — добавить pytest в python-bridge.)

6. **Smoke-валидация на живом hh (главное acceptance).**
   - `npm run gen:fingerprint` (раз).
   - `npm run hh:login` → `saveSession` (куки под fingerprint-A).
   - `npm run hh:smoke-session` → `isLoggedIn` должно стать **✓ YES**
     (раньше было ✗ NO), потому что fingerprint-A тот же.
   - `npm run hh:collect -- --source=1 --profile=1 --max=3` → без капчи,
     собирает вакансии (уже работает после фикса селекторов, но теперь
     повторяемо — без повторного логина).

## Acceptance

- [ ] `data/hh-fingerprint.json` генерируется разово через `npm run
      gen:fingerprint` и содержит валидный BrowserForge fingerprint
      (navigator.userAgent Firefox, screen, platform).
- [ ] `serve.py` при `--fingerprint <path>` передаёт fingerprint в
      `launch_server`, без аргумента — обратно совместим (случайный fp).
- [ ] **Smoke-критерий**: после `hh:login` под fingerprint-A, повторный
      `hh:smoke-session` показывает `isLoggedIn: ✓ YES` (раньше ✗ NO),
      без повторного логина. Это прямое доказательство что hh держит сессию.
- [ ] `hh:collect` повторяем без повторного логина (несколько прогонов
      подряд, разные часы) — без «Войти»/гостевой страницы.
- [ ] Автотесты: browser-launcher + browser-session дополнены, всего
      ~225/225 (было 222). `npm run typecheck` чистый.
- [ ] Документация: комментарий в `app/hh/session.ts` про обязательность
      совпадения fingerprint между запусками; STATE.md фиксирует решение
      (остались на 0.4.11 + fingerprint= kwarg, 0.5.3 отложена из-за
      playwright 1.60 риска).

## Контекст решения (для execute-фазы)

- **API 0.4.11**: `launch_options(fingerprint=Optional[Fingerprint])` —
  принимает готовый BrowserForge Fingerprint. Внутри → `from_browserforge(fp)`
  → CAMOU_CONFIG. Параметра `fingerprint_preset` в 0.4.11 НЕТ.
- **Round-trip доказан**: `asdict` → JSON → рекурсивный `from_dict` (Screen-
  /Navigator/VideoCard — вложенные dataclass'ы) восстанавливает Fingerprint,
  `from_browserforge` его принимает. UA/platform/screen совпадают.
- **0.5.3 разведана, но отложена**: даёт `fingerprint_preset` (бандл 312
  пресетов), но тянет playwright 1.60.0 (`<1.61`). Наш JS-pin 1.50 из-за
  WS-handshake fail на 1.61 — риск. Решение пользователя: остаться на 0.4.11.
- **Pinned значения**: OS = windows ( десктоп пользователя — см. решение
  STATE «WebGL vendor/renderer НЕ маскируется», реальное железо Windows).
  Browser = firefox (Camoufox строится на Firefox, чужой UA = детект).
