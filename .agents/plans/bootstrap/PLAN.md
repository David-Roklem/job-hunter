# Plan: bootstrap

## Goal

Создать работающий локально скелет Remix + Vite + TypeScript приложения `job_hunter` с подключённой SQLite/Drizzle, валидируемой через zod конфигурацией окружения, базовым роутом-дашбордом и одним smoke-тестом на Vitest. После этой фазы `npm run dev` поднимает приложение, `npm run typecheck && npm run test` проходят, а в репо есть места (`src/db/schema.ts`, `src/routes/`) куда следующие фазы будут добавлять данные и фичи.

## Steps

- **Инициализировать Remix + Vite проект.** Использовать `create-remix` (Vite template) в текущей директории. TypeScript strict. Привести структуру к виду из `routing.md`: маршруты под `src/routes/<path>.tsx` с co-located loader/action и типизацией `Route.LoaderArgs`. Корневой `root.tsx` + `_index` маршрут.
- **Настроить strict TS + code-style правила.** Включить `strict: true`, `noUncheckedIndexedAccess` (нужен для `unknown` narrowing). Завести `.eslintrc`/`.prettierrc` только если они не приходят из шаблона. Убедиться, что `type` используется для объектных форм, `any` запрещён.
- **Подключить SQLite + Drizzle ORM.** Поставить `better-sqlite3`, `drizzle-orm`, `drizzle-mlib` + `drizzle-kit`. Создать `src/db/index.ts` (создание/чтение соединения, путь к файлу `./data/job_hunter.sqlite`) и `src/db/schema.ts` (пока пустой/минимальный — реальная схема в фазе 2, здесь только заглушка чтобы следующий `db:generate` работал). `drizzle.config.ts` в корне. Скрипт `db:generate` и `db:migrate` в `package.json`.
- **Конфигурация окружения через zod.** Создать `src/env.server.ts`: схема zod с пока опциональными ключами (`NODE_ENV`, `YANDEX_GPT_API_KEY?`, `TELEGRAM_BOT_TOKEN?`, `DATABASE_URL?` со значением по умолчанию `./data/job_hunter.sqlite`). Парсить `process.env`, бросать понятную ошибку со списком невалидных полей при провале. `.env.example` в корне со всеми ключами (с реальными описаниями). `.gitignore` — `.env`, `./data/*.sqlite*`, `node_modules`, `build`, `.cache`.
- **Базовый UI: дашборд `_index`.** Минимальный, без стилевой системы — достаточно семантического HTML + одного `app.css`. Показать заголовок проекта и список будущих секций (Вакансии / Резюме / Отклики / Источники) как заглушки-плейсхолдеры. Loader возвращает `{ status: 'ok', version }` чтобы проверить связку loader↔action↔рендер.
- **Vitest + smoke-тест.** Установить `vitest`, `@testing-library/react`, `jsdom`. Один тест в `tests/smoke.test.tsx`: рендерит `_index` маршрут, проверяет что заголовок «job_hunter» присисутствует и loader возвращает `status: 'ok'`. `vitest.config.ts` с окружением `jsdom`. Скрипты `test` и `test:watch`.
- **npm-скрипты и README.** `dev`, `build`, `start`, `typecheck`, `lint` (если eslint), `test`, `db:generate`, `db:migrate`. Краткий `README.md` с инструкцией: установить зависимости, скопировать `.env.example` → `.env`, `db:migrate`, `npm run dev`. Подготовить первый git-коммит на ветке `bootstrap`.

## Acceptance

- `npm install && npm run dev` поднимает dev-сервер, корневой маршрут `/` рендерит дашборд со статусом из loader'а.
- `npm run typecheck` проходит без ошибок; `strict: true` включён; `any` нигде не используется в новом коде (проверка типов).
- `src/db/index.ts` создаёт/открывает SQLite-файл `./data/job_hunter.sqlite`; `npm run db:generate` отрабатывает без ошибок (генерирует пустую/минимальную миграцию).
- `src/env.server.ts` валидирует `process.env` через zod; при запуске с невалидным `.env` падает с понятным списком ошибок. `.env.example` присутствует и описывает все ключи.
- `npm run test` проходит: smoke-тест зелёный, asserts заголовок + loader `status: 'ok'`.
- Файловая структура соответствует `routing.md`: маршруты под `src/routes/`, loader и action в одном файле, типизация через `Route.LoaderArgs`.
- `.gitignore` корректен (`.env`, `*.sqlite*`, `node_modules`, `build`, `.cache`); ветка `bootstrap` готова к ревью/мёрджу.
- `README.md` описывает как поднять проект за < 5 минут локально.

## must_haves (truths to preserve)

- TypeScript strict включён и соблюдается; `any` не используется.
- Маршруты — файлы под `src/routes/` с co-located loader/action и `Route.LoaderArgs`.
- Конфигурация проходит через zod-валидированный `src/env.server.ts`, а не через прямой `process.env` в коде.
- Доступ к БД — только через `src/db/index.ts`; компоненты не открывают SQLite-соединения напрямую.
- Секреты никогда не попадают в git (`.env` в `.gitignore`).
