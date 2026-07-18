# Summary: apply-hh

**Статус:** выполнено. Автотесты 237/237, `tsc` чистый. Ручной smoke на живом
hh валиден: отклик реально отправлен и виден в «Откликах».

## Что доставлено

Авто-отклик на hh.ru для одобренных applications (status='approved'):
`submitApplication(applicationId)` открывает форму отклика по каноничному URL,
подставляет сопроводительное письмо (cover_letters.body_md), submit. При успехе
`status → 'sent'` + `submitted_at`, при ошибке → `'failed'`.

Замыкает vision-цикл «prepare → approve → auto-apply»: фазы 04/09 генерируют
письмо, фаза 10 даёт одобрение, фаза 11 — авто-отправка.

## Решение (маппинг резюме)

Таблица `hh_resume_mapping` (resume_template_id → hh_resume_id hash, 1:1).
hh не принимает resumeId в URL формы и не даёт dropdown data-qa, поэтому
соответствие указывается один раз через `npm run hh:map-resumes` (читает
`/applicant/resumes`, печатает hh-resume-id; `--template=<id> --hh=<hash>`
записывает маппинг).

## Файлы

- `app/db/schema.ts` + `drizzle/0003_hesitant_wither.sql`: таблица
  `hh_resume_mapping` + relations + миграция.
- `app/db/repositories/hh_resume_mapping.ts`: upsert/findByTemplateId/list/
  removeByTemplateId. Тест `tests/hh-resume-mapping-repo.test.ts` (5).
- `app/hh/selectors.ts`: блок `HH_SELECTORS.apply` + `buildApplyFormUrl`.
- `app/hh/apply.ts`: `submitApplication`, `HhApplyCaptchaError`,
  `selectResume`/`fillLetter`. Идемпотентность: sent без `--force` → no-op.
- `scripts/apply-hh.ts` + `npm run hh:apply` (--application | --all, --headed, --force).
- `scripts/map-hh-resumes.ts` + `npm run hh:map-resumes` (--template/--hh, --list-hh).
- `app/routes/applications._index.tsx`: intent=apply + кнопка «Отправить отклик»
  (только для approved).
- `tests/hh-apply.test.ts` (6): успех/нет маппинга/идемпотентность/несуществующая/
  --force/fillLetter.

## Разведка (зафиксирована в PLAN, шаг 1)

Поток отклика установлен на живом hh (data/dumps/hh-apply-form.html):
- Каноничный URL: `/applicant/vacancy_response?vacancyId=X` (надёжнее клика
  по кнопке — не зависит от JS-модалки).
- Селекторы: `[data-qa="vacancy-response-letter-toggle"]` (тумблер письма),
  `[data-qa="vacancy-response-submit-popup"]` (submit), `form div[role="button"]`
  (dropdown резюме — без data-qa).
- Резюме: на аккаунте 2 resume-id (`029ba793…`, `11c31868…`), доступны через
  `/applicant/resumes`.

## Smoke (живой hh, сегодня)

1. `hh:map-resumes --template=2 --hh=029ba793…` → маппинг записан.
2. `hh:apply --application=3` (approved, external_id=135009828, письмо) →
   ✓ отправлена, `status='sent'`, `submitted_at` проставлен.
3. `smoke-check-apply 135009828` → **✓ ДА**: `/vacancy/135009828` виден в
   `/applicant/negotiations` (17 откликов на странице).

## Известные ограничения

- **Авто-выбор конкретного резюме (`selectResume`) не доработан.** hh рендерит
  dropdown через JS непредсказуемо — селектор выбора по имени
  (resume_templates.name) не сматчил на живой форме. Submit идёт с **текущим
  активным** резюме профиля. Доработать когда у пользователя будет несколько
  целевых резюме на hh (вероятно — через пресет активного резюме перед apply,
  или полноценный паринг dropdown-опций после клика). Smoke прошёл с активным
  Python backend резюме, хотя application ссылался на Frontend template —
  функционально отклик отправлен, но резюме может не совпадать с template.
- **Headed-режим нестабилен** на этой машине (зомби-процессы после зависших
  hh:login держат lock профиля). Лечится `taskkill /IM camoufox.exe /F` +
  удалением `data/hh-profile/parent.lock`. Apply идёт headless — стабильно.
- **apply через RR action long-running** (Playwright, секунды) — приемлемо для
  local single-user, но для нагрузки нужен scheduler (фаза 12).

## Что отложено

- Фаза 12 scheduler: регулярный авто-apply approved по расписанию.
- Доработка `selectResume` (полноценный парсинг dropdown-опций).
- Адаптация резюме (AI) — отложено ещё в фазе 09.
