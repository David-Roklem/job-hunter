# wellfound-selectors-fix — ПАУЗА перед планированием

> План ещё не создан (`soly new` не вызывался). Пауза снята на этапе
> **разведки контекста** — до написания PLAN.md.

## Где остановились

Пользователь выбрал следующий план: **`wellfound-selectors-fix`** — закрыть
открытую нить из `camoufox-stealth` (селекторы Wellfound не совпадают с
реальностью → `collect-wellfound` собирает 0 вакансий).

### Блокер планирования

Чтобы переписать `selectors.ts` + `parsers.ts`, нужен **реальный HTML
Wellfound** (страница поиска после рендера SPA). Сейчас есть только
**синтетические** фикстуры:
- `tests/fixtures/wellfound-search.html` (32 строки)
- `tests/fixtures/wellfound-vacancy.html` (19 строки)

Они основаны на **best-guess `data-testid`**, который в реальности
**отсутствует** (найдено smoke'ом в camoufox-stealth). Реальная структура:
карточки на **Tailwind-классах** + `a[href*="/jobs/ID-slug"]`.

Без дампа любой новый селектор — снова гадание.

## Точка продолжения

1. **Решить, как получить дамп** — три варианта были предложены (см. ниже),
   пользователь выбор отложил. Возобновить с этого вопроса.
2. После получения дампа: `soly_workflow({ action: "new", target: "wellfound-selectors-fix" })`.
3. План: переписать `selectors.ts` (Tailwind + `a[href*="/jobs/"]`) и
   `parsers.ts`, обновить фикстуры под реальную структуру, повторить
   `npm run wellfound:collect` smoke.

## Развилка дампа (3 варианта, выбор отложен)

| # | Вариант | Что нужно от пользователя |
|---|---------|---------------------------|
| 1 | **Camoufox dump-скрипт** ⭐рекоменд. | Написать временный `scripts/wellfound-dump.ts` (поверх `app/browser/launcher`+`session`), пользователь запускает вручную (как `wellfound:login`), дамп сохраняется в `data/wellfound-dump-search.html`. |
| 2 | Ручной дамп от пользователя | Логин в обычном браузере → страница поиска → Save Page As → положить HTML в `data/`. Кода не пишем. |
| 3 | Флаг `--dump-html` в `collect-wellfound.ts` | Переиспользовать готовый collect, вместо парсинга сохранять HTML. Меньше нового кода, но contaminates production-скрипт флагом. |

## Контекст для планировщика (canonical refs)

- `app/wellfound/selectors.ts` — текущие неверные селекторы (`data-testid`)
- `app/wellfound/parsers.ts` — `parseSearchResults` / `parseVacancyDetail` / `parseSalary` (последний валиден, не трогать)
- `app/wellfound/collect.ts` — collect-цикл (общий с hh)
- `app/wellfound/session.ts` — Camoufox-сессия (`createContext` через python-bridge)
- `app/browser/launcher.ts` + `app/browser/session.ts` — переиспользуемый стек Camoufox
- `scripts/collect-wellfound.ts` + `scripts/wellfound-login.ts` — CLI-точки входа
- `tests/wellfound-parsers.test.ts` + `tests/wellfound-filter.test.ts` + `tests/wellfound-collect.test.ts` — тесты на синтетике (фикстуры обновить вместе с селекторами)
- `tests/fixtures/wellfound-*.html` — синтетические фикстуры (заменить на реальные после дампа)
- `.agents/plans/camoufox-stealth/SUMMARY.md` — источник проблемы («Out-of-Scope Issues»)
