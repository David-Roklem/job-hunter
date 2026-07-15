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
| 09 | draft-generator | pending | Генерация черновика отклика: сопроводительное письмо + адаптированное резюме под вакансию |
| 10 | review-ui | pending | UI «подтвердить/редактировать/отклонить» — инбокс подготовленных откликов, одобрение в один клик |
| 11 | apply-hh | pending | Авто-отклик на hh.ru через Playwright после подтверждения (с анти-лимитами/задержками) |
| 12 | scheduler | pending | Фоновый планировщик: регулярный сбор вакансий, очередь задач (~100/день), троттлинг, логи |

> Local single-user. Sources: hh.ru (Playwright), company sites, Telegram. AI: Yandex GPT / GigaChat.
> Mode: «prepare → you approve → auto-apply». Multiple resume templates across roles.
