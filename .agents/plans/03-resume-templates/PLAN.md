---
phase: 03
plan: resume-templates
status: planned
created: 2026-07-10
must_haves:
  truths:
    - "Схема resume_templates уже в app/db/schema.ts (фаза 02) — миграция НЕ нужна."
    - "db — синглтон в app/db/index.ts; репозиторий resume_templates импортирует db оттуда же (правило проекта, как sources/vacancies/applications)."
    - "Корневая директория исходников — app/ (решение STATE.md). Маршруты — flatRoutes в app/routes/ (routing.md: route-per-file, co-located loader/action)."
    - "better-sqlite3 — sync API; db.select/insert/update дают .get()/.all(), db.query.*.findMany — thenable (смешанная модель, как в существующих репо)."
---

# Plan: 03 — resume-templates

## Goal

Дать пользователю первый полезный экран: управлять несколькими резюме-шаблонами
(под разные роли/направления) через веб-UI. Полный стек — тонкий CRUD-репозиторий
поверх готовой таблицы `resume_templates` + маршруты React Router v7 (список,
создание, редактирование, удаление) + импорт markdown и PDF-текста в `content_md`.
+ CRUD-тесты репозитория на in-memory SQLite.

Это первая фаза с UI и первая, где репозиторий покрывается тестами — закладывает
паттерн для последующих UI-фаз (review-ui 10, draft-generator 09).

## Не-цели (out of scope)

- AI-адаптация резюме под вакансию — фаза 09 (draft-generator).
- Матчинг resume↔vacancy — фаза 08 (matcher).
- Хранение бинарного PDF-файла — извлекаем только текст в `content_md`.
- Редактор с preview рендера markdown — обычная `<textarea>` (preview отложим).

## Background / референсы

- **Схема готова** — `app/db/schema.ts:177` `resume_templates` (name, role,
  summary, skills_json, experience_json, content_md, is_active, timestamps).
  Миграция НЕ требуется.
- **Стиль репозитория** — `app/db/repositories/sources.ts` как эталон: `$inferSelect`/`$inferInsert`,
  DTO с распарсенным JSON, zod на границе, `toJson`/`fromJson` из `_shared.ts`,
  нативная пагинация `.limit().offset()`, no-op на пустой patch в `update`.
- **Маршрут-эталон** — `app/routes/_index.tsx`: Route.LoaderArgs, co-located loader,
  чистый UI-компонент + тонкая обёртка default export.
- **Маршрутизация** — `app/routes.ts` использует `flatRoutes()` (file-based).
  Новые файлы в `app/routes/` подхватываются автоматически.
- **Тест-эталон** — `tests/smoke.test.tsx` (vitest + @testing-library/react).

## Решения (из discuss)

1. **Объём:** репозиторий + UI (маршруты RR7: list/create/edit/delete).
2. **experience_json:** строгая zod-схема `{ company, role, period:{from,to|null}, description }[]`.
3. **Загрузка:** markdown напрямую в `content_md` + PDF через `pdf-parse`
   (извлечённый текст в `content_md`, бинарник не храним).
4. **Тесты:** CRUD-тесты репозитория на in-memory SQLite.

## Steps

### 1. Zod-схемы опыта и навыков — `app/db/repositories/_shared.ts`

Добавить в `_shared.ts` (рядом с `sourceConfigSchema`):

```ts
export const skillsSchema = z.array(z.string());

export const experienceItemSchema = z.object({
  company: z.string(),
  role: z.string(),
  period: z.object({
    from: z.string(),            // "2022-01"
    to: z.string().nullable(),   // null = «по настоящее время»
  }),
  description: z.string(),
});
export const experienceSchema = z.array(experienceItemSchema);
export type ExperienceItem = z.infer<typeof experienceItemSchema>;
```

Комментарий в `_shared.ts` обновить: speculative-схемы skills/experience теперь
объявлены под resume_templates.

**Acceptance:** `skillsSchema`, `experienceSchema`, `ExperienceItem` экспортируются;
`typecheck` чистый.

### 2. Репозиторий — `app/db/repositories/resume_templates.ts`

Новый файл, паритет по структуре с `sources.ts`:

- `ResumeTemplate = typeof resume_templates.$inferSelect`, `NewResumeTemplate = $inferInsert`.
- `CreateResumeTemplateInput` — `{ name, role, summary, skills: string[], experience: ExperienceItem[], content_md, is_active? }`.
- `ResumeTemplateDTO` — `Omit<ResumeTemplate, "skills_json" | "experience_json"> & { skills: string[]; experience: ExperienceItem[] }`.
- `toDTO(row)` — парсит `skills_json`→`skillsSchema`, `experience_json`→`experienceSchema`.
- `create(input)` — zod-валидация skills/experience, `toJson` в `*_json`, `.returning().get()` с проверкой на undefined.
- `findById(id): ResumeTemplateDTO | undefined` — `db.select().where(eq).get()`.
- `list(opts): ResumeTemplateDTO[]` — `db.select().from(resume_templates).limit().offset().all().map(toDTO)`. Сортировка по `updated_at desc` (визуально логично для UI списка).
- `update(id, patch)` — patch по полям name/role/summary/skills/experience/content_md/is_active; skills/experience через zod+toJson; no-op на пустой patch (как sources).
- `remove(id)` — `db.delete(resume_templates).where(eq).run()`; возвращает `boolean` (changes > 0).

Добавить в barrel `app/db/repositories/index.ts`:
`export * as resumeTemplatesRepo from "./resume_templates";`

**Acceptance:** все функции типизированы, `typecheck` чистый, DTO возвращает
распарсенные `skills`/`experience` (не сырые `*_json`).

### 3. Тестируемость БД-слоя — функция `createDb`

Текущий `app/db/index.ts` создаёт синглтон `db` на `env.DATABASE_URL` напрямую.
Для тестов на in-memory SQLite нужна возможность открыть отдельное соединение.

Решение (минимально-инвазивное): вынести фабрику `createDb(path)` в
`app/db/index.ts`, синглтон `db` остаётся как `createDb(dbPath)`. Репозитории
продолжают импортировать `db` — их код НЕ меняется. Тестовый хелпер создаёт
своё in-memory соединение через ту же фабрику + применяет схему.

```ts
// app/db/index.ts — добавляется:
export function createDb(path: string | ":memory:") {
  return drizzle(new Database(path), { schema });
}
export const db = createDb(dbPath);
```

In-memory в тестах: `new Database(":memory:")` + накат схемы. Схема накатывается
через `migrate()` из `drizzle-orm/better-sqlite3/migrator` (миграции уже в
`./drizzle/`), ЛИБО через ручной `db.run(sql)` для каждой `CREATE TABLE`.
Решение принимается на шаге реализации: migrator надёжнее (использует готовые
миграции), но для `:memory:` нужен путь к папке миграций — проверить работает ли.

**Acceptance:** `createDb` экспортируется; `db` не сломан; репозитории не
изменены; in-memory соединение создаётся и схема в нём жива (таблицы есть).

### 4. Тесты репозитория — `tests/resume-templates.test.ts`

In-memory SQLite, накат схемы, CRUD на репозитории:

- **setup:** `beforeEach` — новое in-memory соединение через `createDb(":memory:")`,
  накат схемы, подмена `db` в модуле репозитория (vi.mock ИЛИ инъекция — см. шаг 3,
  инъекция чище, но требует, чтобы репозиторий брал db из импорта; если vi.mock
  громоздко — переходим к dependency-injection: репозиторий экспортирует фабрику
  `createResumeTemplatesRepo(db)` + дефолтный синглтон для feature-кода). Решение
  по DI vs mock принимается при реализации шага 3/4 совместно.
- **create + findById:** создать → найти по id → поля совпадают, skills/experience
  распарсены корректно.
- **list:** создать 3 → list() возвращает 3, сортировка updated_at desc.
- **list пагинация:** list({limit:2, offset:1}) → средний элемент.
- **update:** обновить name + skills → поля изменились, experience без изменений.
- **update no-op:** пустой patch → строка не изменилась, возвращается текущая.
- **update zod-guard:** невалидный experience (нет company) → бросает.
- **remove:** удалить → list() не содержит, remove несуществующего → false.

**Acceptance:** все тесты зелёные; `npm test` проходит целиком.

### 5. Импорт markdown/PDF — `app/resumes/import.ts`

Новая директория `app/resumes/` (feature-модуль).

- Зависимость: `pdf-parse` (добавить в `package.json` dependencies).
- `importMarkdown(content: string): { content_md: string }` — по сути passthrough,
  но явная точка для будущей нормализации (trim, BOM-удаление).
- `importPdf(buffer: Buffer): { content_md: string }` — `pdfParse(buffer).text`,
  trim. Бросает понятную ошибку при пустом/невалидном PDF.
- `detectKind(filename: string): "md" | "pdf" | null` — по расширению.

**Acceptance:** `typecheck` чистый; функции экспортируются; pdf-parse в deps.

### 6. UI маршруты — `app/routes/resumes.*.tsx`

Создать маршруты (flatRoutes подхватит по имени файла):

**6a. `app/routes/resumes._index.tsx`** — список шаблонов
- loader: `resumeTemplatesRepo.list()` → `{ templates: ResumeTemplateDTO[] }`.
- UI: таблица/список карточек (name, role, is_active, updated_at); кнопка «Создать»
  → `/resumes/new`; клик по карточке → `/resumes/:id/edit`.

**6b. `app/routes/resumes.new.tsx`** — создание
- loader: пустой (или справочники, если нужны).
- action: multipart/form-data (есть загрузка файла) ИЛИ две формы:
  - основная форма (name, role, summary, skills через запятую, content_md textarea);
  - загрузка файла (md/pdf) → `importMarkdown`/`importPdf` → подставить в content_md.
  Решение по форме: единая форма с опциональным файловым полем — если файл загружен,
  content_md берётся из него (поле content_md игнорируется/преобладает). Проще для
  пользователя. Принять как дефолт при реализации.
- UI: форма, валидация ошибок (возврат с сообщениями), редирект на список после успеха.
- experience: в этой фазе упрощённо — НЕ редактируется через UI формы (форма опыта
  сложна: массив объектов с периодами). Опыт задаётся через content_md (markdown)
  или прямым JSON-полем advanced. UI-редактор опыта — отложенный TODO (занести в
  SUMMARY как known-limitation). Поле в форме: опциональная textarea «Опыт (JSON)»
  с подсказкой структуры; если пусто — `[]`.

**6c. `app/routes/resumes.$id.edit.tsx`** — редактирование
- loader: `resumeTemplatesRepo.findById(params.id)` → 404 если нет.
- action: та же форма, что new; DELETE через intent-кнопку (`?intent=delete` или
  отдельная форма action=destroy — принять при реализации).
- UI: предзаполненная форма.

**6d. (опционально) `app/routes/resumes.$id.destroy.tsx`** или intent в edit.
- action-only маршрут: `resumeTemplatesRepo.remove(id)`, redirect на список.
- Решение: intent-кнопка внутри edit (один action с ветвлением по `formData.get("intent")`)
  — меньше файлов, соответствует RR7 action-модели. Принять как дефолт.

**Acceptance:**
- `/resumes` показывает список; `/resumes/new` создаёт; `/resumes/:id/edit` редактирует.
- Загрузка .md и .pdf заполняет content_md.
- typecheck чистый; smoke-тест не сломан; маршрут `/` (дашборд) не затронут.
- Кнопка удаления работает (intent в edit-action).

## Acceptance (общие для фазы)

- [ ] `npm run typecheck` — без ошибок.
- [ ] `npm test` — все тесты зелёные (smoke + новые resume-templates CRUD).
- [ ] `resumeTemplatesRepo` экспортируется из `~/db/repositories`, стиль паритетен sources.
- [ ] UI: можно создать, отредактировать, удалить шаблон через браузер (проверить вручную `npm run dev`).
- [ ] Загрузка markdown и PDF заполняет content_md.
- [ ] Дашборд `/` не сломан; существующие репозитории (sources/vacancies/applications) не тронуты.
- [ ] `createDb` вынесена; `db`-синглтон работает как прежде.
- [ ] pdf-parse добавлен в dependencies; package-lock обновлён.
- [ ] Опыт не редактируется через UI-форму — занесено в SUMMARY как known-limitation.

## Риски / открытые точки (решить при реализации)

1. **DI vs vi.mock для тестов** — шаг 3/4. Если vi.mock `~/db` ломает типы или
   громоздок → перейдём к экспорту фабрики `createResumeTemplatesRepo(db)` +
   дефолтного синглтона. Это слегка меняет форму остальных репозиториев, но
   только в смысле добавления фабрики (не ломает feature-код).
2. **migrator на `:memory:`** — шаг 3. `drizzle-orm/better-sqlite3/migrator`
   `migrate(db, { migrationsFolder })` теоретически работает с in-memory, но
   нужен путь к `./drizzle`. Запасной вариант: ручные `CREATE TABLE` из
   генерируемых SQL-строк. Проверить эмпирически.
3. **experience в UI** — осознанно минимален (JSON-textarea). Полноценный
   редактор опыта — отдельная задача (не блокирует matcher, т.к. тот читает
   experience_json напрямую из БД, а заносить данные можно и через JSON-поле).
