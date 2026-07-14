# Plan: source-telegram

_Фаза 07 (source-telegram). План-вставка (как camoufox-stealth), не привязан к
.agents/phases/. Решения discuss зафиксированы ниже в ## Decisions._

## Goal

Добавить Telegram-источник вакансий: чтение публичных каналов через MTProto
(gramjs, user-аккаунт), гибридный парсинг постов (регэкспы-скелет + z.ai для
сложных полей), запись в общую таблицу `vacancies` с дедупликацией по
`(source_id, external_id=message_id)`, бинарный include/exclude фильтр. Список
каналов и курсор последнего поста — в новой таблице `telegram_channels`. Без UI
— только сбор (как фаза 05 source-hh), CLI `npm run telegram:collect`.

**Ключевое отличие от hh/wellfound:** нет браузера/анти-бота — официальный
MTProto через gramjs под user-аккаунтом. Чужие публичные каналы (`@jobs_in_it`
и т.п.) читаются напрямую + полная история постов (Bot API так не умеет — он
только каналы, где бот админ).

## Decisions (из discuss)

1. **Клиент:** MTProto через **gramjs** (`telegram` npm, user-аккаунт). НЕ Bot
   API. api_id/api_hash бесплатно на my.telegram.org; сессия — `StringSession`
   в env `TG_SESSION` (или файл `data/tg-session.txt`).
2. **Парсинг:** **гибрид**. Регэкспы извлекают скелет (title из первой строки /
   жирного текста, url из `t.me/`-ссылок, контакты из `@username`/email/телефона).
   z.ai (фаза 04, `app/ai/zai.ts`) — для зарплаты из свободного текста
   («вилка 250–350к», «$120k», не указана → null). Поэтапно: регэкспы первичны.
3. **Хранение каналов:** новая таблица **`telegram_channels`** (id, source_id,
   username, title, last_message_id курсор, is_active, timestamps). Курсор —
   per-channel, не в sources.config_json.
4. **Объём:** только сбор, без UI (как фаза 05). Управление каналами — seed/CLI.
5. **external_id / url:** `external_id` = `message_id` канала (строка);
   `url` = `https://t.me/<channel>/<message_id>`. Подходит под
   `UNIQUE(source_id, external_id)`.

## Steps

### A. Зависимость + схема
- [x] A1. `npm i telegram` (gramjs v2.26.22). Проверить `npx tsc --noEmit`.
- [x] A2. Миграция БД: новая таблица `telegram_channels` в `app/db/schema.ts`:
  `id` (PK autoincrement), `source_id` (FK→sources, cascade), `username`
  (text not null, unique — без `@`), `title` (text, nullable — имя канала),
  `last_message_id` (integer, default 0 — курсор последнего прочитанного поста),
  `is_active` (boolean, default true), `...timestamps`. + `telegramChannelsRelations`
  (one → sources). `db:generate` → новая миграция в `drizzle/`.
- [x] A3. Репозиторий `app/db/repositories/telegram_channels.ts`: `create`,
  `findById`, `findByUsername`, `list` (опц. `{active:true}`), `updateCursor`
  (last_message_id), `update` (общий), `remove`. Zod-валидация username
  (regex `^[a-zA-Z][a-zA-Z0-9_]{4,31}$` — правило Telegram). Export из
  `app/db/repositories/index.ts`.

### B. gramjs-клиент (сессия)
- [x] B1. `app/telegram/client.ts`: фабрика `createTelegramClient()` —
  читает `TG_API_ID`, `TG_API_HASH`, `TG_SESSION` из env (через
  `app/env.server.ts`, добавить в схему env). `new TelegramClient(new
  StringSession(TG_SESSION ?? ""), apiId, apiHash, { connectionRetries: 5 })`.
  Если `TG_SESSION` пуст → кидает понятную ошибку с инструкцией запустить
  `telegram:login`. НЕ вызывает `start()` здесь (разделяем создание и логин).
- [x] B2. `scripts/telegram-login.ts` (CLI, npm `telegram:login`): интерактивный
  логин — `phoneNumber`/`phoneCode`/`password` через readline, `client.start()`,
  печать `client.session.save()` с инструкцией «положить в .env как TG_SESSION».
  Headed-аналог `wellfound:login` (ручной шаг один раз).

### C. Чтение каналов
- [x] C1. `app/telegram/fetch.ts`: `fetchNewPosts(channel, {limit})` —
  `client.getMessages(channel.username, { limit, minId: channel.last_message_id })`
  → массив постов (текст, message_id, date, entities для жирного/ссылок).
  Фильтр: только текстовые посты с непустым `message` (пропускаем медиа без
  текста, сервисные сообщения). Возвращает `{ posts, maxId }` (maxId для
  обновления курсора). Чистая зависимость от client — мокается в тестах.

### D. Парсеры (гибрид)
- [x] D1. `app/telegram/parsers.ts` — чистые функции (тестируются без БД/сети):
  - `parseTitle(post)`: первая непустая строка; если есть жирная entity на
    первой строке — взять её. Обрезка до ~200 символов. Fallback: «(без
    заголовка)».
  - `parseUrl(post)`: первая `t.me/...`-ссылка из entities/text (внешняя
    вакансия), иначе `https://t.me/<channel>/<message_id>` (сам пост).
  - `parseContacts(post)`: `@username`, email, телефон (регэкспы) → string[].
  - `parseLocation(post)`: эвристика по ключевым словам (Remote/Удалёнка/
    город из списка) → string | null.
  - `parseDescription(post)`: полный текст поста (message).
- [x] D2. `app/telegram/salary.ts`: `parseSalaryAi(text, aiProvider)` —
  вызывает z.ai с коротким промптом «извлеки зарплату из текста, верни
  JSON {from,to,currency} или null». Кэш не нужен (один пост = один вызов
  только при наличии цифр/«$»/«к»/«k»). Опционально: регэксп-прелиминар
  (если нет цифр/$/k/к → сразу null без AI). Fallback при ошибке AI → null.

### E. Оркестратор сбора
- [x] E1. `app/telegram/collect.ts` — `collectVacancies({sourceId, profileId,
  maxVacancies?, channels?})`. Форма как `app/hh/collect.ts`
  (`CollectOptions`/`CollectStats`: collected/matched/rejected/duplicates).
  Цикл по `telegram_channels.list({active:true})` (или по `channels`):
  fetchNewPosts → для каждого поста parseTitle/Url/Description/Location →
  дедуп `vacanciesRepo.findByExternalId(source.id, message_id)` → если новоe:
  filterVacancy(parsed, profile) → company (find-or-create по имени канала
  или явно извлечённому) → `vacanciesRepo.create({...})` → update status.
  После канала → `telegramChannelsRepo.updateCursor(channel.id, maxId)`.
- [x] E2. Безбраузерные задержки: gramjs сам троттлит MTProto; доп. sleep
  300–800мс между каналами (анти-флуд Telegram — `FloodWaitError` ловить и
  honouring `seconds`).

### F. CLI + seed + env
- [x] F1. `scripts/collect-telegram.ts` (npm `telegram:collect`):
  `--source=<id> --profile=<id> [--max=<n>] [--channels=user1,user2]`.
  Шаблон — `scripts/collect-wellfound.ts`.
- [x] F2. `scripts/seed-telegram.ts` (npm `telegram:seed`): find-or-create
  source (kind=telegram) + search_profile (пример: include по role-словам,
  exclude — «новости»/«репост»). + 1–2 канала-примера в `telegram_channels`
  (закомментированные реальные @username на выбор пользователя). Шаблон —
  `scripts/seed-wellfound.ts`.
- [x] F3. `app/env.server.ts`: ЗАМЕНИТЬ `TELEGRAM_BOT_TOKEN` (от bootstrap — больше не нужен, мы на MTProto, не Bot API) на `TG_API_ID` (number, coerce), `TG_API_HASH` (string), `TG_SESSION` (string, опц. — пусто = не залогинен). `.env.example` обновить.

### G. Тесты (без реальной сети — мок gramjs + AI)
- [x] G1. `tests/telegram-parsers.test.ts`: parseTitle/Url/Contacts/Location/
  Description на синтетических постах (markdown с entities, пустой пост,
  пост с t.me-ссылкой, пост с @username/email/телефоном, Remote/город).
- [x] G2. `tests/telegram-salary.test.ts`: parseSalaryAi — мок ZaiProvider
  (как в `tests/ai-zai.test.ts`): «вилка 250-350к»→{250000,350000,RUB},
  «$120k»→{120000,USD}, «не указана»→null, регэксп-прелиминар (нет цифр→null
  без вызова AI).
- [x] G3. `tests/telegram-collect.test.ts`: мок fetchNewPosts (фикстуры
  постов) + мок AI → проверка дедупа, фильтра (matched/rejected), курсора
  (updateCursor вызван с maxId), записи в БД (in-memory better-sqlite3 как
  `tests/wellfound-collect.test.ts`). НЕ ходим в реальную сеть.
- [x] G4. `tests/telegram-channels-repo.test.ts`: CRUD + updateCursor на
  in-memory SQLite (шаблон — существующие репо-тесты).

## Acceptance

- [x] `npx tsc --noEmit` чистый; `npm test` — все тесты зелёные (существующие
  99 + новые telegram-* ≥ ~25).
- [x] Миграция `telegram_channels` применена (`db:migrate`), репозиторий CRUD
  работает.
- [x] `npm run telegram:login` — интерактивный логин, печатает TG_SESSION для
  `.env` (ручной smoke; в автотестах не вызывается).
- [x] `npm run telegram:seed` — idempotent: создаёт source(kind=telegram) +
  profile + 1–2 канала.
- [x] `npm run telegram:collect -- --source=<id> --profile=<id>` —
  РУЧНОЙ smoke (требует TG_SESSION в env): собирает посты, пишет вакансии,
  обновляет курсор. В автотестах — мок gramjs.
- [x] Парсеры и collect полностью покрыты юнит-тестами без сети/AI-вызовов
  (AI замокан).
- [x] Дедупликация работает: повторный collect с тем же курсором → 0 новых,
  duplicates счётчик растёт.
- [x] `filterVacancy` (из фазы 05) применяется as-is к telegram-вакансиям.
- [x] STATE.md обновлён (фаза 07 → complete, решение gramjs/гибрид/отдельная
  таблица в Decisions). ROADMAP: 07 → complete. SUMMARY.md создан.

## Out-of-scope (явно)

- UI управления каналами (CRUD routes) → фаза 10 (review-ui).
- AI-полный парсинг (всех полей через LLM, не только зарплаты) → если регэкспы
  покажут низкую точность на реальных постах.
- Поддержка приватных каналов (инвайт-ссылки) → пока только публичные
  `@username`.
- Реакции/комментарии/опросы в постах → игнорируем, только текст вакансии.
- Вебхуки/long-polling в реальном времени → collect синхронный по расписанию
  (scheduler фаза 12).
