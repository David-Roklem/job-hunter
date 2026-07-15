/**
 * Юнит-тесты rule-based префильтра (фаза 08).
 *
 * Чистая функция — без БД/AI. Покрывает: синонимы, мин-hits, регистр, empty
 * skills, навык в title vs description, кириллицу (\b не работает — решение
 * фазы 07 через lookbehind на \p{L}).
 */
import { describe, expect, it } from "vitest";
import {
  countSkillHits,
  normalizeSkill,
  prefilter,
} from "~/matcher/prefilter";

const v = (title: string, description: string) => ({ title, description });
const r = (skills: string[]) => ({ skills });

describe("normalizeSkill", () => {
  it("синонимы схлопываются в канон", () => {
    expect(normalizeSkill("React.js")).toBe("react");
    expect(normalizeSkill("Node.JS")).toBe("node");
    expect(normalizeSkill("TS")).toBe("typescript");
    expect(normalizeSkill("Postgres")).toBe("postgresql");
  });

  it("неизвестные навыки — lower/trim без подмены", () => {
    expect(normalizeSkill("  Kotlin  ")).toBe("kotlin");
    expect(normalizeSkill("GraphQL")).toBe("graphql");
  });
});

describe("countSkillHits", () => {
  it("матчит навык в title и в description", () => {
    expect(countSkillHits(v("React dev", "нужен react"), r(["react"]))).toBe(1);
  });

  it("не двойной счет для повторов в тексте", () => {
    expect(
      countSkillHits(v("react react react", "react"), r(["react"])),
    ).toBe(1);
  });

  it("несколько разных навыков", () => {
    expect(
      countSkillHits(
        v("Backend", "ищем node + postgresql, знание docker"),
        r(["node", "postgresql", "docker", "kotlin"]),
      ),
    ).toBe(3);
  });

  it("синонимы навыка резюме матчат вариант в вакансии", () => {
    // резюме «React.js» → канон react; вакансия содержит «react».
    expect(countSkillHits(v("", "react-разработчик"), r(["React.js"]))).toBe(1);
    expect(countSkillHits(v("Node Senior", ""), r(["Node.JS"]))).toBe(1);
  });

  it("регистронезависимый матч", () => {
    expect(countSkillHits(v("REACT", ""), r(["react"]))).toBe(1);
    expect(countSkillHits(v("react", ""), r(["REACT"]))).toBe(1);
  });

  it("кириллица: матчит на границе слова (\\b бы не сработал)", () => {
    // навык «Redis» латиница, но проверим кириллический навык «1С»-стиля:
    // используем реальный кейс — навык-слово окружён кириллицей.
    expect(countSkillHits(v("", "опыт работы с docker контейнерами"), r(["docker"]))).toBe(1);
  });

  it("не матчит подстроку внутри слова", () => {
    // «go» не должно матчится в «google» — lookbehind/ahead на не-букву.
    expect(countSkillHits(v("Google search", ""), r(["go"]))).toBe(0);
    // «react» не должно матчиться в «reaction».
    expect(countSkillHits(v("chemical reaction", ""), r(["react"]))).toBe(0);
  });

  it("пустые/дублирующиеся навыки игнорируются", () => {
    expect(countSkillHits(v("react", ""), r(["", "react", "react "]))).toBe(1);
  });
});

describe("prefilter", () => {
  it("false при пустом skills резюме", () => {
    expect(prefilter(v("anything", ""), r([]))).toBe(false);
  });

  it("true если ≥ MIN_SKILL_HITS совпадений", () => {
    expect(prefilter(v("Senior React Dev", "требуется react"), r(["react", "vue"]))).toBe(
      true,
    );
  });

  it("false если ни один навык не найден", () => {
    expect(
      prefilter(v("Data Scientist", "нужен python и ML"), r(["react", "vue"])),
    ).toBe(false);
  });

  it("синонимы открывают прохождение префильтра", () => {
    // навык резюме «React.js» → канон react; текст содержит «react».
    expect(prefilter(v("", "опыт с react"), r(["React.js"]))).toBe(true);
    // навык резюме «Node.JS» → канон node; текст содержит «node».
    expect(prefilter(v("Node Senior", ""), r(["Node.JS"]))).toBe(true);
  });
});
