# Roadmap

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 01 | bootstrap | pending | Скелет Remix-приложения, БД (SQLite/Drizzle), конфиг, запуcк локально |
| 02 | data-model | complete | Схема: вакансии, компании, резюме-шаблоны, отклики, письма, теги, источники, очередь задач ✓ 2026-07-08 |
| 03 | resume-templates | complete | CRUD нескольких резюме-шаблонов; загрузка markdown/PDF; редактирование ✓ 2026-07-10 |
| 04 | ai-provider | complete | z.ai (GLM-5.2) провайдер + промпты + generateCoverLetter → cover_letters ✓ 2026-07-10 |
| 05 | source-hh | complete | Playwright сбор hh.ru + анти-детект (stealth+поведение) + include/exclude фильтр + search_profiles ✓ 2026-07-10 (ручной smoke pending) |
| 06 | source-aggregators | complete | Wellfound (aggregator) через Playwright + общий browser/session; sourceKinds += 'aggregator'; автотесты 80/80 ✓ 2026-07-13 (ручной smoke отложен — Cloudflare bot-detect; эскалация Camoufox отдельным планом) |
| 07 | source-telegram | complete | Чтение вакансий из Telegram-каналов через MTProto (gramjs, user-аккаунт), извлечение контактов/требований; таблица telegram_channels + курсор ✓ 2026-07-14 (ручной smoke pending — нужен TG_API_ID/HASH + логин) |
| 08 | matcher | complete | Матчинг вакансия↔резюме: rule-префильтр (навыки+синонимы) → AI-скоринг z.ai (score 0–100 + rationale); applications.match_score + vacancy→matched; CLI `npm run match` + RR action `/matcher`; автотесты 190/190 ✓ 2026-07-15 (ручной smoke pending — нужен ZAI_API_KEY) |
| 09 | draft-generator | complete | Генерация черновика отклика: сопроводительное письмо (поверх generateCoverLetter фазы 04) через батч-оркестратор generateDrafts (continue-on-error + дедуп + minScore). CLI `npm run generate-drafts` + RR action `/drafts` + smoke. Резюме = шаблон как есть, БЕЗ адаптации (опция на потом). Автотесты 205/205 ✓ 2026-07-15 (smoke валиден — z.ai/glm-5.2, осмысленное письмо в cover_letters) |
| 10 | review-ui | complete | UI инбокс `/applications`: applications с cover_letter, действия одобрить/отклонить/регенерировать/редактировать (отд. страница). Плашки главной кликабельны. Автотесты 219/219 ✓ 2026-07-15 (ручной smoke валиден: approve/reject/save/404 на dev-сервере) |
| 11 | apply-hh | complete | Авто-отклик submitApplication: форма /applicant/vacancy_response?vacancyId=X напрямую, cover_letters.body_md → textarea, submit → status sent/failed. Таблица hh_resume_mapping + hh:map-resumes. CLI npm run hh:apply + RR action + UI кнопка. Автотесты 237/237 ✓ 2026-07-16 (ручной smoke валиден — отклик виден в /applicant/negotiations; авто-выбор резюме не доработан — submit с активным) |
| 12 | scheduler | complete | Фоновый планировщик: standalone tsx-воркер `npm run scheduler`, очередь jobs (claimNext/markDone/markFailed с бэк-оффом), цепочка collect→match→generate_draft, apply только из approve-action + applyThrottle (jitter+cycle-cap+daily-cap), UI /jobs (pause/resume/retry). scheduler_runs аудит циклов. jobKinds += 'match' (миграция 0004). Автотесты 292/292 ✓ 2026-07-18 (smoke:scheduler валиден) |

> Local single-user. Sources: hh.ru (Playwright), company sites, Telegram. AI: Yandex GPT / GigaChat.
> Mode: «prepare → you approve → auto-apply». Multiple resume templates across roles.
