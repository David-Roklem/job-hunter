# job_hunter

Персональный локальный помощник поиска работы на **международном и зарубежном рынке**
(с сохранением российского рынка через hh.ru). Собирает вакансии из hh.ru,
международных агреггаторов (Wellfound) и сайтов компаний, сопоставляет
с несколькими версиями резюме, готовит черновики откликов и сопроводительных
писем через AI — человек только подтверждает.

> **Статус:** bootstrap + data-модель + resume-templates + AI-провайдер (z.ai) +
> сборщики hh.ru и Wellfound. Matcher, review-UI, автоотклик — в следующих фазах.

## Стек

- **React Router v7** (framework mode) + Vite + TypeScript strict
- **SQLite** через **better-sqlite3** + **Drizzle ORM** (реляционный query API, миграции)
- **Zod** для валидации окружения
- **Camoufox** (модифицированный Firefox, FingerprintForge на уровне движка) для сбора
  вакансий — анти-детект нативно, обходит Cloudflare-бот-детект
- **cheerio** для парсинга HTML
- **Vitest** + Testing Library для тестов

## Быстрый старт (< 5 минут)

Требуется **Node.js 22+** (проверено на 24).

```bash
# 1. Установить JS-зависимости
npm install

# 2. Установить Python-bridge (Camoufox launcher)
#    Требуется uv (https://docs.astral.sh/uv/) и Python 3.12+
cd python-bridge && uv sync && cd ..
uv run --project python-bridge python -m camoufox fetch   # скачать Firefox (~1 GB, один раз)

# 3. Настроить окружение
cp .env.example .env

# 4. Сгенерировать и применить миграции БД
npm run db:generate
npm run db:migrate

# 5. Запустить dev-сервер
npm run dev
```

Откройте http://localhost:5173 — увидите дашборд со статусом `status: ok`.

> **Camoufox через Python-bridge:** сбор вакансий использует модифицированный Firefox
> (Camoufox, FingerprintForge на уровне движка). Node spawn'ит Python-сервер
> (`uv run python python-bridge/serve.py`), который запускает браузер и отдаёт
> WebSocket endpoint для подключения через `firefox.connect()`. Это обходит
> Cloudflare bot-detect, на котором падал обычный Playwright/Chromium.
>
> **Cloudflare по IP:** если `wellfound:login` всё равно получает «Access
> temporarily restricted» — запустите под VPN.

## Команды

| Команда              | Описание                                              |
| -------------------- | ----------------------------------------------------- |
| `npm run dev`        | Dev-сервер с HMR                                      |
| `npm run build`      | Production-сборка                                     |
| `npm run start`      | Запуск production-сервера                             |
| `npm run typecheck`  | Проверка типов (strict)                               |
| `npm run test`       | Запуск тестов (Vitest)                                |
| `npm run test:watch` | Тесты в watch-режиме                                  |
| `npm run db:generate`| Генерация SQL-миграций из `app/db/schema.ts`          |
| `npm run db:migrate` | Применение миграций к SQLite                          |
| `npm run hh:seed`    | Создать source + profile для hh.ru в БД               |
| `npm run hh:login`   | Ручной логин на hh.ru (headed Camoufox, куки персист.) |
| `npm run hh:collect` | Сбор вакансий с hh.ru (headless)                      |
| `npm run hh:apply`   | Авто-отклик на одобренную application (Playwright)     |
| `npm run hh:map-resumes` | Сопоставить resume_template_id → hh resume_id       |
| `npm run match`      | Матчинг вакансия↔резюме (rule-префильтр + AI-скор)    |
| `npm run generate-drafts` | Генерация сопроводительных (батч)                  |
| `npm run scheduler`  | Фоновый планировщик: collect→match→draft→apply (фаза 12) |
| `npm run smoke:scheduler` | Smoke инвариантов очереди (БД-слой)               |
| `npm run hh:stealth-check` | Диагностика fingerprint на bot.sannysoft.com    |
| `npm run wellfound:seed` | Создать source + profile для Wellfound в БД        |
| `npm run wellfound:login` | Ручной логин на Wellfound (headed Camoufox)       |
| `npm run wellfound:collect` | Сбор вакансий с Wellfound (headless)           |

## Структура

### Планировщик (фаза 12)

Фоновый воркер крутит цикл `collect → match → generate_draft` и исполняет
`apply_hh` (создаётся только при одобрении отклика в `/applications`).

```bash
npm run scheduler          # standalone tsx-воркер (poll каждые 30с)
```

Env (опционально):

| Переменная            | Дефолт | Описание                                       |
| --------------------- | ------ | ---------------------------------------------- |
| `SCHEDULER_POLL_SEC`  | 30     | Интервал poll очереди                          |
| `HH_MAX_PER_CYCLE`    | 20     | Максимум apply за один poll воркера            |
| `HH_DAILY_LIMIT`      | 80     | Суточный лимит apply к hh (защита от бана)     |
| `HH_JITTER_MIN`/`MAX` | 15000/60000 | Диапазон jitter перед apply, мс           |

Apply создаётся **только** action `/applications/:id` approve — воркер его
исполняет через `applyThrottle` (jitter + cycle-cap + daily-cap). Цикл
`collect→match→draft` запускается энкьютом корневого `collect_vacancies`
(внешним cron или вручную). UI очереди — `/jobs` (pause/resume/retry).

## Структура

```
app/
├── root.tsx          # корневой layout (html, meta, error boundary)
├── routes.ts         # file-based routing (flatRoutes)
├── app.css           # базовые стили дашборда
├── env.server.ts     # zod-валидация process.env (единый источник конфига)
├── routes/
│   ├── _index.tsx         # дашборд `/` — loader возвращает { status, version }
│   ├── resumes._index.tsx     # список резюме-шаблонов
│   ├── resumes.new.tsx        # создание шаблона (вкл. загрузку .md/.pdf)
│   └── resumes.$id.edit.tsx   # редактирование + удаление (intent=delete)
├── resumes/                # feature-модуль: импорт markdown/PDF
│   ├── import.ts           # importMarkdown / importPdf (pdf-parse) / detectKind
│   ├── parseForm.ts        # разбор multipart-формы шаблона
│   └── ResumeForm.tsx      # переиспользуемая форма (new + edit)
└── db/
    ├── index.ts      # открытие SQLite-соединения + createDb() фабрика (для тестов)
    ├── schema.ts     # Drizzle-схема: 9 таблиц (sources, vacancies, resume_templates, ...)
    └── repositories/ # тонкий CRUD без бизнес-логики
        ├── _shared.ts       # типы, zod-схемы JSON-полей, toJson/fromJson
        ├── sources.ts       # CRUD источников вакансий
        ├── vacancies.ts     # CRUD вакансий (дедупликация UNIQUE source+external)
        ├── applications.ts  # CRUD откликов
        ├── resume_templates.ts # CRUD резюме-шаблонов
        └── index.ts         # barrel-export
tests/
└── smoke.test.tsx    # smoke-тест: заголовок + loader contract
```

## Конвенции

- Маршруты — файлы в `app/routes/`, co-located loader/action, типизация через `Route.LoaderArgs`.
- Конфиг читается только из `app/env.server.ts`, не из `process.env` напрямую.
- SQLite-соединение открывается только в `app/db/index.ts`; feature-код обращается к данным через `app/db/repositories/`.
- `strict: true`, `noUncheckedIndexedAccess`, без `any`.

См. `.agents/` (ROADMAP, STATE, intent-документы) для контекста проекта.
