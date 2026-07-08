# Plan: 02-data-model

## Goal

Спроектировать и реализовать полную data-модель `job_hunter` в Drizzle/SQLite:
восемь сущностей ядра (источники, вакансии, компании, резюме-шаблоны, отклики,
сопроводительные письма, теги, очередь задач) с первой SQL-миграцией и тонкими
репозиториями для доступа. После этой фазы в `./data/job_hunter.sqlite` есть вся
схема под будущие фазы (matcher, draft-generator, scheduler), `db:generate` +
`db:migrate` создают таблицы, а код обращается к данным только через `app/db/`.

Объём фазы — **вся схема одним планом** (без бизнес-логики matcher'а /
генерации черновиков — те добавят свои поля и логику позже).

## Decisions (фиксируются в STATE.md)

- **Объём:** вся схема за одну фазу — 8 таблиц + миграция + тонкие репозитории.
- **Миграции:** SQL-миграции в `./drizzle` через `drizzle-kit generate` /
  `db:migrate`. История изменений схемы версиионируется в git.
- **ID:** `INTEGER PRIMARY KEY AUTOINCREMENT` во всех таблицах — простейший и
  быстрый вариант для локального single-user инструмента.
- **Дедупликация вакансий:** пара `(source_id, external_id)` — UNIQUE-индекс в
  `vacancies`. Дубли в рамках одного источника отбрасываются на insert
  (`onConflictDoNothing`); кросс-источник — через matcher в фазе 08.
- **Тесты БД:** в этой фазе НЕ добавляем — доверяем `drizzle-kit generate` и
  проверяем вручную, что `db:migrate` создаёт таблицы. Тесты CRUD появятся,
  когда фазы matcher/draft-generator добавят бизнес-логику.

## Steps

- **Сущности и таблицы.** Описать в `app/db/schema.ts` восемь таблиц через
  Drizzle SQLite-драйвер. Имена таблиц — во множественном числе (snake_case),
  колонки — snake_case, ts-экспорты — camelCase.
  - `sources` — источник вакансий (hh.ru / company-site / telegram). Поля:
    `id`, `kind` (text: 'hh' | 'company' | 'telegram'), `name` (text),
    `config_json` (text — JSON с настройками: канал/URL/фильтры),
    `created_at`, `updated_at`.
  - `companies` — компания. Поля: `id`, `name`, `website_url?`, `hh_id?`
    (внешний id на hh.ru), `created_at`, `updated_at`.
  - `vacancies` — вакансия. Поля: `id`, `source_id` (→ sources, NOT NULL),
    `external_id` (text NOT NULL — id в рамках источника),
    `company_id?` (→ companies), `title`, `description` (text, сырое тело),
    `salary_from?`, `salary_to?`, `currency?`, `location?`, `employment_type?`
    (full|part|contract|project), `url` (text — каноническая ссылка),
    `raw_json` (text — полный сырой ответ для аудита), `status`
    (text: 'new' | 'matched' | 'applied' | 'rejected' | 'closed', default 'new'),
    `collected_at` (int — когда собрали), `created_at`, `updated_at`.
    **UNIQUE(source_id, external_id).**
  - `resume_templates` — шаблон резюме под роль. Поля: `id`, `name`
    (напр. «Backend Node.js»), `role` (целевая роль), `summary` (text — о себе),
    `skills_json` (text — массив навыков), `experience_json` (text — опыт),
    `content_md` (text — полный markdown/PDF-текст), `is_active` (int 0|1,
    default 1), `created_at`, `updated_at`.
  - `applications` — отклик (вакансия × резюме-шаблон). Поля: `id`,
    `vacancy_id` (→ vacancies, NOT NULL), `resume_template_id`
    (→ resume_templates, NOT NULL), `match_score?` (int 0–100 — от matcher'а),
    `status` (text: 'draft' | 'pending_review' | 'approved' | 'sent' | 'failed'
    | 'rejected', default 'draft'), `submitted_at?`, `created_at`,
    `updated_at`. **UNIQUE(vacancy_id, resume_template_id)** — один шаблон на
    вакансию в одном отклике.
  - `cover_letters` — сопроводительное письмо (AI-черновик). Поля: `id`,
    `application_id` (→ applications, NOT NULL, UNIQUE — 1:1), `body_md`
    (text — markdown тело письма), `ai_provider?` (text: 'yandex' | 'gigachat'),
    `model?`, `generated_at` (int), `edited_at?`, `created_at`, `updated_at`.
  - `tags` + `vacancy_tags` — теги вакансий для фильтрации/скоринга.
    `tags`: `id`, `name` (UNIQUE), `color?`, `created_at`.
    `vacancy_tags`: `vacancy_id` (→ vacancies), `tag_id` (→ tags),
    PRIMARY KEY (`vacancy_id`, `tag_id`) — many-to-many.
  - `jobs` — элемент очереди фоновых задач (для scheduler фазы 12). Поля: `id`,
    `kind` (text: 'collect_vacancies' | 'generate_draft' | 'apply_hh'),
    `payload_json` (text — параметры задачи), `status` (text: 'queued' |
    'running' | 'done' | 'failed' | 'cancelled', default 'queued'),
    `attempts` (int, default 0), `max_attempts` (int, default 3),
    `run_after` (int — ts, когда можно исполнять; для троттлинга),
    `locked_at?` (int — кем/когда захвачено), `error?` (text — последний stack),
    `result_json?` (text), `created_at`, `updated_at`, `finished_at?`.
    Индекс на `(status, run_after)` — планировщик берёт следующую задачу.

- **Отношения (Drizzle relations API).** Завести экспорт `relations` для
  основных связей: `vacancies` ↔ `sources` (many-to-one), `vacancies` ↔
  `companies` (many-to-one), `applications` ↔ `vacancies` +
  `resume_templates` (many-to-one), `cover_letters` ↔ `applications` (one-to-one),
  `vacancies` ↔ `tags` (many-to-many через `vacancy_tags`). Типы — через
  `Relations`-helper из `drizzle-orm`, без `any`.

- **Timestamps-хелпер.** Вынести повторяющиеся `createdAt`/`updatedAt` в
  переиспользуемые константы (напр. `const timestamps = { created_at: integer
  ("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updated_at: integer("updated_at", ...) .$onUpdateFn(() => new Date()) }`) и
  спредить в каждую таблицу — без дублирования. Дата — UNIX-секунды
  (`mode: "timestamp"`).

- **Сгенерировать миграцию.** Запустить `npm run db:generate` — drizzle-kit
  создаёт SQL-миграцию в `./drizzle` (один файл `*.sql` + journal). Проверить,
  что SQL корректен (все 8 таблиц + индексы UNIQUE), закоммитить миграцию в git.

- **Применить миграцию.** `npm run db:migrate` — создаёт таблицы в
  `./data/job_hunter.sqlite`. Проверить вручную (через простой скрипт или
  `sqlite3`/расширение) что все 8 таблиц присутствуют.

- **Тонкие репозитории.** В `app/db/repositories/` — по одному файлу на
  сущность (без бизнес-логики, только CRUD): `vacancies.ts`, `sources.ts`,
  `applications.ts` и т.д. Каждый экспортирует `create(input)`, `findById(id)`,
  `list()` (с опциональным limit/offset), `update(id, patch)`. Используют
  `db` из `app/db/index.ts`. Типы входов — через zod-схемы (`z.object({...})`)
  или экспортируемые `InferSelectModel`/`InferInsertModel` из Drizzle — без
  `any`, всё `unknown`→narrow.

- **export схемы.** В `app/db/schema.ts` добавить финальный `export const schema
  = { sources, companies, vacancies, ... }`-агрегат для drizzle-kit и передачи
  в `drizzle({ schema })` в `app/db/index.ts` (включить `schema` в инициализацию
  соединения, чтобы работали relations-запросы).

- **typecheck + generate без ошибок.** `npm run typecheck` проходит;
  `npm run db:generate` — idempotent (повторный запуск не создаёт новых
  изменений, «No schema changes»).

## Acceptance

- `app/db/schema.ts` описывает все 8 таблиц (`sources`, `companies`,
  `vacancies`, `resume_templates`, `applications`, `cover_letters`, `tags`,
  `vacancy_tags`, `jobs`) с корректными типами Drizzle (без `any`).
- `npm run db:generate` создаёт валидную SQL-миграцию в `./drizzle/`; повторный
  запуск сообщает «No schema changes» (idempotent).
- `npm run db:migrate` создаёт все таблицы в `./data/job_hunter.sqlite`
  (проверяется вручную — список таблиц включает все 8+).
- `UNIQUE(source_id, external_id)` на `vacancies` и `UNIQUE(application_id)` на
  `cover_letters`, `UNIQUE(vacancy_id, resume_template_id)` на `applications`
  присутствуют в SQL-миграции.
- `app/db/repositories/` содержит тонкие CRUD-функции для ключевых сущностей
  (vacancies, sources, applications — минимум), использующие `db` из
  `app/db/index.ts`; типы входов валидируются, `any` нигде нет.
- `app/db/index.ts` инициализирует Drizzle с `schema` (relations доступны).
- `npm run typecheck` проходит без ошибок; `strict: true` соблюдается.
- Доступ к БД — только через `app/db/index.ts` (must_have из фазы 1 сохранён);
  репозитории импортируют `db`, а не открывают соединения.

## must_haves (truths to preserve)

- Схема описана через Drizzle в `app/db/schema.ts`; `any` нигде не используется.
- Все таблицы используют `INTEGER PRIMARY KEY AUTOINCREMENT` (решение по ID).
- Дедупликация вакансий — через `UNIQUE(source_id, external_id)` (решение по
  дедупликации); inserts используют `onConflictDoNothing` по этому индексу.
- Доступ к БД — только через `app/db/index.ts`; репозитории/компоненты не
  открывают SQLite-соединения напрямую (наследие из фазы 1).
- Миграции версиионируются в git (`./drizzle/*.sql` + journal); `db:migrate` —
  единственный способ менять схему в БД.
- JSON-поля (`config_json`, `skills_json`, `experience_json`, `raw_json`,
  `payload_json`, `result_json`) хранятся как `text` — SQLite без нативного
  JSON-типа; валидация/парсинг — на уровне репозиториев (zod).
