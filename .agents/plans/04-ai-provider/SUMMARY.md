# Summary: 04 — ai-provider

**Статус:** complete ✓ (2026-07-10)
**План:** [.agents/plans/04-ai-provider/PLAN.md](./PLAN.md)

## Что сделано

Первый AI-слой проекта: абстракция провайдера + реализация **z.ai** (GLM-5.2) +
промпт-шаблоны + `generateCoverLetter(applicationId)` с записью в `cover_letters`.
End-to-end срез (БД → промпт → LLM → БД), который фаза 09 (draft-generator)
расширит UI-оркестрацией и адаптацией резюме.

1. **Интерфейс `AiProvider`** (`app/ai/types.ts`) — общий контракт для всех
   провайдеров (z.ai сейчас; Yandex/GigaChat — потом). `AiProviderError` несёт
   HTTP status + business code; `isRetryableError` отличает rate-limit от фатальных.
2. **Провайдер z.ai** (`app/ai/providers/zai.ts`) — Bearer-аутентификация,
   настраиваемый base URL (env), zod-валидация ответа, retry (1 попытка) на
   1312/1313, классификация ошибок (auth / balance / model-not-available).
3. **Промпты** (`app/ai/prompts/coverLetter.ts`) — локализованные (ru/en),
   truncation контекста (защита от лимита токенов), жёсткие ограничения в system.
4. **`generateCoverLetter`** (`app/ai/generateCoverLetter.ts`) — загружает
   application + relations (vacancy→company, resume), парсит `skills_json`,
   вызывает z.ai, пишет результат в `cover_letters` (upsert).
5. **Репозиторий `cover_letters`** — CRUD + `upsert` по `UNIQUE(application_id)`,
   `updateBody` для ручного редактирования (review-ui 10), barrel-export.
6. **`applications.findById`** расширен nested `vacancy.company` (для имени
   компании в промпте).
7. **env**: `ZAI_API_KEY`, `ZAI_MODEL` (glm-5.2), `ZAI_BASE_URL`.
8. **enum `aiProviders`** += `"zai"`.

## Acceptance — все зелёные

- ✅ `npm run typecheck` — без ошибок.
- ✅ `npm test` — 30/30 (smoke 3 + resume 12 + ai-zai 10 + generate 5).
- ✅ `ZaiProvider` реализует `AiProvider`; `zai` синглтон.
- ✅ Ошибки классифицированы; retry на 1312/1313 (не на balance/auth).
- ✅ `generateCoverLetter` → запись в `cover_letters` (upsert; повторная генерация
  обновляет одну запись).
- ✅ enum `aiProviders` включает `zai`; `env.ZAI_*` типизированы.
- ✅ Существующие маршруты фазы 03 не сломаны.
- ✅ Промпты локализованы (ru дефолт, en вариант).

## 🔑 Живой smoke-тест к z.ai — успешен

`npx tsx scripts/smoke-zai.ts` — реальный вызов к GLM-5.2 на ключе из `.env`.
Сгенерировано качественное сопроводительное письмо на русском (889 символов),
опирающееся на данные вакансии и резюме.

## 🔑 Ключевая находка во время разработки

**Смена курса:** vision.md и решения STATE.md упоминали Yandex GPT. Пользователь
уточнил — PRO-подписка **z.ai** (Zhipu AI). Используем её. Все решения
перенесены в STATE.md (фаза 4).

**GLM Coding Plan требует dedicated endpoint.** Стандартный endpoint
`/api/paas/v4` возвращал `1113 Insufficient balance` для ключа от PRO-подписки —
это известный кейс, описанный в доках z.ai (`devpack/faq`). Решение:
GLM Coding Plan использует `https://api.z.ai/api/coding/paas/v4` (вместо
`/api/paas/v4`). Base URL сделан настраиваемым через `ZAI_BASE_URL` (дефолт —
coding endpoint), чтобы при переключении на обычный аккаунт (pay-as-you-go)
достаточно было сменить env-переменную.

## Known limitations / решения

- **Адаптация резюме** (отдельный генератор) — фаза 09. Здесь только cover letter.
- **UI** для запуска генерации / просмотра черновиков — фаза 09/10.
- **Оркестрация** (очередь `generate_draft`, троттлинг) — фаза 12 (scheduler).
  Здесь — синхронная функция.
- **Streaming** — не нужен для фоновой генерации (stream=false).
- **Retry-логика** минимальна: 1 повторная попытка на 1312/1313 (2с задержка).
  429 без retryable-кода (например balance 1113) НЕ повторяется — повтор не поможет.
- **`dotenv` не добавлен** — smoke-скрипт грузит `.env` вручную (без новой
  зависимости), т.к. dev-сервер RR7/Vite грузит `.env` сам.
- **Latency GLM-5.2** — ~38с на генерацию письма (с reasoning). Для фоновой
  генерации приемлемо; для синхронного UI — фаза 09 должна делать это async
  с индикатором.

## Ссылки

- Файлы: `app/ai/` (4 модуля), `app/db/repositories/cover_letters.ts`, `scripts/smoke-zai.ts`.
- Решения в STATE.md: фаза 4 (4 записи о смене провайдера, аутентификации, объёме, модели/локали).
