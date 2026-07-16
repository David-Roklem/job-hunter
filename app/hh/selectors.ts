/**
 * CSS-селекторы hh.ru — изолированы в одном месте.
 *
 * Селекторы hh меняются часто; при поломке парсинга править здесь.
 * Зафиксированы по состоянию на 2026-07 (vacancyCard обновлён под новый контейнер
 * vacancy-serp__vacancy — старый serp-item hh убрал); проверяются в ручном smoke.
 * Тесты парсеров используют фикстуры HTML (tests/fixtures/) — сломанный
 * селектор поймает реальный smoke, не автотесты.
 */

export const HH_SELECTORS = {
  /** Страница результатов поиска вакансий. */
  search: {
    /** Карточка вакансии в списке.
     * hh ~2026-07 убрал [data-qa="serp-item"] с корня карточки и перенёс
     * контейнер на [data-qa="vacancy-serp__vacancy"]. Внутренние селекторы
     * (serp-item__title, ...-employer, ...-address) при этом сохранились. */
    vacancyCard: '[data-qa="vacancy-serp__vacancy"]',
    /** Заголовок вакансии (ссылка). */
    title: '[data-qa="serp-item__title"]',
    /** Название компании. */
    companyName: '[data-qa="vacancy-serp__vacancy-employer"]',
    /** Текст зарплаты. */
    salary: '[data-qa="vacancy-serp__vacancy-compensation"]',
    /** Ссылка на вакансию (для external_id). */
    titleLink: 'a[data-qa="serp-item__title"]',
    /** Локация. */
    location: '[data-qa="vacancy-serp__vacancy-address"]',
  },
  /** Детальная страница вакансии. */
  detail: {
    /** Полное описание. */
    description: '[data-qa="vacancy-description"]',
    /** Ключевые навыки. */
    keySkill: '[data-qa="bloko-tag"]',
  },
} as const;

/** URL поиска вакансий hh. */
export const HH_SEARCH_URL = "https://hh.ru/search/vacancy";

/** Детект капчи (URL или селектор). */
export const HH_CAPTCHA_PATTERNS = ["/checks/captcha", "captcha-wrapper"] as const;

/** Проверить, не капча ли на странице (по URL или наличию селектора). */
export function isCaptchaUrl(url: string): boolean {
  return HH_CAPTCHA_PATTERNS.some((p) => url.includes(p));
}
