/**
 * Тесты переиспользования бинарного фильтра (app/hh/filter.ts) с формой
 * вакансии Wellfound (англоязычный title/description/skills).
 *
 * Сам filter.ts НЕ дублируется — проверяем, что общий фильтр корректно
 * работает на wellfound-данных (международный рынок).
 *
 * Паттерн — tests/hh-filter.test.ts.
 */
import { describe, expect, it } from "vitest";
import { filterVacancy } from "~/hh/filter";
import type { SearchProfileDTO } from "~/db/repositories/search_profiles";

/** Минимальный профиль под Wellfound (include: backend-слова, exclude: frontend). */
function profile(
  overrides: Partial<
    Pick<SearchProfileDTO, "include_keywords" | "exclude_keywords">
  > = {},
): Pick<SearchProfileDTO, "include_keywords" | "exclude_keywords"> {
  return {
    include_keywords: ["backend", "node", "python", "api"],
    exclude_keywords: ["frontend", "intern", "junior"],
    ...overrides,
  };
}

describe("filterVacancy — Wellfound (английский)", () => {
  it("backend-вакансия с include-словом → matched", () => {
    expect(
      filterVacancy(
        {
          title: "Senior Backend Engineer",
          description: "Build APIs in Node.js and PostgreSQL.",
          key_skills: ["Node.js", "PostgreSQL", "Docker"],
        },
        profile(),
      ),
    ).toBe("matched");
  });

  it("frontend в title → rejected (exclude)", () => {
    expect(
      filterVacancy(
        {
          title: "Frontend Engineer",
          description: "React, TypeScript.",
          key_skills: ["React", "TypeScript"],
        },
        profile(),
      ),
    ).toBe("rejected");
  });

  it("intern в skills → rejected (exclude приоритетнее include)", () => {
    expect(
      filterVacancy(
        {
          title: "Backend Engineer",
          description: "Great opportunity to learn backend.",
          key_skills: ["Node.js", "intern"],
        },
        profile(),
      ),
    ).toBe("rejected");
  });

  it("нет include-слов и нет exclude → rejected (include задан, нужен match)", () => {
    expect(
      filterVacancy(
        {
          title: "DevOps Specialist",
          description: "Kubernetes, Terraform.",
          key_skills: ["Kubernetes", "Terraform"],
        },
        profile(),
      ),
    ).toBe("rejected");
  });

  it("пустой include → проходит (matched), если не попал в exclude", () => {
    expect(
      filterVacancy(
        {
          title: "Designer",
          description: "UI/UX design.",
          key_skills: ["Figma"],
        },
        profile({ include_keywords: [] }),
      ),
    ).toBe("matched");
  });
});
