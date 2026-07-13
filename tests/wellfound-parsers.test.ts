/**
 * Тесты парсеров Wellfound (чистые функции на cheerio, без Playwright/БД).
 * Фикстуры в tests/fixtures/. Паттерн — tests/hh-parsers.test.ts.
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
} from "~/wellfound/parsers";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const readFixture = (name: string): string =>
  readFileSync(path.join(fixturesDir, name), "utf8");

describe("extractExternalId", () => {
  it("/jobs/1234567-senior-backend → '1234567'", () => {
    expect(extractExternalId("/jobs/1234567-senior-backend")).toBe("1234567");
  });
  it("/jobs/9876543 → '9876543'", () => {
    expect(extractExternalId("/jobs/9876543")).toBe("9876543");
  });
  it("полный URL wellfound", () => {
    expect(extractExternalId("https://wellfound.com/jobs/5555555-x")).toBe(
      "5555555",
    );
  });
  it("невалидный URL → null", () => {
    expect(extractExternalId("/promo/some-promo")).toBeNull();
    expect(extractExternalId("/jobs/abc-no-numbers")).toBeNull();
    expect(extractExternalId("")).toBeNull();
  });
});

describe("parseSalary", () => {
  it("диапазон '$150k–$180k'", () => {
    expect(parseSalary("$150k–$180k")).toEqual({
      from: 150000,
      to: 180000,
      currency: "USD",
    });
  });
  it("одиночное '$120K'", () => {
    expect(parseSalary("$120K")).toEqual({
      from: 120000,
      currency: "USD",
    });
  });
  it("диапазон с запятыми '$90,000 - $110,000'", () => {
    expect(parseSalary("$90,000 - $110,000")).toEqual({
      from: 90000,
      to: 110000,
      currency: "USD",
    });
  });
  it("'equity-only' → пустой объект", () => {
    expect(parseSalary("equity-only")).toEqual({});
  });
  it("пустая строка → пустой объект", () => {
    expect(parseSalary("")).toEqual({});
    expect(parseSalary("   ")).toEqual({});
  });
  it("дефис-разделители (– — -)", () => {
    expect(parseSalary("$100k-$120k")).toEqual({
      from: 100000,
      to: 120000,
      currency: "USD",
    });
  });
});

describe("parseSearchResults", () => {
  it("парсит карточки из фикстуры", () => {
    const html = readFixture("wellfound-search.html");
    const { cards } = parseSearchResults(html);

    // 4 карточки в фикстуре, но promo без валидного external_id пропадает.
    expect(cards).toHaveLength(3);
    expect(cards[0]).toEqual({
      external_id: "1111111",
      title: "Senior Backend Engineer",
      url: "/jobs/1111111-senior-backend-engineer",
      company_name: "Acme Corp",
      salary_text: "$150k–$180k",
      location: "Remote (US)",
    });
    expect(cards[1].title).toBe("Backend Developer");
    expect(cards[1].external_id).toBe("2222222");
    // 3-я карточка без компании
    expect(cards[2].company_name).toBeNull();
    expect(cards[2].salary_text).toBe("equity-only");
  });

  it("пустой/мусорный HTML → пустой массив", () => {
    expect(parseSearchResults("<html></html>").cards).toEqual([]);
    expect(parseSearchResults("").cards).toEqual([]);
  });
});

describe("parseVacancyDetail", () => {
  it("парсит описание + навыки + equity из фикстуры", () => {
    const html = readFixture("wellfound-vacancy.html");
    const { description, key_skills, equity } = parseVacancyDetail(html);

    expect(description).toContain("Senior Backend Engineer");
    expect(description).toContain("microservices");
    expect(key_skills).toEqual(["Node.js", "PostgreSQL", "Docker"]);
    expect(equity).toBe("$150k–$180k + equity");
  });
});
