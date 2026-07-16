# Plan: apply-hh

## Goal

Авто-отклик на hh.ru через Playwright для одобренных applications
(status='approved'): открыть форму отклика по каноничному URL, выбрать
резюме (маппинг resume_template_id → hh resume_id), подставить
сопроводительное письмо (cover_letters.body_md), submit. При успехе
application.status → 'sent' + submitted_at, при ошибке → 'failed'.

Это замыкает vision-цикл «prepare → approve → auto-apply»: фазы 04/09
генерируют письмо, фаза 10 даёт одобрение одним кликом, фаза 11 —
авто-отправка. Headless, переиспользует зафиксированную сессию +
fingerprint из плана fingerprint-pinning.

## Контекст (из разведки 2026-07-16)

Разведка на живом hh.ru (data/dumps/hh-apply-form.html) установила:

- **Каноничный URL формы отклика**:
  `https://hh.ru/applicant/vacancy_response?vacancyId=X` — это href кнопки
  `vacancy-response-link-top` на детальной странице. Открывать напрямую
  надёжнее клика (не зависит от JS-модалки, не уводит в negotiations).
- **Селекторы формы** (с реального дампа):
  - `[data-qa="resume-detail"]` — блок выбранного резюме (resume-title внутри)
  - `[data-qa="vacancy-response-letter-toggle"]` — тумблер «добавить письмо»
    (раскрывает textarea — НЕ рендерится до клика)
  - `[data-qa="vacancy-response-submit-popup"]` — кнопка submit
  - `h1 «Отклик на вакансию»` — подтверждение что мы на форме
- **Submit**: форма POST'ит на тот же URL (action пустой). hidden `_xsrf` есть.
- **Резюме на аккаунте**: 2 resume-id найдены через `/applicant/resumes`
  (`029ba793…`, `11c31868…`). Скрипт dump-hh-resumes.ts уже их извлекает.
- **Серая зона — выбор конкретного резюме**: в дампе формы НЕТ dropdown и
  resumeId в query/hidden — форма использует **текущее активное резюме**
  профиля. Шаг 1 (ниже) выясняет, принимает ли URL/POST параметр resumeId,
  или нужно предварительно переключать активное резюме через
  `/applicant/resumes`.
- **Сессия**: работает headless (isLoggedIn: YES, fingerprint-pinning влит).
  Headed-режим тоже валиден (сбой был из-за зомби-процессов от зависшего
  login, не структурный баг — после чистки работает).

## Steps

1. **Разведка выбора резюме** (до кода, ~15 мин).
   Открыть `dump-hh-apply-form.ts` с разными resume-параметрами:
   - `?vacancyId=X&resumeId=<hash>` (прямая подстановка)
   - POST-инспекция: какой payload отправляет hh при выборе резюме в UI
   - Если ни то ни другое — переключить активное резюме через
     `/applicant/resumes` перед открытием формы.
   Зафиксировать рабочий способ в комментарии `apply.ts`.

2. **Маппинг resume_template_id → hh resume_id** (схема + репозиторий).
   - `app/db/schema.ts`: таблица `hh_resume_mapping` (resume_template_id FK
     UNIQUE → hh_resume_id text NOT NULL, + timestamps). Миграция
     (drizzle/versions). Не nullable — маппинг обязателен для apply.
   - `app/db/repositories.ts`: `hhResumeMappingRepo` (findByTemplateId,
     upsert, list). По образцу существующих репозиториев (sourcesRepo и т.д.).
   - Скрипт `scripts/map-hh-resumes.ts`: читает `/applicant/resumes` (через
     dump-hh-resumes), показывает найденные hh resume-id, предлагает
     сопоставить с resume_templates из БД (интерактивный prompt или флаги
     `--template=1 --hh=029ba793...`). Пишет в hh_resume_mapping.
   - Тест: in-memory SQLite, CRUD маппинга (по образцу
     tests/resume-templates-repo.test.ts).

3. **`app/hh/apply.ts` — оркестратор отклика** (чистая функция + Playwright).
   `submitApplication(opts): Promise<ApplyResult>`:
   - Принимает applicationId. Грузит application + vacancy + cover_letter +
     hh_resume_mapping (ошибка если маппинга нет → status='failed' с
     понятным сообщением).
   - `createContext()` (fingerprint + storageState — уже дефолт hh/session).
   - `page.goto(FORM_URL?vacancyId=<external_id>)`, ждать `h1 «Отклик на вакансию»`.
   - Выбор резюме по способу из шага 1 (toggle/URL/пресет).
   - Клик `vacancy-response-letter-toggle` → ждать textarea → заполнить
     `cover_letters.body_md`.
   - Детект «уже откликнулись» (есть маркер на форме — проверить на дампе).
   - Клик `vacancy-response-submit-popup`. Анти-лимит: humanDelay перед
     submit (reuse human.ts). Детект ошибки (капча/лимит/дубль) — как в
     collect.ts (isCaptchaUrl + статус ответа).
   - Возвращает `{ ok: true }` или `{ ok: false, reason }`.
   - По образцу orchestration в `app/hh/collect.ts` (try/finally context.close,
     HhCaptchaError-класс).

4. **Обновление статуса application после apply**.
   - `submitApplication` пишет: успех → `applications.status='sent'` +
     `submitted_at=now`; провал → `status='failed'`.
   - Идемпотентность: повторный apply на 'sent' → no-op (или явный
     `--force`). existing `applicationsRepo.update` достаточен.

5. **Точки запуска** (CLI + RR action).
   - CLI `scripts/apply-hh.ts` + `npm run hh:apply` (по образцу
     collect-hh.ts). Принимает `--application=<id>` (одно) или `--all`
     (все approved без маппинга-пропуска с предупреждением).
   - RR action `POST /applications/:id/apply` (или intent в
     applications._index.tsx) — для запуска из UI. Возвращает
     redirect + flash-сообщение (как approve/reject в фазе 10).

6. **Тесты** (без живого hh — мок Playwright на парсеры/маппинг, ручной smoke отдельно).
   - `tests/hh-apply-mapping.test.ts`: submitApplication с отсутствующим
     маппингом → failed с reason; с маппингом → вызывает page.goto с верным
     vacancyId; success path → status='sent'+submitted_at; дубль/ошибка →
     'failed'. Мокает createContext/page (по образцу tests/hh-collect.test.ts).
   - Дампер и реальный submit — ручной smoke (как hh:login/hh:collect):
     указать в PLAN, что принимает.

## Acceptance

- [ ] Таблица `hh_resume_mapping` + миграция; `hhResumeMappingRepo` с тестами.
- [ ] `app/hh/apply.ts` `submitApplication`: открывает форму, выбирает
      резюме, подставляет cover_letters.body_md, submit. Статус → sent/failed.
- [ ] Идемпотентность: повторный apply на 'sent' → no-op (без дубля-отклика).
- [ ] CLI `npm run hh:apply --application=<id>` + `--all`. RR action для UI.
- [ ] Автотесты: +~6 (mapping CRUD, submitApplication success/fail/dup),
      всего ~232/232. `npm run typecheck` чистый.
- [ ] **Ручной smoke** на живом hh: `hh:apply --application=<approved>` →
      отклик реально отправлен (виден в /applicant/negotiations «Отклики»),
      status='sent', submitted_at. Дубль-apply → no-op. Хотя бы один реальный
      отклик на тестовой вакансии.
- [ ] STATE.md фиксирует решение по выбору резюме (URL param vs preset) и
      маппинг-таблицу.

## Не входит (отложено)

- **Фаза 12 scheduler**: авто-запуск apply по расписанию — отдельно.
- **Адаптация резюме** (AI-переписывание под вакансию) — отложено в фазе 09.
- **Headed-починка**: сбой был из-за зомби, не структурный. Отдельного
  фикса не нужно; если повторится — kill camoufox.exe + снять parent.lock.
