/**
 * CSS-селекторы Wellfound (wellfound.com) — изолированы в одном месте.
 *
 * Wellfound — React SPA: HTML пуст до рендера, поэтому collect ждёт
 * селектор карточки (waitForSelector) перед page.content(). Селекторы
 * основаны на data-testid-атрибутах (стабильнее хешированных class-имён CSS
 * modules) и структурных элементах; проверяются/уточняются в ручном smoke.
 *
 * Зафиксированы по состоянию на 2026-07. При поломке парсинга править здесь.
 * Тесты парсеров используют синтетические фикстуры (tests/fixtures/) — сломанный
 * селектор поймает реальный smoke, не автотесты.
 */

export const WF_SELECTORS = {
  /** Страница результатов поиска (job listings). */
  search: {
    /** Карточка вакансии в списке. data-testid — самый стабильный маркер Wellfound. */
    vacancyCard: '[data-testid="job-listing"]',
    /** Заголовок вакансии (ссылка на детальную). */
    titleLink: '[data-testid="job-link"]',
    /** Название компании (ссылка на профиль компании). */
    companyName: '[data-testid="company-name"]',
    /** Локация (город / Remote). */
    location: '[data-testid="location"]',
    /** Текст зарплаты/equity (часто отсутствует). */
    salary: '[data-testid="compensation"]',
    /** Теги навыков на карточке (если есть). */
    tag: '[data-testid="skill-tag"]',
  },
  /** Детальная страница вакансии. */
  detail: {
    /** Полное описание. */
    description: '[data-testid="job-description"]',
    /** Ключевые навыки (теги на детальной). */
    skill: '[data-testid="skill-tag"]',
    /** Equity/compensation блок (если есть отдельно). */
    compensation: '[data-testid="compensation"]',
  },
} as const;

/** URL поиска вакансий Wellfound (публичные job listings). */
export const WF_SEARCH_URL = "https://wellfound.com/jobs";

/** URL входа Wellfound (ручной логин в headed-браузере). */
export const WF_LOGIN_URL = "https://wellfound.com/login";

/**
 * Маркеры залогиненного состояния Wellfound.
 * После логина появляется меню пользователя / кнопка logout / аватар.
 */
export const WF_LOGIN_MARKERS = [
  '[data-testid="user-menu"]',
  '[data-testid="user-avatar"]',
  'a[href="/logout"]',
  '[data-testid="logout-link"]',
] as const;

/** URL-паттерны, означающие блокировку/анти-бот страницу. */
export const WF_BLOCK_PATTERNS = [
  "/cdn-cgi/challenge", // Cloudflare challenge.
  "/blocked",
  "challenge-platform",
] as const;

/** Проверить, не анти-бот/блокировка ли на странице (по URL). */
export function isBlockUrl(url: string): boolean {
  return WF_BLOCK_PATTERNS.some((p) => url.includes(p));
}
