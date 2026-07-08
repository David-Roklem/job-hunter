# Roadmap

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 01 | bootstrap | pending | Скелет Remix-приложения, БД (SQLite/Drizzle), конфиг, запуcк локально |
| 02 | data-model | pending | Схема: вакансии, компании, резюме-шаблоны, отклики, письма, теги, источники, очередь задач |
| 03 | resume-templates | pending | CRUD нескольких резюме-шаблонов; загрузка markdown/PDF; редактирование |
| 04 | ai-provider | pending | Интеграция Yandex GPT (и GigaChat как fallback): промпты под сопроводительные и адаптацию резюме |
| 05 | source-hh | pending | Playwright-сессия hh.ru: логин, поиск по фильтрам, парсинг вакансий, сохранение в БД |
| 06 | source-aggregators | pending | Парсеры карьерных страниц компаний + aggregator-сайтов (адаптивные селекторы) |
| 07 | source-telegram | pending | Чтение вакансий из Telegram-каналов через Telegram API, извлечение контактов/требований |
| 08 | matcher | pending | Матчинг вакансия↔резюме-шаблон (релевантность по навыкам/роли), скоринг, очередь кандидатов |
| 09 | draft-generator | pending | Генерация черновика отклика: сопроводительное письмо + адаптированное резюме под вакансию |
| 10 | review-ui | pending | UI «подтвердить/редактировать/отклонить» — инбокс подготовленных откликов, одобрение в один клик |
| 11 | apply-hh | pending | Авто-отклик на hh.ru через Playwright после подтверждения (с анти-лимитами/задержками) |
| 12 | scheduler | pending | Фоновый планировщик: регулярный сбор вакансий, очередь задач (~100/день), троттлинг, логи |

> Local single-user. Sources: hh.ru (Playwright), company sites, Telegram. AI: Yandex GPT / GigaChat.
> Mode: «prepare → you approve → auto-apply». Multiple resume templates across roles.
