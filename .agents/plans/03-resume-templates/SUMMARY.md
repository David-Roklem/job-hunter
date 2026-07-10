# Summary: 03 — resume-templates

**Статус:** complete ✓ (2026-07-10)
**План:** [.agents/plans/03-resume-templates/PLAN.md](./PLAN.md)

## Что сделано

Фаза дала пользователю первый полезный экран — управление несколькими
резюме-шаблонами (под разные роли/направления) через веб-UI. Полный стек:

1. **Zod-схемы** `skillsSchema`/`experienceSchema`/`ExperienceItem` в
   `app/db/repositories/_shared.ts` — строгая валидация опыта
   `{ company, role, period{from,to|null}, description }[]`, подготовлена под
   matcher (08) и draft-generator (09).
2. **Репозиторий** `app/db/repositories/resume_templates.ts` — CRUD в стиле
   `sources.ts`: `create`/`findById`/`list`/`update`/`remove`, DTO с
   распарсенными `skills`/`experience`, нативная пагинация, no-op на пустой
   patch. Экспорт через barrel `~/db/repositories`.
3. **`createDb()` фабрика** в `app/db/index.ts` + `db`-синглтон —
   репозитории не изменены, но открыта возможность in-memory соединения для
   тестов.
4. **Тесты** `tests/resume-templates.test.ts` — 12 CRUD-тестов на in-memory
   SQLite (`vi.mock("~/db")` + migrator). Алиас `~` добавлен в
   `vitest.config.ts` (раньше был только в `vite.config.ts`).
5. **Импорт markdown/PDF** `app/resumes/import.ts` — `importMarkdown`
   (passthrough + нормализация), `importPdf` через `pdf-parse` v2 (извлечённый
   текст в `content_md`, бинарник не храним), `detectKind`.
6. **UI-маршруты** (React Router v7, flatRoutes):
   - `resumes._index.tsx` — список шаблонов (name, role, is_active, updated_at);
   - `resumes.new.tsx` — создание (единая multipart-форма, файл переопределяет content_md);
   - `resumes.$id.edit.tsx` — редактирование + удаление (intent=delete).

## Acceptance — все зелёные

- ✅ `npm run typecheck` — без ошибок
- ✅ `npm test` — 15/15 (smoke + 12 resume-templates CRUD)
- ✅ `resumeTemplatesRepo` экспортируется, стиль паритетен `sources.ts`
- ✅ Ручная проверка UI (`npm run dev`): список, создание, редактирование,
  удаление, валидация пустых полей, загрузка .md — всё работает; дашборд `/`
  не затронут; несуществующий id → 404.
- ✅ `createDb` вынесена; `db`-синглтон работает как прежде
- ✅ pdf-parse добавлен в dependencies (`^2.4.5`); package-lock обновлён

## Known limitations / решения

- **Опыт не редактируется через UI-форму.** Форма опыта сложна (массив объектов
  с периодами), поэтому в этой фазе опыт задаётся опциональной JSON-textarea
  (по умолчанию `[]`). Полноценный UI-редактор опыта — отложенный TODO. Не
  блокирует matcher (08): тот читает `experience_json` напрямую из БД.
- **DI vs vi.mock (риск #1) — решён в пользу vi.mock.** Первоначально план
  допускал dependency-injection (репозиторий-фабрика `createResumeTemplatesRepo(db)`),
  но это нарушило бы единообразие с тремя существующими репозиториями
  (sources/vacancies/applications). Добавление алиаса `~` в `vitest.config.ts`
  сделало `vi.mock("~/db")` чистым и предсказуемым. Зафиксировано в STATE.md.
- **migrator на `:memory:` (риск #2) — работает.** `drizzle-orm/better-sqlite3/migrator`
  корректно применяет миграции к in-memory соединению с путём к `./drizzle`.

## ⚠️ Важно для dev/first-run

При первом запуске (или после клонирования репозитория) **необходимо применить
миграции** к локальной базе:

```bash
npm run db:migrate
```

Без этого маршруты, читающие БД (`/resumes` и др.), вернут `no such table`.
Скрипт `db:migrate` (`drizzle-kit migrate`) уже есть в `package.json`, но фазы
02 и 03 не прогоняли его в ходе разработки — миграция применялась только сейчас,
при ручной проверке UI. README стоит дополнить этим шагом (отложено — вне scope
этой фазы).

## Ссылки

- Коммиты: `1d7fae6` (03-1) → `6c0e8c6` (03-2) → `2c7405e` (03-4) → `cf8e871` (03-5) → `eb1f07a` (03-6)
- Решения в STATE.md: фаза 03 (4 записи)
