/**
 * Тесты бинарного include/exclude фильтра (чистая функция, без зависимостей).
 */
import { describe, expect, it } from "vitest";
import { filterVacancy } from "~/hh/filter";

const baseVacancy = {
  title: "Senior Node.js Developer",
  description: "Требуется опыт с PostgreSQL и микросервисами.",
  key_skills: ["Node.js", "PostgreSQL", "Docker"],
};

describe("filterVacancy", () => {
  it("include попадает → matched", () => {
    const result = filterVacancy(baseVacancy, {
      include_keywords: ["Node.js"],
      exclude_keywords: [],
    });
    expect(result).toBe("matched");
  });

  it("include попадает по навыку из key_skills → matched", () => {
    const result = filterVacancy(baseVacancy, {
      include_keywords: ["Docker"],
      exclude_keywords: [],
    });
    expect(result).toBe("matched");
  });

  it("include не попадает → rejected", () => {
    const result = filterVacancy(baseVacancy, {
      include_keywords: ["Python"],
      exclude_keywords: [],
    });
    expect(result).toBe("rejected");
  });

  it("exclude попадает → rejected (даже если include есть)", () => {
    const result = filterVacancy(baseVacancy, {
      include_keywords: ["Node.js"],
      exclude_keywords: ["микросервисами"],
    });
    expect(result).toBe("rejected");
  });

  it("include пустой → matched (при отсутствии exclude)", () => {
    const result = filterVacancy(baseVacancy, {
      include_keywords: [],
      exclude_keywords: [],
    });
    expect(result).toBe("matched");
  });

  it("регистронезависимость (include 'node.js' vs title 'Node.js')", () => {
    const result = filterVacancy(baseVacancy, {
      include_keywords: ["node.js"],
      exclude_keywords: [],
    });
    expect(result).toBe("matched");
  });

  it("exclude приоритетнее пустого include", () => {
    const result = filterVacancy(baseVacancy, {
      include_keywords: [],
      exclude_keywords: ["postgres"],
    });
    expect(result).toBe("rejected");
  });

  it("пустые exclude-слова игнорируются (не матчат всё)", () => {
    const result = filterVacancy(baseVacancy, {
      include_keywords: ["Node.js"],
      exclude_keywords: ["", "   "],
    });
    expect(result).toBe("matched");
  });
});
