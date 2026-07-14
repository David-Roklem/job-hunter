/**
 * Тесты извлечения зарплаты из поста (parseSalaryAi).
 *
 * parseSalaryAi принимает AiProvider параметром → мок внедряется напрямую,
 * без vi.stubGlobal. Проверяем: прелиминар (нет признаков → null без AI),
 * парсинг валидного JSON-ответа, обёртку в ```json, null-ответ, невалидный
 * JSON, AI-ошибку → null. Реальная сеть/AI НЕ дёргаются.
 */
import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "~/ai/types";
import { mightContainSalary, parseSalaryAi } from "~/telegram/salary";

/** Фейковый провайдер: возвращает заданный content. */
function fakeProvider(content: string): AiProvider {
  return {
    name: "test",
    chat: vi.fn(async () => ({ content, model: "test-model", provider: "test" })),
  };
}

/** Провайдер, бросающий ошибку. */
function throwingProvider(message: string): AiProvider {
  return {
    name: "test",
    chat: vi.fn(async () => {
      throw new Error(message);
    }),
  };
}

describe("mightContainSalary (прелиминар)", () => {
  it("true для $/k", () => {
    expect(mightContainSalary("ЗП $120k")).toBe(true);
    expect(mightContainSalary("$150,000")).toBe(true);
  });

  it("true для руб/к", () => {
    expect(mightContainSalary("вилка 250-350к руб")).toBe(true);
    expect(mightContainSalary("от 200 тыс")).toBe(true);
  });

  it("true для ключевых слов зарплаты с цифрой", () => {
    expect(mightContainSalary("зарплата по итогам собеса")).toBe(true);
    expect(mightContainSalary("salary 5000 EUR")).toBe(true);
  });

  it("false для текста без признаков", () => {
    expect(mightContainSalary("Backend developer, remote")).toBe(false);
    expect(mightContainSalary("Ищем Node.js разработчика в команду")).toBe(false);
  });
});

describe("parseSalaryAi", () => {
  it("прелиминар false → null без вызова AI", async () => {
    const provider = fakeProvider('{"from":100000,"currency":"RUB"}');
    // Текст БЕЗ признаков зарплаты (ни цифр-возле-валюты, ни ключевых слов).
    const result = await parseSalaryAi("Ищем Node.js разработчика, remote, полный день", provider);
    expect(result).toBeNull();
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("диапазон RUB из валидного JSON", async () => {
    const provider = fakeProvider('{"from":250000,"to":350000,"currency":"RUB"}');
    const result = await parseSalaryAi("вилка 250-350к", provider);
    expect(result).toEqual({ from: 250000, to: 350000, currency: "RUB" });
  });

  it("одиночное значение USD", async () => {
    const provider = fakeProvider('{"from":120000,"currency":"USD"}');
    const result = await parseSalaryAi("ЗП $120k", provider);
    expect(result).toEqual({ from: 120000, currency: "USD" });
  });

  it("разбирает JSON в markdown-обёртке ```json", async () => {
    const provider = fakeProvider('```json\n{"from":100,"to":200,"currency":"EUR"}\n```');
    const result = await parseSalaryAi("100-200 EUR", provider);
    expect(result).toEqual({ from: 100, to: 200, currency: "EUR" });
  });

  it("null-ответ AI → null (зарплата не указана)", async () => {
    const provider = fakeProvider("null");
    const result = await parseSalaryAi("зарплата по договорённости", provider);
    expect(result).toBeNull();
  });

  it("невалидный JSON → null", async () => {
    const provider = fakeProvider("не JSON вообще");
    const result = await parseSalaryAi("зп 100500", provider);
    expect(result).toBeNull();
  });

  it("невалидная схема (лишние поля) → null", async () => {
    const provider = fakeProvider('{"from":100,"extra":"x","currency":"RUB"}');
    const result = await parseSalaryAi("зп 100", provider);
    expect(result).toBeNull();
  });

  it("AI-ошибка → null (не падать)", async () => {
    const provider = throwingProvider("network down");
    const result = await parseSalaryAi("зарплата 100000 руб", provider);
    expect(result).toBeNull();
  });

  it("отрицательные/нулевые суммы отбрасываются схемой → null", async () => {
    const provider = fakeProvider('{"from":-100,"currency":"RUB"}');
    const result = await parseSalaryAi("зп -100", provider);
    expect(result).toBeNull();
  });

  it("дефолтный провайдер (z.ai) — не падает на импорте", async () => {
    // Прелиминар false → не дойдёт до реальной сети.
    const result = await parseSalaryAi("нет признаков зарплаты тут");
    expect(result).toBeNull();
  });
});
