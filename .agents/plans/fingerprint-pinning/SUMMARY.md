# Summary: fingerprint-pinning

**Статус:** выполнено. Автотесты 226/226, `tsc` чистый. Smoke на живом hh.ru
валиден: `isLoggedIn: ✓ YES` (было ✗ NO), `hh:collect` повторяем без логина.

## Что доставлено

Зафиксированный BrowserForge Fingerprint, переиспользуемый между запусками
Camoufox → hh.ru перестал инвалидировать сессию из-за несовпадения отпечатка.

Раньше `launch_server()` (Camoufox 0.4.11) генерировал случайный fingerprint
при каждом старте; `storageState` хранил только куки без UA/screen. hh видел
валидную куку `hhtoken`, но отпечаток не совпадал с тем, при котором кука была
выдана → silent разлогин (гостевая страница с «Войти» ×12).

## Решение

Один BrowserForge Fingerprint генерируется разово (`npm run gen:fingerprint`
→ `data/hh-fingerprint.json`), сериализуется в JSON, и `serve.py` передаёт
его в `launch_server(fingerprint=...)` при каждом запуске через новый CLI
аргумент `--fingerprint`. Логин и collect/apply работают под одним отпечатком.

Технически: `Fingerprint` — dataclass; сериализация через `dataclasses.asdict`,
десериализация через рекурсивный `_from_dict` по вложенным dataclass-полям
(ScreenFingerprint / ExtendedScreen / NavigatorFingerprint / VideoCard).
Round-trip доказан: UA/platform/screen совпадают, `from_browserforge(fp)`
возвращает валидный CAMOU_CONFIG.

## Файлы

- `python-bridge/fingerprint.py` — `generate()`, `to_json()`, `from_json()`,
  рекурсивный `_from_dict` с поддержкой ExtendedScreen (поле `_screen_cls`).
- `python-bridge/scripts/gen-fingerprint.py` — разовая генерация,
  идемпотентна (`--force` для перегенерации). UTF-8 stdout для Windows-консоли.
- `python-bridge/serve.py` — `--fingerprint <path>` (опц.), загружает
  fingerprint и передаёт в `launch_server`. Без аргумента обратно совместим.
- `app/browser/launcher.ts` — `fingerprintPath?: string | null` в
  `LaunchOptions`, пробрасывает `--fingerprint` в args spawn'а.
- `app/browser/session.ts` — `fingerprintPath` в `CreateContextOptions`,
  пробрасывается в `launchCamoufoxServer`.
- `app/hh/session.ts` — `HH_FINGERPRINT_PATH` (`data/hh-fingerprint.json`),
  `createContext` дефолтит `fingerprintPath` туда (как `storageStatePath`).
  **Маркеры isLoggedIn обновлены:** `mainmenu_myResumes` →
  `mainmenu_profileAndResumes` (+ `vacancyResponses`); легаси оставлены для A/B.
- `scripts/hh-login.ts` — `saveSession` (было); таймаут 2 мин
  (`HH_LOGIN_TIMEOUT_MS` для перекрытия); дамп HTML при таймауте для диагностики.
- `package.json` — `gen:fingerprint` команда.
- Тесты: `browser-launcher` (+2: `--fingerprint` проброс, null-вариант),
  `browser-session` (+2: `fingerprintPath` проброс, null). Всего 226/226.

## Smoke (живой hh.ru)

1. `npm run gen:fingerprint` — `data/hh-fingerprint.json` (UA Firefox/150, Win32).
2. `npm run hh:login` → залогинился вручную, `saveSession` отработал за ~28 сек,
   сессия сохранена под fingerprint-A.
3. `npm run hh:smoke-session` → **`isLoggedIn: ✓ YES`** (раньше ✗ NO),
   `hhtoken: true` в контексте.
4. `npm run hh:collect -- --source=1 --profile=1 --max=3` → собрано 3
   (matched 1, rejected 2, дублей 3), без капчи/403/повторного логина.

## Доп. находка

Маркеры `isLoggedIn` (`mainmenu_myResumes`/`account-menu`) устарели — hh
перевёл меню на `mainmenu_profileAndResumes`/`profileAndResumes-button`/
`mainmenu_vacancyResponses`. Тот же класс бага, что с `vacancyCard`
(`serp-item` → `vacancy-serp__vacancy`, фикс `1eb8706`). Без этого фикса
`hh-login` бесконечно таймаутился бы, даже при успешном входе пользователя.

## Отложено

`fingerprint_preset` (бандл из 312 реальных пресетов, opt-in в camoufox≥0.5.3)
отложен — требует playwright 1.60 (`<1.61`), риск WS-handshake fail (решение
`camoufox-stealth` от `playwright pinned 1.50.0`). Текущий `fingerprint=`
kwarg 0.4.11 решает задачу полноценно.

## Что разблокировано

**Фаза 11 `apply-hh`** (авто-отклик через Playwright) — теперь имеет
устойчивую залогиненную сессию, необходимую для submit'а отклика.
