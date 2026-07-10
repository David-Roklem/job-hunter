---
phase: 04
plan: ai-provider
status: planned
created: 2026-07-10
must_haves:
  truths:
    - "Провайдер z.ai (Zhipu AI), НЕ Yandex GPT — см. решение STATE.md (фаза 4). У пользователя PRO-подписка z.ai."
    - "Аутентификация z.ai: прямой API-ключ через Authorization: Bearer (без IAM-обмена/refresh, как у Yandex). Актуально по docs.z.ai на 2026-06."
    - "Endpoint: https://api.z.ai/api/paas/v4/chat/completions — OpenAI-совместимый (messages с role system/user, temperature, stream=false)."
    - "Модель — из env (ZAI_MODEL, дефолт glm-5.1), не хардкод. Язык промптов — параметр локали (русский по умолчанию, заложена мультиязычность под будущие зарубежные площадки)."
    - "enum aiProviders в schema.ts сейчас ['yandex','gigachat'] — НЕ содержит zai. Требуется миграция (добавить 'zai') и обновление типа AiProvider."
    - "cover_letters.body_md / ai_provider / model / generated_at — куда пишем результат. 1:1 с applications по UNIQUE(application_id)."
    - "Доступ к БД — через db-синглтон из app/db/index.ts (правило проекта, как все репозитории)."
---

# Plan: 04 — ai-provider

## Goal

Первый AI-слой проекта: абстракция провайдера (`AiProvider` интерфейс) +
реализация для **z.ai** (Zhipu AI, GLM-5.1) + промпт-шаблоны для сопроводительного
письма + функция `generateCoverLetter(applicationId)`, вызывающая LLM и
записывающая результат в `cover_letters`. Это первый end-to-end срез
AI-функциональности (ввод из БД → LLM → запись в БД), который фаза 09
(draft-generator) расширит UI-оркестрацией и адаптацией резюме.

**Смена курса:** vision.md и решения STATE.md упоминали Yandex GPT. Пользователь
уточнил — у него PRO-подписка **z.ai**; используем её. Yandex/GigaChat остаются
как возможные будущие провайдеры через тот же интерфейс.

## Не-цели (out of scope)

- **Адаптация резюме** под вакансию (отдельный генератор) — фаза 09.
- **UI** для запуска генерации / просмотра черновиков — фаза 09 (review-ui 10).
- **Оркестрация** (очередь задач `generate_draft`, троттлинг) — фаза 12 (scheduler).
  Здесь — синхронная функция, вызываемая напрямую.
- **Streaming** ответа — не нужен для фоновой генерации черновиков (stream=false).
- **Embeddings / vision / multimodal** — только text chat completion.

## Background / референсы

- **z.ai API (актуально, context7 / docs.z.ai, 2026-06):**
  - `POST https://api.z.ai/api/paas/v4/chat/completions`
  - Header: `Authorization: Bearer <ZAI_API_KEY>`, `Content-Type: application/json`.
  - Body: `{ model, messages: [{role, content}], temperature, stream: false }`.
  - Response: `{ choices: [{ message: { content } }] }`.
  - Ошибки: HTTP status (401/429/500) + внутренний business code в теле
    (1311 — подписка не покрывает модель; 1312 — перегрузка модели; 1313 —
    rate limit; 1002/1003 — токен невалиден/истёк; 1113 — arrears).
- **env** (`app/env.server.ts`): уже есть `YANDEX_GPT_API_KEY` (опц.) —
  оставляем для совместимости; добавляем `ZAI_API_KEY` (опц.) и `ZAI_MODEL`
  (опц., дефолт `glm-5.1`).
- **Стиль репозитория** — `app/db/repositories/sources.ts` как эталон: функции от
  `db`-синглтона, DTO, zod на границе, barrel-export.
- **Стиль feature-модуля** — `app/resumes/` (фаза 03): feature-код живёт в
  `app/<feature>/`, обращается к данным через репозитории.
- **Тест-эталон** — `tests/resume-templates.test.ts`: vi.mock + in-memory SQLite.
  Для провайдера добавляется мок HTTP (см. шаг 4).

## Решения (из discuss)

1. **Объём:** провайдер-слой + промпты + `generateCoverLetter(applicationId)` → запись в `cover_letters.body_md`.
2. **Провайдер:** z.ai (GLM-5.1) через интерфейс `AiProvider`; другие провайдеры — потом.
3. **Аутентификация:** прямой API-ключ Bearer (без IAM).
4. **Модель:** из env (`ZAI_MODEL`), дефолт `glm-5.1`.
5. **Язык промптов:** параметризуется локалью (русский дефолт, заложена мультиязычность).
6. **Тесты:** моки HTTP для провайдера + unit-тест generateCoverLetter на in-memory БД.

## Steps

### 1. Миграция: добавить провайдер `zai` — `app/db/schema.ts` + `drizzle/`

Enum `aiProviders` сейчас `["yandex", "gigachat"]`. Добавить `"zai"`:

```ts
export const aiProviders = ["zai", "yandex", "gigachat"] as const;
```

Сгенерировать новую миграцию (`npm run db:generate`) и применить (`npm run db:migrate`).
SQLite хранит enum как TEXT — существующие строки (с `ai_provider IS NULL` или
без записи) не затронуты; `zai` становится допустимым значением.

**Acceptance:** `type AiProvider` включает `"zai"`; миграция применена; typecheck чистый.

### 2. env + конфигурация — `app/env.server.ts`, `.env.example`

```ts
// app/env.server.ts — добавить в EnvSchema:
ZAI_API_KEY: z.string().optional(),
ZAI_MODEL: z.string().default("glm-5.1"),
// YANDEX_GPT_API_KEY оставить как есть (совместимость).
```

`.env.example`: секция Yandex → пометить как deprecated/будущее; добавить секцию z.ai
с комментарием о PRO-подписке и ссылкой `https://docs.z.ai/`.

**Acceptance:** `env.ZAI_API_KEY`, `env.ZAI_MODEL` типизированы; `.env.example` обновлён.

### 3. Интерфейс `AiProvider` + типы запроса — `app/ai/types.ts`

Новая директория `app/ai/` (feature-модуль, как `app/resumes/`).

```ts
// app/ai/types.ts
/** Роль сообщения в chat completion (OpenAI-совместимая). */
export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = { role: ChatRole; content: string };

/** Вход провайдера — минимальный общий контракт. */
export type ChatRequest = {
  messages: ChatMessage[];
  model?: string;          // переопределить дефолт env
  temperature?: number;    // дефолт зависит от промпта
};

/** Выход провайдера. */
export type ChatResponse = {
  content: string;         // choices[0].message.content
  model: string;           // фактически использованная модель
  provider: string;        // "zai" | ...
};

/** Ошибка провайдера — несёт HTTP status и business code (если есть). */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly code?: number,    // внутренний код z.ai (1311/1312/...)
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

/** Контракт, который реализует каждый провайдер. */
export interface AiProvider {
  readonly name: string;       // "zai"
  chat(req: ChatRequest): Promise<ChatResponse>;
}
```

**Acceptance:** типы экспортируются; `AiProviderError` различает auth/rate-limit/model ошибки по `code`.

### 4. Реализация провайдера z.ai — `app/ai/providers/zai.ts`

```ts
// app/ai/providers/zai.ts
import { env } from "~/env.server";
import { AiProviderError, type AiProvider, type ChatRequest, type ChatResponse } from "../types";

const ENDPOINT = "https://api.z.ai/api/paas/v4/chat/completions";

export class ZaiProvider implements AiProvider {
  readonly name = "zai";

  constructor(
    private readonly apiKey: string | undefined = env.ZAI_API_KEY,
    private readonly defaultModel: string = env.ZAI_MODEL,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.apiKey) {
      throw new AiProviderError("ZAI_API_KEY не задан в окружении", this.name);
    }
    const model = req.model ?? this.defaultModel;
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        stream: false,
      }),
    });

    if (!res.ok) {
      // Разбор ошибки: тело { code, message } + HTTP status.
      let body: { code?: number; message?: string } = {};
      try { body = await res.json(); } catch { /* не JSON — игнорируем */ }
      throw new AiProviderError(
        body.message ?? `z.ai HTTP ${res.status}`,
        this.name,
        res.status,
        body.code,
      );
    }

    const data: unknown = await res.json();
    // zod-валидация ответа (см. ниже) — вытащить choices[0].message.content.
    const content = extractContent(data);
    return { content, model, provider: this.name };
  }
}

/** Дефолтный синглтон для feature-кода. */
export const zai = new ZaiProvider();
```

**zod-валидация ответа** (внутри `extractContent`): схема
`{ choices: [{ message: { content: string } }] }` — узкая, бросает
`AiProviderError` при неожиданной форме.

**Retry-логика (минимальная):** на 429 (rate limit) и 1312 (перегрузка модели) —
одна повторная попытка с задержкой 2с. На 401/1002/1003 (auth) и 400 (параметры) —
без retry (неустранимо). Реализуется в `chat` через обёртку (без внешних
retry-библиотек — простой try/catch + sleep).

**Acceptance:**
- `ZaiProvider` реализует `AiProvider`; `zai` синглтон экспортируется.
- Ошибки классифицированы (auth vs rate-limit vs model-not-available).
- Retry только на 429/1312.
- zod-валидация ответа; typecheck чистый.

### 5. Тесты провайдера (моки fetch) — `tests/ai-zai.test.ts`

Юнит-тесты `ZaiProvider` с подменой `globalThis.fetch` (vi.spyOn / vi.fn).
Не нужен nock/fetch-mock — нативный fetch мокается напрямую.

- **успешный ответ:** мок возвращает `{ choices: [{ message: { content: "письмо" } }] }` → `chat` возвращает content.
- **нет API-ключа:** конструктор без ключа → `AiProviderError` "ZAI_API_KEY не задан".
- **401 auth:** мок 401 → `AiProviderError` со status=401, без retry.
- **429 → retry:** первый вызов 429, второй 200 → успешный результат (проверить 2 вызова fetch).
- **1312 (перегрузка модели):** тело `{ code: 1312 }` + 200/429 → retry → успех.
- **1311 (модель недоступна в подписке):** тело `{ code: 1311 }` → ошибка БЕЗ retry.
- **невалидная форма ответа:** `{ foo: "bar" }` → `AiProviderError` от zod.

**Acceptance:** все тесты зелёные; реальная сеть не дёргается (fetch замокан).

### 6. Промпт-шаблоны — `app/ai/prompts/coverLetter.ts`

```ts
// app/ai/prompts/coverLetter.ts
import type { ChatMessage } from "../types";

/** Контекст для генерации письма (данные из БД, уже собранные). */
export type CoverLetterInput = {
  vacancy: { title: string; company?: string; description: string; location?: string };
  resume: { name: string; role: string; summary?: string; skills: string[]; content_md?: string };
  locale: "ru" | "en";        // мультиязычность — параметр (дефолт ru)
};

/** Собирает system + user сообщения для генерации сопроводительного. */
export function buildCoverLetterMessages(input: CoverLetterInput): ChatMessage[] {
  // system: роль помощника по найму + жёсткие ограничения (длина, тон, язык ответа).
  // user: структурированный контекст вакансии + резюме.
  // Промпты локализованы: ru/en варианты (параметр locale).
  // ...реализация с шаблонами строк...
}
```

**Дизайн промпта (кратко):**
- **system** (ru): «Ты — карьерный консультант. Напиши сопроводительное письмо
  на русском, 3–4 абзаца, без шаблонных клише, с опорой на совпадение навыков
  из резюме и требований вакансии. Не выдумывай факты.»
- **user**: блок «ВАКАНСИЯ» (title, company, location, описание) + блок «РЕЗЮМЕ»
  (role, summary, навыки, выдержка из content_md).
- **locale=en** — английский вариант (под будущие зарубежные площадки).

**Acceptance:** `buildCoverLetterMessages` возвращает `[{role:"system",...},{role:"user",...}]`;
locale параметризован; typecheck чистый.

### 7. Функция генерации + запись в БД — `app/ai/generateCoverLetter.ts`

```ts
// app/ai/generateCoverLetter.ts
import { zai } from "./providers/zai";
import { buildCoverLetterMessages } from "./prompts/coverLetter";
import { coverLettersRepo } from "~/db/repositories";  // см. шаг 8
import { applicationsRepo, vacanciesRepo, resumeTemplatesRepo } from "~/db/repositories";

export type GenerateOptions = { locale?: "ru" | "en"; model?: string };

/** Генерирует сопроводительное для application и пишет в cover_letters. */
export async function generateCoverLetter(
  applicationId: number,
  opts: GenerateOptions = {},
): Promise<{ body_md: string; model: string }> {
  // 1. Загрузить application + связанные vacancy/resume.
  const app = applicationsRepo.findById(applicationId);
  if (!app) throw new Error(`application ${applicationId} not found`);
  const vacancy = vacanciesRepo.findById(app.vacancy_id);
  const resume = resumeTemplatesRepo.findById(app.resume_template_id);
  if (!vacancy || !resume) throw new Error(`missing vacancy/resume for application ${applicationId}`);

  // 2. Собрать промпт.
  const messages = buildCoverLetterMessages({ vacancy: toVacancyCtx(vacancy), resume: toResumeCtx(resume), locale: opts.locale ?? "ru" });

  // 3. Вызвать провайдер.
  const resp = await zai.chat({ messages, model: opts.model, temperature: 0.7 });

  // 4. Записать в cover_letters (upsert по application_id — UNIQUE).
  coverLettersRepo.upsert({
    application_id: applicationId,
    body_md: resp.content,
    ai_provider: "zai",
    model: resp.model,
  });
  return { body_md: resp.content, model: resp.model };
}
```

**Acceptance:** функция собирает ввод из БД, вызывает `zai`, пишет результат;
бросает понятные ошибки при отсутствии application/vacancy/resume; typecheck чистый.

### 8. Репозиторий `cover_letters` — `app/db/repositories/cover_letters.ts`

Новый репозиторий (паритет с `sources.ts`), нужен для записи/чтения писем:

- `CoverLetter = typeof cover_letters.$inferSelect`, типы ввода.
- `upsert({ application_id, body_md, ai_provider, model })` — INSERT ... ON CONFLICT(application_id) DO UPDATE
  (UNIQUE уже есть): обновляет `body_md`/`ai_provider`/`model`/`generated_at`, сбрасывает `edited_at`.
- `findByApplicationId(application_id): CoverLetterDTO | undefined`.
- `list(opts): CoverLetterDTO[]`.
- `update(id, { body_md })` — ручное редактирование (для review-ui 10), обновляет `edited_at`.
- barrel-export в `app/db/repositories/index.ts`: `export * as coverLettersRepo`.

**Acceptance:** `upsert` работает по UNIQUE(application_id); typecheck чистый; стиль паритетен sources.

### 9. Интеграционный тест generateCoverLetter — `tests/generate-cover-letter.test.ts`

In-memory SQLite (как resume-templates.test.ts) + мок `zai.chat`:

- **seed:** создать source → company → vacancy → resume_template → application.
- **генерация:** замокать `zai.chat` → вернуть `{ content: "письмо...", model: "glm-5.1" }`;
  вызвать `generateCoverLetter(applicationId)` → `coverLettersRepo.findByApplicationId` возвращает письмо.
- **повторная генерация (upsert):** вызвать дважды → одна запись, body_md обновлён.
- **нет application:** `generateCoverLetter(999)` → бросает.
- **провайдер бросает:** замокать `zai.chat` → throw → `generateCoverLetter` пробрасывает, ничего не пишет в БД.

**Acceptance:** тесты зелёные; БД-взаимодействие на in-memory; сеть не дёргается.

## Acceptance (общие для фазы)

- [ ] `npm run typecheck` — без ошибок.
- [ ] `npm test` — все тесты зелёные (smoke + resume-templates + ai-zai + generate-cover-letter).
- [ ] `ZaiProvider` реализует `AiProvider`; `zai` синглтон.
- [ ] Ошибки классифицированы (auth / rate-limit / model-not-available); retry на 429/1312.
- [ ] `generateCoverLetter(applicationId)` → запись в `cover_letters` (upsert).
- [ ] enum `aiProviders` включает `zai`; миграция применена.
- [ ] `env.ZAI_API_KEY` / `env.ZAI_MODEL` типизированы; `.env.example` обновлён.
- [ ] Существующие репозитории и маршруты фазы 03 не сломаны (`/resumes` работает).
- [ ] Промпты локализованы (ru дефолт, en вариант).

## Риски / открытые точки (решить при реализации)

1. **Мок fetch vs внешняя библиотека.** Нативный `globalThis.fetch` мокается через
   `vi.spyOn(globalThis, "fetch")` — без nock/fetch-mock (меньше зависимостей).
   Проверить, что vi корректно восстанавливает fetch между тестами (`vi.restoreAllMocks`).
2. **Retry на 1312.** Business code 1312 может приходить с HTTP 200 (успех оболочки,
   ошибка внутри) ИЛИ 429 — нужно разбирать тело ответа в обоих ветках. Проверить по
   факту на шаге 4; если двусмысленно — retry только по телу `{code:1312}`.
3. **PRO-подписка и лимиты.** 1311 (модель недоступна в плане) — проинформировать
   пользователя, что нужно выбрать модель из подписки (env `ZAI_MODEL`). Не блокирует.
4. **env в тестах провайдера.** `ZaiProvider` читает `env.ZAI_API_KEY` через дефолт
   конструктора; в тестах ключ передаётся явно (`new ZaiProvider("test-key")`),
   чтобы не зависеть от `process.env`. DI через конструктор, как в шаге 4.
5. **Длина контекста.** `vacancy.description` может быть длинным; если упрёмся в
   лимит контекста GLM-5.1 — обрежем description в `buildCoverLetterMessages`
   (truncation по символам). Пока закладываем как есть; проверить на шаге 9 интеграционно.
