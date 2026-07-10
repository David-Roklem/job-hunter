/**
 * Тесты парсеров hh.ru (чистые функции на cheerio, без Playwright/БД).
 * Фикстуры в tests/fixtures/.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractExternalId,
  parseSalary,
  parseSearchResults,
  parseVacancyDetail,
} from "~/hh/parsers";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const readFixture = (name: string): string =>
  readFileSync(path.join(fixturesDir, name), "utf8");

describe("extractExternalId", () => {
  it("/vacancy/12345678 → '12345678'", () => {
    expect(extractExternalId("/vacancy/12345678?query=node")).toBe("12345678");
  });
  it("полный URL", () => {
    expect(extractExternalId("https://hh.ru/vacancy/99999")).toBe("99999");
  });
  it("невалидный URL → null", () => {
    expect(extractExternalId("/some/promo")).toBeNull();
    expect(extractExternalId("")).toBeNull();
  });
});

describe("parseSalary", () => {
  it("диапазон '200 000 – 250 000 руб.'", () => {
    expect(parseSalary("200 000 – 250 000 руб.")).toEqual({
      from: 200000,
      to: 250000,
      currency: "RUB",
    });
  });
  it("'от 150 000 руб.'", () => {
    expect(parseSalary("от 150 000 руб.")).toEqual({
      from: 150000,
      currency: "RUB",
    });
  });
  it("'до 60 000 USD'", () => {
    expect(parseSalary("до 60 000 USD")).toEqual({
      to: 60000,
      currency: "USD",
    });
  });
  it("'зарплата не указана' → пустой объект", () => {
    expect(parseSalary("зарплата не указана")).toEqual({});
  });
  it("пустая строка → пустой объект", () => {
    expect(parseSalary("")).toEqual({});
    expect(parseSalary("   ")).toEqual({});
  });
  it("тире-разделители (– — -)", () => {
    expect(parseSalary("100000-120000 руб.")).toEqual({
      from: 100000,
      to: 120000,
      currency: "RUB",
    });
  });
});

describe("parseSearchResults", () => {
  it("парсит карточки из фикстуры", () => {
    const html = readFixture("hh-search.html");
    const { cards } = parseSearchResults(html);

    expect(cards).toHaveLength(3); // 4 карточки, но promo без external_id пропадает
    expect(cards[0]).toEqual({
      external_id: "11111111",
      title: "Senior Node.js Developer",
      url: "/vacancy/11111111?query=node",
      company_name: "Тест-Компания",
      salary_text: "200 000 – 250 000 руб.",
      location: "Москва",
    });
    expect(cards[1].title).toBe("Backend Developer");
    expect(cards[1].external_id).toBe("22222222");
    // 3-я карточка без компании
    expect(cards[2].company_name).toBeNull();
    expect(cards[2].salary_text).toBe("зарплата не указана");
  });

  it("пустой/мусорный HTML → пустой массив", () => {
    expect(parseSearchResults("<html></html>").cards).toEqual([]);
    expect(parseSearchResults("").cards).toEqual([]);
  });
});

describe("parseVacancyDetail", () => {
  it("парсит описание + ключевые навыки из фикстуры", () => {
    const html = readFixture("hh-vacancy.html");
    const { description, key_skills } = parseVacancyDetail(html);

    expect(description).toContain("backend-разработчика");
    expect(description).toContain("микросервисами");
    expect(key_skills).toEqual(["Node.js", "PostgreSQL", "Docker"]);
  });
});
