/**
 * Бинарный include/exclude фильтр вакансий (фаза 05).
 *
 * НЕ скоринг (matcher 08) — только matched/rejected по ключевым словам.
 * exclude имеет приоритет: наличие хоть одного exclude-слова → rejected.
 * include: если задан — нужно хотя бы одно совпадение; если пуст → проходит
 * (при отсутствии exclude).
 *
 * Чистая функция — тестируется без БД/браузера.
 */
import type { SearchProfileDTO } from "~/db/repositories/search_profiles";

/** Контекст вакансии для фильтрации. */
export type VacancyForFilter = {
  title: string;
  description: string;
  key_skills: string[];
};

export type FilterResult = "matched" | "rejected";

/**
 * Применить include/exclude фильтр профиля к вакансии.
 */
export function filterVacancy(
  vacancy: VacancyForFilter,
  profile: Pick<
    SearchProfileDTO,
    "include_keywords" | "exclude_keywords"
  >,
): FilterResult {
  const haystack = buildHaystack(vacancy);

  // exclude приоритетнее: запретное слово → сразу rejected.
  if (hasAnyKeyword(haystack, profile.exclude_keywords)) {
    return "rejected";
  }

  // include пуст → проходит (если не попал в exclude).
  if (profile.include_keywords.length === 0) {
    return "matched";
  }

  return hasAnyKeyword(haystack, profile.include_keywords)
    ? "matched"
    : "rejected";
}

/** Собрать текст для поиска (title + description + skills), нижний регистр. */
function buildHaystack(vacancy: VacancyForFilter): string {
  return [vacancy.title, vacancy.description, vacancy.key_skills.join(" ")]
    .join(" ")
    .toLowerCase();
}

/** true, если haystack содержит хотя бы одно из ключевых слов. Регистронезависимо. */
function hasAnyKeyword(haystack: string, keywords: string[]): boolean {
  return keywords.some((kw) => kw.trim() && haystack.includes(kw.trim().toLowerCase()));
}
