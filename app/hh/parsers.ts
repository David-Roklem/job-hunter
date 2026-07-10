/**
 * Парсеры hh.ru — чистые функции на cheerio (server-side DOM).
 *
 * Не зависят от Playwright: принимают HTML-строку, возвращают типизированные
 * данные. Тестируются без браузера на фикстурах (tests/fixtures/).
 */
import * as cheerio from "cheerio";
import { HH_SELECTORS } from "./selectors";

/** Карточка вакансии из результатов поиска. */
export type ParsedVacancyCard = {
  external_id: string;
  title: string;
  url: string;
  company_name: string | null;
  salary_text: string | null;
  location: string | null;
};

/** Результат парсинга страницы поиска. */
export type ParsedSearchResult = {
  cards: ParsedVacancyCard[];
};

/** Результат парсинга детальной страницы вакансии. */
export type ParsedVacancyDetail = {
  description: string;
  key_skills: string[];
};

/**
 * Распарсить HTML страницы результатов поиска → массив карточек.
 */
export function parseSearchResults(html: string): ParsedSearchResult {
  const $ = cheerio.load(html);
  const cards: ParsedVacancyCard[] = [];

  $(HH_SELECTORS.search.vacancyCard).each((_, el) => {
    const $card = $(el);
    const $link = $card.find(HH_SELECTORS.search.titleLink).first();
    const url = $link.attr("href") ?? "";
    const external_id = extractExternalId(url);
    if (!external_id) return; // нет валидного id → пропускаем (реклама/мусор)

    const title = $link.text().trim();
    const company_name =
      $card.find(HH_SELECTORS.search.companyName).text().trim() || null;
    const salary_text =
      $card.find(HH_SELECTORS.search.salary).text().trim() || null;
    const location =
      $card.find(HH_SELECTORS.search.location).text().trim() || null;

    if (!title) return;

    cards.push({ external_id, title, url, company_name, salary_text, location });
  });

  return { cards };
}

/**
 * Распарсить HTML детальной страницы вакансии → описание + ключевые навыки.
 */
export function parseVacancyDetail(html: string): ParsedVacancyDetail {
  const $ = cheerio.load(html);
  const description = $(HH_SELECTORS.detail.description).text().trim();
  const key_skills: string[] = [];
  $(HH_SELECTORS.detail.keySkill).each((_, el) => {
    const skill = $(el).text().trim();
    if (skill) key_skills.push(skill);
  });
  return { description, key_skills };
}

/**
 * Извлечь external_id из URL вакансии.
 * "/vacancy/12345678?query=..." → "12345678". Невалидный URL → null.
 */
export function extractExternalId(url: string): string | null {
  const match = url.match(/\/vacancy\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Нормализовать текст зарплаты hh в диапазон.
 *
 * Примеры hh:
 *   "100 000–150 000 руб." → { from: 100000, to: 150000, currency: "RUB" }
 *   "от 80 000 руб."       → { from: 80000, currency: "RUB" }
 *   "до 60 000 USD"        → { to: 60000, currency: "USD" }
 *   "зарплата не указана"  → {}
 */
export function parseSalary(
  text: string,
): { from?: number; to?: number; currency?: string } {
  const result: { from?: number; to?: number; currency?: string } = {};
  if (!text || !text.trim()) return result;

  const cleaned = text.replace(/\s+/g, " ").trim();

  // Валюта.
  if (/руб/i.test(cleaned)) result.currency = "RUB";
  else if (/usd|\$/i.test(cleaned)) result.currency = "USD";
  else if (/eur|€/i.test(cleaned)) result.currency = "EUR";
  else if (/kzt|₸/i.test(cleaned)) result.currency = "KZT";

  // Диапазон "100 000–150 000" (–, -, —).
  const rangeMatch = cleaned.match(/(\d[\d\s]*)\s*[–—-]\s*(\d[\d\s]*)/);
  if (rangeMatch) {
    result.from = parseNumber(rangeMatch[1]);
    result.to = parseNumber(rangeMatch[2]);
    return result;
  }

  // "от 80 000".
  const fromMatch = cleaned.match(/от\s+(\d[\d\s]*)/i);
  if (fromMatch) {
    result.from = parseNumber(fromMatch[1]);
    return result;
  }

  // "до 60 000".
  const toMatch = cleaned.match(/до\s+(\d[\d\s]*)/i);
  if (toMatch) {
    result.to = parseNumber(toMatch[1]);
    return result;
  }

  return result;
}

/** "100 000" → 100000. Невалидное → undefined. */
function parseNumber(s: string): number | undefined {
  const n = Number(s.replace(/\s/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
