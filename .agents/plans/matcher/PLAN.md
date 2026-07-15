# Plan: matcher

_Матчинг вакансия↔резюме-шаблон: rule-based префильтр → AI-скоринг (z.ai) →
запись `applications` с `match_score`._

## Goal

Вакансии, собранные фазами 05–07 (hh / wellfound / telegram, `status='new'`),
сопоставляются с активными `resume_templates`. Для каждой пары (vacancy ×
resume_template) считается `match_score` 0–100 (целое) и rationale. Прошедшие
порог создаются как `applications` (`status='matched'`, `match_score`), а
вакансия переводится в `status='matched'`. Matcher запускается CLI-скриптом
(батч) и RR7 action (разово/по вакансии). UI инбокса — фаза 10; здесь только
логика + БД + автотесты.

## Контекст и решения

- **Алгоритм — двухуровневый:** rule-based префильтр (дёшево, детерминированно)
  отсекает нерелевантное до дорогого AI-запроса; z.ai доскаживает скор только
  прошедшим префильтр парам.
- **Score — целое 0–100** (совпадает с `applications.match_score` integer).
- **AI-ответ — JSON `{score, rationale}`**, rationale логируется/возвращается из
  `match()`, в БД НЕ персистится (нет колонки).
- **Результат — `applications`** (`vacancy_id`, `resume_template_id`,
  `match_score`, `status='draft'` — НЕ 'matched', т.к. такого значения нет в
  enum `applicationStatuses`; 'matched' — только `vacancy.status`) +
  `vacancy.status='matched'`. `draft-generator` (фаза 09) найдёт эти
  applications и наполнит их письмом (→ `status='pending_review'`).
- **Без UI** (инбокс — фаза 10 review-ui).
- **Тесты:** vi.mock zai (на match-логику/префильтр/маппинг), ручной smoke
  отдельно (как smoke-zai из фазы 04).

## Steps

### 1. Rule-based префильтр — `app/matcher/prefilter.ts`

Детерминированная функция `prefilter(vacancy, resume): boolean`:
- **Текст вакансии** = `title + '\n' + description` (lowercased).
- **Нормализация навыков:** lower-case, trim; учет базовых синонимов через
  простую map (напр. `react.js → react`, `node.js → node`, `ts → typescript`)
  — компактный словарь в `prefilter.ts`, расширяемо.
- **Условие прохождения:** хотя бы `MIN_SKILL_HITS` (дефолт 1) навыков из
  `resume.skills` найдены в тексте вакансии.
- Чистая функция без БД/AI — тривиально юнит-тестируется.

### 2. AI-скоринг — промпт `app/ai/prompts/match.ts`

- `buildMatchMessages({ vacancy, resume, companyName }) → ChatMessage[]`.
- System: ролевая инструкция — «оцени релевантность кандидата вакансии».
  Вернуть **СТРОГО JSON** `{"score": 0-100, "rationale": "<1-2 предложения>"}`.
  Учитывать: совпадение стека/навыков, уровень опыта, роль; штраф за отсутствие
  ключевых требований. Без markdown-обёртки.
- User: title + company + excerpt описания вакансии (с лимитом `MAX_DESC_CHARS`,
  по аналогии с salary.ts) + роль + skills + summary резюме.
- Низкая температура (0.2) для устойчивости.
- `parseMatchResponse(content): { score: number; rationale: string }` —
  zod-схема, безопасный fallback (некорректный JSON → бросок, как в salary).

### 3. Feature-функция — `app/matcher/match.ts`

`async function matchVacancy(vacancyId, resumeTemplateId, opts?): Promise<MatchResult>`

Поток:
1. Загрузить vacancy (relations: source, company) и resume_template через репозитории.
2. `prefilter()` — если false → вернуть `{ score: 0, rationale: "не прошёл префильтр", passed: false }` (БЕЗ AI, БЕЗ создания application).
3. `provider.chat(buildMatchMessages(...))` → `parseMatchResponse()`.
4. Опционально: если `score >= MATCH_THRESHOLD` (дефолт 50, из opts/env) —
   `applicationsRepo.create({ vacancy_id, resume_template_id, match_score: score, status: 'matched' })`
   + `vacanciesRepo.update(vacancyId, { status: 'matched' })`.
   `applicationsRepo.findByVacancyAndResume` сначала (идемпотентность: повторный матч не создаёт дубль, а обновляет score).
5. Вернуть `{ score, rationale, passed, applicationId?, provider, model }`.

Параметризация: `opts.provider` (дефолт `zai`), `opts.model` (env `ZAI_MODEL`),
`opts.threshold`, `opts.locale` (под будущую мультиязычность; дефолт `ru`).
Пробрасывает `AiProviderError` (как `generateCoverLetter`).

`async function matchAll(opts?): Promise<{ scanned: number; aiCalls: number; matched: number }>` — батч:
итерация по `vacanciesRepo.list({ status: 'new' })` × активные `resume_templates`.
Для каждого резюме — только лучший скор по вакансии (если несколько резюме
матчат одну вакансию, создаётся несколько applications, каждое со своим score).

### 4. CLI — `scripts/match.ts` + npm-скрипт `match`

По образцу `collect-telegram.ts` (`loadEnv`, `parseArgs`, `main`):
```
npm run match -- --vacancy=<id> [--resume=<id>]      # разовый
npm run match -- --all [--threshold=50] [--max=200]   # батч по status='new'
```
Печатает статистику и таблицу {vacancy × resume → score, passed}.

### 5. RR7 action — `app/routes/matcher.ts` (resource route, без UI)

- `action()` принимает `{ intent: 'one' | 'all', vacancyId?, resumeId?, threshold? }`,
  вызывает `matchVacancy` / `matchAll`, возвращает JSON-результат.
- Без `default export` (resource route — только action). Используется будущим
  review-ui (фаза 10) для кнопки «сскорить».
- Без loader/UI.

### 6. Тесты — `tests/matcher-prefilter.test.ts`, `tests/matcher-match.test.ts`

- **prefilter**: синонимы (react.js→react), мин-hits, регистр, empty skills,
  навык в title vs description, кириллические навыки (учитывая `\b` не работает
  для кириллицы — решение из фазы 07: lookbehind `(?<![\p{L}])` с флагом `u`).
- **match.ts**: `vi.mock("~/db")` (in-memory + migrator, как resume-templates.test.ts),
  `vi.mock("../ai/providers/zai")` (возвращает фиксированный JSON),
  `vi.mock("../ai/match"` если нужно изолировать промпт. Сценарии:
  - префильтр отсёк → нет AI-вызова, нет application, score=0;
  - AI дал score≥threshold → application создан, vacancy→matched;
  - score<threshold → нет application, vacancy остаётся 'new';
  - идемпотентность: повторный match обновляет score, не создаёт дубль;
  - AiProviderError пробрасывается, ничего не пишется.
- Регресс: `npm test && npm run typecheck` остаются зелёными.

### 7. Smoke (ручной, вне автотестов) — `scripts/smoke-match.ts`

По образцу `smoke-zai.ts`: на реальных данных из БД (vacancies `status='new'`,
реальные resume_templates) прогнать `matchVacancy` и напечатать score+rationale.
Требует `ZAI_API_KEY`. Не падает сборку, если ключа нет (пропуск).

## Acceptance

- [x] `app/matcher/prefilter.ts` — чистая `prefilter(vacancy, resume)` с
      синоним-словарём и кириллицей-безопасным матчем; юнит-тесты зелёные.
- [x] `app/ai/prompts/match.ts` — `buildMatchMessages` + `parseMatchResponse`
      (zod), возвращает `{score, rationale}`.
- [x] `app/matcher/match.ts` — `matchVacancy` (префильтр→AI→запись) и `matchAll`;
      идемпотентность (findByVacancyAndResume перед create/update); проброс
      AiProviderError без записи в БД.
- [x] `applications.match_score` (0–100) создаются только при `score≥threshold`
      со `status='draft'` (matcher НЕ ставит 'matched' на application — этого
      значения нет в enum); `vacancy.status='matched'` обновляется.
- [x] `scripts/match.ts` + `npm run match` — CLI (разовый и --all), статистика.
- [x] `app/routes/matcher.ts` — resource route с action (one/all), без UI.
- [x] `tests/matcher-*.test.ts` — vi.mock zai + in-memory БД; все сценарии выше.
- [x] `npm test` (190/190, +28 новых) и `npm run typecheck` зелёные.
- [ ] STATE.md обновлён (фаза 08 complete, решения), SUMMARY.md создан.

## Out of scope

- UI инбокса (фаза 10 review-ui).
- Адаптация резюме/письма (фаза 09 draft-generator).
- Персист rationale в БД (миграция) — rationale только в логе/результате.
- Авто-выбор «лучшего» резюме при множественном матче — все подходящие создаются
  как отдельные applications; выбор шаблона — в review-ui.

<!-- soly:status:begin -->
## Status

**Goal met:** YES

### Acceptance
- [x] `app/matcher/prefilter.ts` — чистая `prefilter(vacancy, resume)` с
      синоним-словарём и кириллицей-безопасным матчем; 14/14 юнит-тестов зелёные.
- [x] `app/ai/prompts/match.ts` — `buildMatchMessages` + `parseMatchResponse`
      (zod `matchResponseSchema`), возвращает `{score, rationale}`; strip markdown-обёртки.
- [x] `app/matcher/match.ts` — `matchVacancy` (префильтр→AI→запись) и `matchAll`;
      идемпотентность (findByVacancyAndResume перед create/update); проброс
      AiProviderError без записи в БД (тест подтверждает).
- [x] `applications.match_score` (0–100) создаются только при `score≥threshold`
      со `status='draft'` (matcher НЕ ставит 'matched' на application — этого
      значения нет в enum applicationStatuses); `vacancy.status='matched'`.
- [x] `scripts/match.ts` + `npm run match` — CLI (разовый `--vacancy` и `--all`), статистика.
- [x] `app/routes/matcher.ts` — resource route с `action` (one/all), без UI/loader.
- [x] `tests/matcher-prefilter.test.ts` (14) + `tests/matcher-match.test.ts` (19,
      вкл. 5 edge-case) — vi.mock zai + in-memory БД; все сценарии (отсечение
      префильтром, score≥/\<threshold, границы 0/50/100, идемпотентность,
      AiProviderError, невалидный JSON, markdown-fence, неактивное резюме,
      matchAll батч/max/status + mid-batch continue-on-error).
- [x] `npm test` (195/195, +33 новых) и `npm run typecheck` зелёные.
- [ ] STATE.md обновлён (фаза 08 complete, решения), SUMMARY.md создан — в процессе close-out.

**Verdict:** PASS — gaps remain only in the close-out step (SUMMARY + STATE update),
which is performed after this verification per the workflow.
<!-- soly:status:end -->
