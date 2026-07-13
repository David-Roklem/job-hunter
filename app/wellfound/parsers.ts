/**
 * Парсеры Wellfound — чистые функции на cheerio (server-side DOM).
 *
 * Не зависят от Playwright: принимают HTML-строку (как правило — от
 * page.content() ПОСЛЕ рендера SPA, т.к. Wellfound — React), возвращают
 * типизированные данные. Тестируются без браузера на фикстурах.
 *
 * Форма ParsedVacancyCard/ParsedVacancyDetail совместима с hh-аналогами
 * (external_id, title, url, company_name, salary_text, location) — это
 * позволяет переиспользовать общий collect-цикл и filter.ts без адаптации.
 */
import * as cheerio from "cheerio";
import { WF_SELECTORS } from "./selectors";

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
  /** Equity/compensation с детальной (если есть отдельно от карточки). */
  equity: string | null;
};

/**
 * Распарсить HTML страницы результатов поиска → массив карточек.
 *
 * Wellfound рендерит карточки через React; HTML должен быть снят уже после
 * рендера (page.content() в collect.ts вызывается после waitForSelector).
 */
export function parseSearchResults(html: string): ParsedSearchResult {
  const $ = cheerio.load(html);
  const cards: ParsedVacancyCard[] = [];

  $(WF_SELECTORS.search.vacancyCard).each((_, el) => {
    const $card = $(el);
    const $link = $card.find(WF_SELECTORS.search.titleLink).first();
    const url = $link.attr("href") ?? "";
    const external_id = extractExternalId(url);
    if (!external_id) return; // нет валидного id → пропускаем (реклама/мусор)

    const title = $link.text().trim();
    const company_name =
      $card.find(WF_SELECTORS.search.companyName).text().trim() || null;
    const salary_text =
      $card.find(WF_SELECTORS.search.salary).text().trim() || null;
    const location =
      $card.find(WF_SELECTORS.search.location).text().trim() || null;

    if (!title) return;

    cards.push({ external_id, title, url, company_name, salary_text, location });
  });

  return { cards };
}

/**
 * Распарсить HTML детальной страницы вакансии → описание + навыки + equity.
 */
export function parseVacancyDetail(html: string): ParsedVacancyDetail {
  const $ = cheerio.load(html);
  const description = $(WF_SELECTORS.detail.description).text().trim();
  const key_skills: string[] = [];
  $(WF_SELECTORS.detail.skill).each((_, el) => {
    const skill = $(el).text().trim();
    if (skill) key_skills.push(skill);
  });
  const equity =
    $(WF_SELECTORS.detail.compensation).text().trim() || null;
  return { description, key_skills, equity };
}

/**
 * Извлечь external_id из URL вакансии Wellfound.
 *
 * Wellfound URL вида: "/jobs/1234567-senior-backend-engineer" или
 * "https://wellfound.com/jobs/9876543". Берём числовой id до первого дефиса
 * (или весь хвост, если без дефиса).
 *
 * Примеры:
 *   "/jobs/1234567-senior-backend"  → "1234567"
 *   "/jobs/9876543"                  → "9876543"
 *   "https://wellfound.com/jobs/111" → "111"
 *   "/some/promo"                    → null
 */
export function extractExternalId(url: string): string | null {
  const match = url.match(/\/jobs\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Нормализовать текст зарплаты/equity Wellfound в диапазон.
 *
 * Американский формат: "$150k–$180k", "$120K", "$90,000 - $110,000",
 * "equity-only", часто отсутствует. Валюта всегда USD (американский рынок).
 *
 * Примеры:
 *   "$150k–$180k"      → { from: 150000, to: 180000, currency: "USD" }
 *   "$120K"            → { from: 120000, currency: "USD" }
 *   "$90,000 - $110,000" → { from: 90000, to: 110000, currency: "USD" }
 *   "equity-only"      → {}
 *   ""                 → {}
 */
export function parseSalary(
  text: string,
): { from?: number; to?: number; currency?: string } {
  const result: { from?: number; to?: number; currency?: string } = {};
  if (!text || !text.trim()) return result;

  const cleaned = text.replace(/\s+/g, " ").trim();

  // Валюта Wellfound — USD по умолчанию (присутствует "$" в большинстве случаев).
  if (/\$/i.test(cleaned)) result.currency = "USD";

  // Диапазон "$150k–$180k" / "$90,000 - $110,000" (–, -, —).
  // Группы захватывают "k" чтобы parseMoney применил множитель ×1000.
  const rangeMatch = cleaned.match(
    /\$?\s*([\d.,]+k?)\s*[–—-]\s*\$?\s*([\d.,]+k?)/i,
  );
  if (rangeMatch) {
    result.from = parseMoney(rangeMatch[1]);
    result.to = parseMoney(rangeMatch[2]);
    return result;
  }

  // Одиночное значение "$120K" / "$90,000". Группа захватывает "k".
  const singleMatch = cleaned.match(/\$?\s*([\d.,]+k?)\b/i);
  if (singleMatch) {
    result.from = parseMoney(singleMatch[1]);
    return result;
  }

  return result;
}

/**
 * "$150k" / "150K" / "90,000" / "150.5k" → число.
 * k/K = ×1000. Запятые убираются. Невалидное → undefined.
 */
function parseMoney(s: string): number | undefined {
  const trimmed = s.trim().toLowerCase();
  const hasK = /k$/.test(trimmed);
  const numeric = Number(trimmed.replace(/[k$,]/g, ""));
  if (!Number.isFinite(numeric)) return undefined;
  return hasK ? Math.round(numeric * 1000) : numeric;
}
