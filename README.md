# job_hunter

Персональный локальный помощник поиска работы на российском рынке.
Собирает вакансии из hh.ru, сайтов компаний и Telegram-каналов, сопоставляет
с несколькими версиями резюме, готовит черновики откликов и сопроводительных
писем через Yandex GPT — человек только подтверждает.

> **Статус:** bootstrap + data-модель. Сбор источников, matcher, AI-генерация — в следующих фазах.

## Стек

- **React Router v7** (framework mode) + Vite + TypeScript strict
- **SQLite** через **better-sqlite3** + **Drizzle ORM** (реляционный query API, миграции)
- **Zod** для валидации окружения
- **Vitest** + Testing Library для тестов

## Быстрый старт (< 5 минут)

Требуется **Node.js 22+** (проверено на 24).

```bash
# 1. Установить зависимости
npm install

# 2. Настроить окружение
cp .env.example .env
#   (в bootstrap все ключи опциональны — можно оставить как есть)

# 3. Сгенерировать и применить миграции БД
npm run db:generate
npm run db:migrate

# 4. Запустить dev-сервер
npm run dev
```

Откройте http://localhost:5173 — увидите дашборд со статусом `status: ok`.

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
