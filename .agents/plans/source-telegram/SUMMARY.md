---
plan: source-telegram
type: phase  # фаза 07 ROADMAP
title: "Telegram-источник вакансий через MTProto (gramjs)"
status: complete
duration: "~1.5h"
started: 2026-07-14
completed: 2026-07-14
files_created: 10
files_deleted: 0
files_modified: 7
tags: [telegram, gramjs, mtproto, parsing, ai-salary, source]
key-files:
  created:
    - app/telegram/client.ts
    - app/telegram/fetch.ts
    - app/telegram/parsers.ts
    - app/telegram/salary.ts
    - app/telegram/collect.ts
    - app/db/repositories/telegram_channels.ts
    - app/ai/prompts/salary.ts
    - scripts/telegram-login.ts
    - scripts/seed-telegram.ts
    - scripts/collect-telegram.ts
    - drizzle/0002_colossal_forge.sql
    - tests/telegram-parsers.test.ts
    - tests/telegram-salary.test.ts
    - tests/telegram-channels-repo.test.ts
    - tests/telegram-collect.test.ts
  modified:
    - app/db/schema.ts
    - app/db/repositories/index.ts
    - app/env.server.ts
    - .env.example
    - package.json
    - .agents/ROADMAP.md
    - .agents/STATE.md
key-decisions:
  - "MTProto через gramjs (user-аккаунт), НЕ Bot API — чтение чужих публичличных каналов"
  - "Гибридный парсинг: регэкспы-скелет + z.ai для зарплаты; прелиминар отсекает AI-вызовы"
  - "Отдельная таблица telegram_channels с курсором last_message_id"
  - "external_id = message_id, url = t.me/<channel>/<id> — переиспользуем UNIQUE(source_id, external_id)"
  - "JS regex с кириллицей: \\b (ASCII) → \\p{L} lookaround с флагом u; корень слова покрывает падежи"
---

# source-telegram — Summary

Фаза 07 ROADMAP: добавлен Telegram-источник вакансий. Чтение публичличных
каналов через MTProto (gramjs, user-аккаунт), гибридный парсинг постов
(регэкспы + z.ai для зарплаты), запись в общую таблицу `vacancies` с
дедупликацией. Новая таблица `telegram_channels` с курсором. Без UI — только
сбор (как фаза 05 source-hh), CLI `telegram:collect`.

**Цель достигнута:** автотесты 162/162 (было 99, +63), tsc чистый, миграция
применена. Ручной smoke pending (требует TG_API_ID/HASH + интерактивный логин).

## Duration  ~1.5h

## Что сделано (key result)

**Полноценный Telegram-источник, переиспользующий инфраструктуру hh/wellfound:**
- MTProto-клиент (gramjs) под user-аккаунтом — читает любые публичличные каналы
- Гибридные парсеры: регэкспы (title/url/contacts/location) + AI (зарплата)
- Оркестратор сбора с дедупликацией, фильтром, курсором, анти-флудом
- Новая таблица + репозиторий + миграция
- CLI: `telegram:login`, `telegram:seed`, `telegram:collect`

**Переиспользовано as-is:** `filterVacancy` (фаза 05), `vacanciesRepo.create`
с onConflictDoNothing, `ZaiProvider` (фаза 04), форма `CollectOptions`/`CollectStats`.

## Архитектура

### Клиент: MTProto, НЕ Bot API
Bot API не может читать чужие публичличные каналы (только где бот админ) — а
большинство вакансий-каналов чужие. gramjs под user-аккаунтом читает любой
публичличный канал + полную историю. api_id/api_hash бесплатно на my.telegram.org;
StringSession персистит логин (один интерактивный `telegram:login`).

### Парсинг: гибрид
Посты в каналах неструктурированны. Регэкспы дёшево извлекают скелет:
- title: первая непустая строка / жирная entity (MessageEntityBold)
- url: TextUrl-entity → t.me-ссылка → http → fallback t.me/<channel>/<id>
- contacts: @username (≥5 символов) / email / телефон (с + или скобками)
- location: корень слова по маркерам (Remote/Москва/Berlin/...), покрывает падежи

z.ai (фаза 04) — для зарплаты из свободного текста. **Прелиминар-регэксп**
отсекает посты без признаков зарплаты (нет цифр/валют/k) → null без AI-вызова.

### Хранение: отдельная таблица telegram_channels
Курсор `last_message_id` — per-channel состояние идемпотентного сбора
(`getMessages(username, {minId: last_message_id})`). Один source(kind=telegram)
→ много каналов (типично 5–10 каналов на профиль).

## Tasks

- **A** Схема: `telegram_channels` + relations + миграция 0002.
- **B** gramjs-клиент (`app/telegram/client.ts`) + интерактивный `telegram:login`.
- **C** Чтение каналов (`fetch.ts`): `fetchNewPosts` с курсором + фильтр текстовых постов.
- **D** Парсеры (`parsers.ts`, 25 тестов) + AI-зарплата (`salary.ts`, 14 тестов).
- **E** Оркестратор (`collect.ts`): цикл по каналам → парсинг → фильтр → БД → курсор.
- **F** CLI (`telegram:login`/`seed`/`collect`) + env (TG_API_ID/HASH/SESSION).
- **G** Тесты: parsers(25) + salary(14) + channels-repo(15) + collect(9).

## Deviations from Plan

**[Rule 1 — Bug] JS regex `\\b` не работает с кириллицей**
- Found during: шаг G (тесты parsers).
- Issue: `/\\b(москв[аы])\\b/i` не матчит «в Москве» — `\\b` ASCII-only, и падежное
  окончание «е» не входило в `[аы]`.
- Fix: границы через `\\p{L}` lookaround с флагом `u`; паттерн = корень слова
  (`москв`) покрывает все падежи (Москва/Москвы/Москве/Москву).
- Files: app/telegram/parsers.ts · Решение в STATE.md.

**[Rule 1 — Bug] Телефон-регэксп ловил числовые диапазоны зарплат**
- Found during: шаг G.
- Issue: «250000-350000» (11 цифр) попадало в диапазон 10–15 → ложный контакт.
- Fix: телефон требует ведущий `+` ИЛИ скобки ИЛИ пробелы между группами
  (голые числовые диапазоны так не пишутся).
- Files: app/telegram/parsers.ts.

**[Тестовые данные] @username минимум 5 символов (Telegram)**
- Found during: шаг G. `@hr` в тесте — нереалистичен (Telegram требует ≥5).
- Fix: тестовые данные на валидные usernames (`@hr_manager`, `@valid1`).
- Не баг кода — корректное поведение валидатора.

**Total deviations:** 2 auto-fixed (Rule 1) + 1 тестовые данные.

## Verification

```
npx tsc --noEmit        → без ошибок
npm test                → 162/162 (17 files): +63 теста
                          telegram-parsers 25, telegram-salary 14,
                          telegram-channels-repo 15, telegram-collect 9
npm run db:generate     → миграция 0002_colossal_forge.sql (telegram_channels)
npm run db:migrate      → applied
```

Ручной smoke (НЕ в автотестах, требует env):
```
npm run telegram:login  → интерактивный логин → TG_SESSION в .env
npm run telegram:seed   → source(kind=telegram) + profile + каналы
npm run telegram:collect -- --source=<id> --profile=<id>
```

## Known limitations

1. **Ручной smoke pending** — требует TG_API_ID/TG_API_HASH (my.telegram.org) +
   интерактивный логин. Автотесты полностью на моках gramjs/AI, сеть не дёргают.
2. **Каналы-примеры закомментированы** в `scripts/seed-telegram.ts` — пользователь
   раскомментирует/добавляет свои реальные @username под свой рынок.
3. **Только публичличные каналы** (@username). Приватные (инвайт-ссылки) — out-of-scope.
4. **AI-зарплата ~1 запрос/пост** при наличии признаков — ~100 запросов/день при
   целевой нагрузке. Прелиминар отсекает посты без признаков (экономия).
5. **Один MTProto-процесс на session** — параллельные запуски разрывают соединение.
   Collect синхронный (фаза 12 scheduler добавит очередь).

## Out-of-Scope Issues

- **UI управления каналами** (CRUD routes) → фаза 10 (review-ui).
- **AI-полный парсинг** (всех полей через LLM) → если регэкспы покажут низкую
  точность на реальных постах.
- **Реакции/комментарии/опросы** в постах → игнорируем, только текст вакансии.
- **Вебхуки/real-time** → collect синхронный по расписанию (фаза 12 scheduler).

## Next

Фаза 07 закрыта на автотестах + миграции. Открытая нить — **ручной smoke**
(нужны env-ключи). Дальше по ROADMAP: **фаза 08 (matcher)** — матчинг
вакансия↔резюме-шаблон по навыкам/роли + скоринг, работает на уже собранных
данных (hh + telegram, не зависит от Wellfound).
