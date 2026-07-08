---
milestone: 0.1.0
current_position: phase 02 data-model complete — ready for phase 03
last_updated: 2026-07-08
---

# Project state — job_hunter

Use `/soly` to see current state. Use `/plan N` to plan phase N.

## Decisions

| Date | Decision | Why |
| Стек: TypeScript + Remix (route-per-file, loader/action, cookie-сессии) — соответствует правилам проекта (routing.md, auth.md) | Единый язык full-stack; правила проекта (.agents/rules) явно описывают Remix-подобную модель маршрутов и cookie-сессий | — |
| Запуск: локально, single-user — без хостинга/биллинга/регистрации | Простейший путь для личного использования, минимум инфраструктуры | — |
| Источники вакансий: hh.ru (Playwright), сайты компаний/aggregator'ы (парсинг), Telegram-каналы (Telegram API) | От API hh.ru отказались из-за бюрократии OAuth — используем браузерную автоматизацию; Telegram и aggregators добавляют покрытие | — |
| Уровень автоматизации: «готовит, вы подтверждаете» — система ищет/фильтрует/пишет черновик отклика+письма, одобрение одним кликом | Безопаснее и выше конверсия, чем полный автопилот; страхует от кривых откликов | — |
| AI-провайдер: Yandex GPT (и/или GigaChat) — оплата из РФ, знает русскоязычный рынок труда | Российский рынок, оплата картой РФ, хорошее знание контекста HH/российских вакансий | — |
| Резюме: несколько шаблонов под разные роли; матчинг/адаптация под вакансию из выбранного шаблона | Пользователь ищет работу по нескольким направлениям — нужны разные версии резюме | — |
| Нагрузка: средняя (~100 откликов/день) — нужен фоновый планировщик + очередь задач, анти-лимиты | При таком объёме синхронная обработка не подходит; Playwright-сессии hh.ru чувствительны к частоте запросов | — |
| Фреймворк: React Router v7 (framework mode) вместо устаревшего create-remix | create-remix официально deprecated и мигрирует в RR7; план буквально ссылается на deprecated инструмент. RR7 сохраняет route-per-file, loader/action, Route.LoaderArgs из routing.md. | — |
| SQLite-драйвер: встроенный node:sqlite (Node 24) вместо better-sqlite3 ~~ОТМЕНЕНО~~ — см. ниже | ~~better-sqlite3 требует нативной сборки node-gyp~~ — оказалось неверным: в drizzle-orm 0.45.2 драйвера node-sqlite не существует. ОТМЕНЕНО фазой 02. | — |
| Корневая директория исходников: app/ (стандарт Remix/RR7) вместо src/ из routing.md | Совпадает с шаблоном фреймворка, меньше отклонений, проще обновляться. routing.md носит иллюстративный характер — семантика (route-per-file, co-located loader/action, Route.LoaderArgs) сохраняется. | — |
| SQLite-драйвер: better-sqlite3 (вместо node:sqlite из bootstrap). В drizzle-orm 0.45.2 драйвера node-sqlite не существует — bootstrap оставил несуществующий импорт. | better-sqlite3 — единственный Node.js SQLite-драйвер Drizzle, поддерживающий и рантайм, и drizzle-kit migrate в этой версии. Отменяет решение bootstrap-фазы. | — |
| Реляционный query API Drizzle (db.query.*.findFirst/findMany) асинхронный даже для sync-драйвера better-sqlite3 — репозитории используют async для findById/list, sync для прямых select/insert/update. | findFirst/findMany возвращают thenable (Promise). Прямые db.select/insert/update дают .get()/.all() — sync. Смешанная модель соответствует API Drizzle. | — |
|------|----------|-----|
| 2026-07-08 | Initial scaffold | Created by `soly init` |
