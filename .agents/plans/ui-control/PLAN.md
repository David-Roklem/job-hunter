# Plan: ui-control

> Перенос базового управления проектом из терминала в UI.
> Режим vision: «локальный single-user ассистент» — пользователь не должен
> держать открытым терминал для типовых операций (сбор, логин, запуск воркера,
> настройка ключей). Терминал остаётся только для редких/dev-задач.

## Goal

Четыре новых UI-поверхности + одно инфраструктурное расширение, покрывающие
все типовые CLI-операции:

1. **Кнопка «Собрать вакансии»** на дашборде → энкьют `collect_vacancies`
   (запускает цепочку `collect → match → generate_draft` через очередь jobs).
2. **Управление scheduler** (`/jobs`): запуск/стоп/статус воркера как
   дочернего процесса (`npm run scheduler`), без открытого терминала.
3. **Страница `/sources`**: список источников (hh / wellfound / telegram),
   их статус сессии, кнопки `seed` / `login` (spawn headed-браузера) /
   `collect` (энкьют через очередь).
4. **Страница `/settings`**: редактирование конфигурации окружения (ключи
   API, TG-сессия, лимиты hh, путь к БД) без ручного редактирования `.env`.

Долгие операции (collect, apply, match) исполняются **через очередь jobs**
существующим воркером (фаза 12) — UI только энкьетит и показывает прогресс.
Логины (headed-браузер с капчей/2FA) — spawn отдельного процесса на машине
пользователя (browser откроется локально, action не блокируется).

## Decisions (зафиксированы в discuss)

- **Windows-spawn нюанс.** Проект разрабатывается на Windows (`C:\Users\rokle\...`).
  Spawn `npm run X` через `child_process.spawn` на Windows требует `shell: true`
  ИЛИ прямой выз `npm.cmd`/`npx`. Менеджер процессов использует `shell: true`
  + `detached: true` (на Windows detached+shell создаёт новую группу —
  корректный SIGTERM через `process.kill(pid)`). Кросс-платформа проверяется
  тестом-спеком (spawn `node -e`), реальный smoke — на машине разработчика.

- **Scheduler как spawn-процесс.** Action `/jobs` spawn'ит
  `npm run scheduler` (через `child_process.spawn`, detached) и пишет PID +
  метку старта в `data/scheduler.pid`. Стоп = `process.kill(pid, 'SIGTERM')`.
  Статус alive/dead = проверка существования процесса по PID (`process.kill(pid,0)`).
  НЕ встроен в dev-сервер (пользователь явно выбрал spawn-вариант), НЕ
  требует долгоживущего server-state в RR7 (который может перезапускаться при
  HMR — а PID-файл переживает restart).
- **Логины — spawn процесса.** `hh:login` / `wellfound:login` требуют
  headed-браузер с интерактивной капчей — **нельзя** запустить из серверного
  action (нет GUI у процесса node-сервера). Spawn'им соответствующий
  `npm run <name>` как detached-процесс; browser открывается на машине
  пользователя. **Telegram-логин — особый случай:** это НЕ headed-браузер, а
  интерактивный терминальный prompt (ввод кода из SMS/Telegram). Spawn
  сработает, но ввод кода нужно делать в терминале, откуда видны логи
  (`data/logs/telegram-login.log`). UI даёт кнопку «Запустить логин» + ссылку
  на лог, но помечает telegram-логин как «требует терминал для ввода кода».
  Статус залогиненности: hh — наличие `data/hh-session.json`; wellfound —
  наличие/свежесть `data/wellfound-profile/` (у wellfound НЕТ storageState-
  файла, только персистентный profileDir); telegram — `env.TG_SESSION !== ""`.
- **Долгие операции — через очередь jobs.** `collect` (для конкретного source)
  и `apply` — энкейтим job (существующая архитектура фазы 12). Реальную работу
  делает воркер; прогресс виден на `/jobs`. **Исключение:** корневой
  `collect_vacancies` уже есть в jobKinds; для per-source collect добавлять
  новый kind НЕ нужно — достаточно энкейтить `collect_vacancies` (он собирает
  по всем активным hh-источникам, как сейчас).
- **Settings — чтение env через `env.server.ts`, запись — в `.env`.** Форма
  показывает текущие значения (маскировка секретов: TG_SESSION, ключи API —
  `****` + чекбокс «показать»). Сохранение = перезапись `.env` (атомарный
  write: temp-файл в той же директории + rename) + подсказка «перезапустите
  dev-сервер, чтобы изменения вступили в силу» (env парсится при старте).
  Секреты НИКОГДА не отдаются в loader — только флаг `is_set: boolean`.
- **Seed в action.** `hh:seed` / `wellfound:seed` / `telegram:seed` — простые
  find-or-create по имени; выносим их логику в переиспользуемые функции
  `app/sources/seed.ts` (seeders уже дублируют друг друга), вызываем из action
  `/sources` и оставляем CLI-скрипты как тонкие обёртки.
- **Логирование процессов.** detached-процессы (scheduler, login) пишут stdout/stderr
  в `data/logs/<name>.log` (ротация вне scope — single-user, ручная чистка).
  Loader `/jobs` и `/sources` отдаёт последние N строк лога для отображения.

## Steps

### 1. Инфраструктура процессов: `app/processes/manager.ts`

- `app/processes/manager.ts` (новый):
  - `startManaged(name, cmd, args)`: spawn (через `child_process.spawn` с
    `shell: true`, `detached: true`, `stdio: ['ignore', pipe, pipe]`),
    redirects stdout+stderr → `data/logs/<name>.log` (append), пишет
    `{ pid, started_at, name, cmd, args }` в `data/processes/<name>.json`.
    `shell:true` нужен для Windows (`npm` = `npm.cmd`). На уже запущенный
    name → ошибка «уже работает» (не spawn второй).
  - `stopManaged(name)`: читает pid, `process.kill(pid, 'SIGTERM')`,
    удаляет pid-файл. Возвращает `{ ok }` или `{ ok:false, error }` (процесс
    мог уже умереть — ESRCH).
  - `statusManaged(name)`: `{ running: boolean, pid?, started_at?, logPath }`.
    `running` через `process.kill(pid, 0)` (throws ESRCH если мёртв) с catch;
    если pid-файла нет → `running:false`.
  - `readLogTail(name, lines=50)`: хвост лога для UI (читает последние N строк).
- Согласовано с temp-files rule: `data/logs/`, `data/processes/` —
  project-scoped (НЕ `/tmp`), переживают restart dev-сервера.
- Тесты: `tests/processes-manager.test.ts` — spawn тривиального процесса
  (`node -e "setTimeout(...,30000)"`), проверка start/status/stop; мёртвый
  процесс (kill -9 вручную или короткий скрипт) → `running:false`.
  Windows-специфика проверяется вручную (CI/тесты на node -e кросс-платформенны).

### 2. Scheduler-control: action в `/jobs`

- `app/routes/jobs._index.tsx`:
  - loader добавляет `scheduler: statusManaged("scheduler")` + tail лога.
  - action: intent `scheduler_start` → `startManaged("scheduler", ["run","scheduler"])`
    (через `npm`); intent `scheduler_stop` → `stopManaged("scheduler")`.
    Редирект обратно с flash-сообщением (ok/error).
  - UI: плашка сверху — «Воркер: ▶ запущен / ⏸ остановлен», кнопки
    «Запустить» / «Остановить», раскрывающийся блок с хвостом лога.
- `_index.tsx` (главная): в плашке «Очередь» показываем статус воркера
  (▶/⏸), чтобы было видно с дашборда.
- Тесты: `tests/jobs-route.test.ts` — мок `processes/manager`, проверка
  loader отдаёт `scheduler.running`, action start/stop вызывает менеджер.

### 3. Кнопка «Собрать вакансии» на дашборде

- `app/routes/_index.tsx`:
  - action: intent `collect_now` → `jobsRepo.enqueue("collect_vacancies", {})`.
    Редирект на `/jobs` (там виден прогресс цепочки).
  - UI: в header дашборда кнопка «↻ Собрать вакансии» (форма POST).
    Под ней — мини-статус: последний `scheduler_runs` (collected/matched/drafted)
    из loader, если есть.
- `app/db/repositories/scheduler_runs.ts`: добавить `lastFinished()` —
  последний цикл со `finished_at IS NOT NULL` ORDER BY finished_at DESC LIMIT 1.
  (Новой функции нет — добавляем.)
- loader: добавить `lastRun: schedulerRunsRepo.lastFinished() | null`.
- Тесты: `tests/index-route.test.ts` — action collect_now → assert job
  kind=collect_vacancies queued; loader отдаёт lastRun.

### 4. Страница `/sources`: статус + seed + login + collect

- `app/routes/sources._index.tsx` (новый):
  - loader: `sourcesRepo.list()` + для каждого источника статус сессии:
    - hh: наличие `data/hh-session.json` + (опц.) возраст файла.
    - wellfound: наличие директории `data/wellfound-profile/` + возраст
      последнего файла в ней (storageState-файла НЕТ — wellfound хранит
      сессию в персистентном profileDir).
    - telegram: флаг `env.TG_SESSION !== ""` (залогинен через StringSession).
  Helper: `app/sources/sessionStatus.ts` — `hhSessionStatus()`,
  `wellfoundSessionStatus()`, `telegramSessionStatus()` возвращают
  `{ loggedIn: boolean, lastSeen?: Date }` — единое место проверки.
  - action:
    - intent `seed` + `kind` → `seedSource(kind)` (переиспользуемая ф-ция из
      шага 6). Idempotent.
    - intent `login` + `kind` → `startManaged("<kind>-login", ["run","<name>:login"])`.
      Для telegram — `telegram:login` (тоже процесс, откроет интерактивный
      prompt для ввода кода → пользователь видит в логах).
    - intent `collect` + `source_id` + `profile_id` → для hh энкейтим
      `collect_vacancies` (已有的 kind); для telegram — аналогично если
      поддерживается шагом collect. Возврат на `/sources`.
  - UI: карточка на каждый источник (kind, name, статус сессии: ✓/✗,
    «never»/дата), кнопки Seed / Войти (spawn) / Собрать.
- `_index.tsx` (главная): секция «Источники» получает `href="/sources"`.
- Тесты: `tests/sources-route.test.ts` — loader возвращает sources+status;
  action seed вызывает seeder; action login вызывает manager (мок);
  action collect энкейтит job.

### 5. Страница `/settings`: конфигурация окружения

- `app/routes/settings._index.tsx` (новый):
  - loader: отдаёт **только** `{ values: { key: { value?, is_set, is_secret } } }`
    по белому списку редактируемых ключей. Секреты (`ZAI_API_KEY`,
    `YANDEX_GPT_API_KEY`, `TG_API_HASH`, `TG_SESSION`) → `is_set: boolean`,
    значение НЕ отдаётся. Несекретные (`ZAI_MODEL`, `ZAI_BASE_URL`,
    `SCHEDULER_POLL_SEC`, `HH_MAX_PER_CYCLE`, `HH_DAILY_LIMIT`,
    `HH_JITTER_MIN`, `HH_JITTER_MAX`, `TG_API_ID`, `DATABASE_URL`) —
    значение видно.
  - action: intent `save` → валидация через zod (переиспользуем части
    `EnvSchema`), atomic write `.env` (temp + rename в той же директории),
    flash «сохранено, перезапустите dev-сервер».
  - UI: форма с группами (AI / Telegram / Scheduler / hh limits / Database),
    чекбоксы «показать секрет» для secret-полей (тогда input text, иначе
    password). Кнопка «Сохранить».
- Тесты: `tests/settings-route.test.ts` — loader маскирует секреты
  (`is_set:true, value:undefined`); action save пишет `.env` (через
  инжектированный writer, мок fs); невалидный ввод → errors.

### 6. Вынос seed-логики в `app/sources/seed.ts`

- `app/sources/seed.ts` (новый): `seedHh()`, `seedWellfound()`,
  `seedTelegram()` — вынесенная логика из `scripts/seed-*.ts`. Чистые функции,
  работают с repo, idempotent. Возвращают `{ source_id, profile_id, created }`.
- `scripts/seed-hh.ts`, `scripts/seed-wellfound.ts`, `scripts/seed-telegram.ts`:
  становятся тонкими обёртками (`await seedHh()` + console.log).
- Тесты: `tests/sources-seed.test.ts` — idempotent (дважды seedHh → второй
  раз `created:false`), создаёт source+profile.

### 7. Навигация + стили + npm scripts

- `app/routes/_index.tsx`: всем SECTIONS проставить `href` (vacancies →
  `/vacancies` если есть, иначе убрать из кликабельных; sources, settings —
  новые). Добавить пункт «Настройки» → `/settings`.
- `app/app.css`: стили для плашки scheduler-статуса, карточек sources,
  groups в settings (переиспользуем существующие `.card`/`.form`/`.badge`).
- `package.json`: убрать дублирование (seed-скрипты теперь обёртки, но
  команды оставляем — обратно совместимо).
- README: новая секция «Управление через UI» — что доступно из браузера,
  когда всё ещё нужен терминал (первый `npm install`, `db:migrate`,
  `npm run dev`).

## Acceptance

- **Дашборд**: кнопка «↻ Собрать вакансии» создаёт `collect_vacancies` job
  (видно на `/jobs`); показывается последний завершённый цикл (stats).
- **`/jobs`**: плашка статуса scheduler (▶ запущен / ⏸ остановлен) с
  кнопками «Запустить»/«Остановить». Start → процесс `npm run scheduler`
  живёт (виден в `data/processes/scheduler.json` + лог пишется). Stop →
  процесс корректно умирает по SIGTERM. Хвост лога отображается.
- **`/sources`**: карточка на каждый источник с реальным статусом сессии
  (✓ если session-файл/TG_SESSION есть). Seed — idempotent create. Login —
  spawn headed-браузера (процесс виден в manager, окно открывается у
  пользователя). Collect — энкейтит job.
- **`/settings`**: форма редактирования env; секреты НЕ отдаются в loader
  (только `is_set`); сохранение атомарно пишет `.env`; показывается
  подсказка о перезапуске dev-сервера.
- **seed-рефакторинг**: `scripts/seed-*.ts` — тонкие обёртки над
  `app/sources/seed.ts`; CLI-команды работают как раньше (обратная совместимость).
- **Навигация**: все секции дашборда кликабельны (где есть роут); есть
  пункт «Настройки».
- `npm run typecheck` чист. Автотесты зелёные (новые: processes-manager,
  sources-route, settings-route, sources-seed; обновл.: jobs-route,
  index-route). Smoke: вручную проверить start/stop scheduler из UI и
  collect_now с моком collect (или реальным, если есть hh-сессия).

## Constraints / out-of-scope

- **Не трогаем** существующие оркестраторы (`collectVacancies`, `matchAll`,
  `generateDraftsAll`, `submitApplication`) — только вызываем/энкьетим.
- **Не встраиваем** scheduler в dev-сервер — остаётся spawn-процессом.
- **Миграции БД из UI** (`db:generate`/`db:migrate`) — ОТЛОЖЕНО. Это редкая
  операция, риск data-loss; оставляем в терминале. (Возможно отдельной фазой
  позже, с подтверждением и бэкапом.)
- **Stealth-check / smoke-тесты** — остаются CLI-only (диагностика, не
  типовая операция).
- **`vacancies` роут** — если его ещё нет, в этой фазе не добавляем полный
  UI просмотра вакансий (только если тривиально; иначе отдельная фаза).
  Секция «Вакансии» на дашборде остаётся без href, как сейчас.
- **Ротация логов** процессов — вне scope (single-user, ручная чистка
  `data/logs/`).
- **Применение env без рестарта** — невозможно (env парсится при старте
  процесса); даём честную подсказку. Hot-reload env — отдельная сложная фаза.
