# Plan: draft-generator

**Фаза:** 09 (draft-generator) · **Статус:** planned · **Дата:** 2026-07-15

## Goal

Доставить генерацию сопроводительных писем под конкретную вакансию для
откликов, созданных matcher'ом (фаза 08). AI (z.ai/GLM-5.2) пишет письмо на
основе пары вакансия×резюме и сохраняет его в `cover_letters`. Резюме —
загруженный пользователем шаблон как есть (БЕЗ адаптации; опция на потом).
Точки запуска: CLI `npm run generate-drafts` + RR resource route `/drafts` +
smoke-скрипт. Без UI (UI «подтвердить/редактировать/отклонить» — фаза 10).

Это доведение до продакшена уже существующей `generateCoverLetter()` (фаза 04)
— функция есть, но нигде не вызывается. Фаза 09 добавляет батч-оркестрацию и
точки запуска.

## truths (инварианты, НЕ НАРУШАТЬ)

1. **Резюме — статичный загруженный шаблон.** AI генерирует ТОЛЬКО
   сопроводительное письмо. Никакой адаптации/перестановки резюме в этой фазе.
2. **Идемпотентность.** Повторный запуск по тому же application — upsert письма
   (UNIQUE(application_id) в cover_letters), не дубль. `generateDrafts({all})`
   пропускает applications, у которых уже есть письмо.
3. **Continue-on-error.** Ошибка AI на одном application НЕ роняет батч — пара
   фиксируется в `stats.errors[]`, остальные обрабатываются (зеркало matcher 08).
4. **AI не выдумывает факты** — промпт (фаза 04) уже это требует; сохраняем.

## Decisions (из discuss)

| Решение | Почему |
|---|---|
| Только сопроводительное письмо (резюме = шаблон как есть) | Пользователь загружает резюме вручную; AI-адаптация отложена как опция после review-ui (когда реальная потребность проявится). |
| Батч-критерий: `status='draft'` + нет cover_letter | draft — статус, который выставляет matcher (фаза 08). Дедуп через coverLettersRepo.findByApplicationId пропускает обработанные. |
| Запуск: CLI + RR action /drafts + smoke | Зеркало matcher (фаза 08). UI в фазе 10 (review-ui). |
| Continue-on-error mid-batch | При ~100 откликов/день одна transient-ошибка z.ai не должна терять весь прогон. Уже созданные письма сохраняются. |

## Steps

### 1. `app/ai/generateDrafts.ts` — батч-оркестратор

Новый модуль-оркестратор. НЕ трогает `generateCoverLetter()` (фаза 04 — переиспользуем
как есть, она уже пишет в cover_letters через upsert).

```ts
export type GenerateDraftsOptions = {
  /** Только applications с match_score >= порога (опц., по умолчанию без фильтра). */
  minScore?: number;
  /** Локаль промпта (по умолчанию 'ru'). */
  locale?: CoverLetterLocale;
  /** Переопределить модель env (ZAI_MODEL). */
  model?: string;
  /** Температура генерации (пробрасывается в generateCoverLetter). */
  temperature?: number;
};

export type DraftResult = {
  applicationId: number;
  vacancyId: number;
  resumeTemplateId: number;
  success: boolean;
  /** Длина сгенерированного письма (для лога). */
  bodyLength: number;
};

export type DraftError = {
  applicationId: number;
  message: string;
};

export type GenerateDraftsStats = {
  /** Сколько candidates (draft без письма) найдено. */
  candidates: number;
  /** Сколько писем успешно сгенерировано. */
  generated: number;
  /** Сколько пропущено (filter minScore / уже есть письмо). */
  skipped: number;
  /** Ошибки AI mid-batch (continue-on-error). */
  errors: DraftError[];
  /** Детали по каждой паре (для CLI-вывода). */
  results: DraftResult[];
};
```

**`generateDraftsOne(applicationId, opts)`** — обёртка над `generateCoverLetter`
для одного application. Возвращает `DraftResult`. Бросает если application не
найден (как generateCoverLetter).

**`generateDraftsAll(opts)`** — батч:
1. `applicationsRepo.list({ status: "draft" })` — все draft-отклики.
2. Фильтр `minScore` (если задан) по `application.match_score`.
3. Фильтр «нет письма» — `coverLettersRepo.findByApplicationId(app.id)` undefined.
4. Для каждого кандидата — `try/catch` вокруг `generateCoverLetter`:
   - успех → `results.push({success:true, bodyLength})`
   - ошибка → `errors.push({applicationId, message})` (continue-on-error)
5. Возвращает `GenerateDraftsStats`.

### 2. `scripts/generate-drafts.ts` — CLI

Зеркало `scripts/match.ts`. `loadEnv()` из `scripts/_env.ts` перед dynamic imports.

Аргументы (минимальный парсер, как match.ts):
- `--application=<id>` — одно письмо (generateDraftsOne)
- `--all` — батч (generateDraftsAll)
- `--threshold=<n>` — minScore (опц.)
- `--max=<n>` — лимит кандидатов (опц., для тестов/дешёвых прогонов)
- `--locale=ru|en` (опц., по умолчанию ru)

Вывод: для одного — тело письма; для батча — сводка
(`candidates / generated / skipped / errors`) + список ошибок если есть.
Exit codes: 0 — OK; 1 — нет кандидатов / неверные аргументы.

Скрипт в `package.json`: `"generate-drafts": "tsx scripts/generate-drafts.ts"`.

### 3. `app/routes/drafts.ts` — RR resource route

Зеркало `app/routes/matcher.ts`. Только `action` (POST), без loader (без UI).

Вход (JSON или form-data, зеркало matcher.ts — `intent`-паттерн):
```json
{ "intent": "one", "applicationId": 42 }       // одно
{ "intent": "all", "threshold": 60 }          // батч
```

Ответ:
- 200 + `{ result: DraftResult }` (одно) или `{ stats: GenerateDraftsStats }` (батч)
- 400 — невалидный вход / нет intent
- 404 — application не найден (одно)
- 500 — обёрнуто в `{ error: string }`

### 4. `scripts/smoke-drafts.ts` — ручной smoke

Зеркало `scripts/smoke-match.ts`. Пропуск без `ZAI_API_KEY` (exit 0, сообщение).
Если задан `--application=<id>` — генерит для него; иначе берёт первый
candidate (draft без письма), warn если нет.

### 5. Тесты

**`tests/generate-drafts.test.ts`** — vi.mock zai + in-memory БД (как
`tests/generate-cover-letter.test.ts` и `tests/matcher-match.test.ts`).

Кейсы:
- `generateDraftsOne` — успех: письмо записано, result.success=true, bodyLength>0
- `generateDraftsOne` — несуществующий application → бросает (делегирует generateCoverLetter)
- `generateDraftsOne` — ошибка AI → бросает (проброс)
- `generateDraftsAll` — батчит candidates (draft без письма)
- `generateDraftsAll` — пропускает applications УЖЕ с письмом (дедуп)
- `generateDraftsAll` — `minScore` отсекает слабые скоры (skipped считается)
- `generateDraftsAll` — continue-on-error: mid-batch ошибка → в errors[], батч продолжается, частичный результат сохранён
- `generateDraftsAll` — игнорирует applications не-'draft' статуса
- `generateDraftsAll` — нет candidates → stats.candidates=0, generated=0, errors=[]

## Acceptance

- [ ] `app/ai/generateDrafts.ts` — generateDraftsOne + generateDraftsAll +
      типы (DraftResult/DraftError/GenerateDraftsStats/GenerateDraftsOptions).
- [ ] `generateCoverLetter()` (фаза 04) переиспользуется БЕЗ изменений.
- [ ] `scripts/generate-drafts.ts` + `npm run generate-drafts`
      (--application / --all / --threshold / --max / --locale).
- [ ] `app/routes/drafts.ts` — RR action (JSON + form-data), 200/400/404/500.
- [ ] `scripts/smoke-drafts.ts` — пропуск без ZAI_API_KEY.
- [ ] `tests/generate-drafts.test.ts` (~9 тестов) — vi.mock zai + in-memory БД;
      все сценарии (one успех/ошибка/нет application, батч/дедуп/threshold/
      continue-on-error/не-draft/пусто).
- [ ] `npm test` (зелёный, +~9 новых) и `npm run typecheck` (чистый).
- [ ] Ручной smoke pending (нужен ZAI_API_KEY) — отдельный шаг, не блокер merge.

## Out of scope

- UI «подтвердить/редактировать/отклонить» — фаза 10 (review-ui).
- AI-адаптация резюме — отложено как опция после review-ui.
- Фоновый планировщик (авто-запуск generateDraftsAll) — фаза 12 (scheduler).
- Счётчик регенераций / версионность писем — пока upsert перезаписывает.

<!-- soly:status:begin -->
## Status

**Goal met:** YES

### Acceptance
- [x] `app/ai/generateDrafts.ts` — generateDraftsOne + generateDraftsAll + типы — создан (5.5KB), 2 public-функции + 4 типа.
- [x] `generateCoverLetter()` (фаза 04) переиспользуется БЕЗ изменений — generateDrafts импортирует и вызывает её напрямую (не reimplements).
- [x] `scripts/generate-drafts.ts` + `npm run generate-drafts` — скрипт создан, script добавлен в package.json:28.
- [x] `app/routes/drafts.ts` — RR action (JSON + form-data), 200/400/404/500 — создан, intent-паттерн как matcher.
- [x] `scripts/smoke-drafts.ts` — пропуск без ZAI_API_KEY — создан, early-return с warn.
- [x] `tests/generate-drafts.test.ts` (~9 тестов) — создано 10 тестов (one: 3, all: 7), vi.mock zai + in-memory БД.
- [x] `npm test` (зелёный, +~9 новых) и `npm run typecheck` (чистый) — 205/205 passed (+10 новых), tsc чистый.
- [x] Ручной smoke pending (нужен ZAI_API_KEY) — smoke-скрипт готов, прогон отдельным шагом после review.

**Verdict:** PASS
<!-- soly:status:end -->
