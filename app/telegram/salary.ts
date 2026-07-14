/**
 * Извлечение зарплаты из поста Telegram-канала — гибрид: регэксп-прелиминар
 * + AI (z.ai) для сложных случаев.
 *
 * Стратегия (решение discuss: гибрид):
 *   1. Прелиминар-регэксп: если в тексте НЕТ ни цифр, ни маркеров валют/«к»/«k»
 *      → сразу null без вызова AI (экономия запросов; ~100 постов/день).
 *   2. Иначе — AI-промпт (app/ai/prompts/salary.ts) парсит свободный текст.
 *
 * Все ошибки AI → null (не падать; зарплата опциональна). Логирование — на
 * стороне вызывающего (collect.ts).
 */
import { z } from "zod";
import { buildSalaryMessages } from "~/ai/prompts/salary";
import { zai } from "~/ai/providers/zai";
import type { AiProvider } from "~/ai/types";

/** Результат извлечения зарплаты. Поля опциональны (диапазон/одна граница). */
export type ParsedSalary = {
  from?: number;
  to?: number;
  currency?: string;
};

/** Zod-схема ответа AI (строгая — только эти поля). */
const salaryResponseSchema = z
  .object({
    from: z.number().int().positive().optional(),
    to: z.number().int().positive().optional(),
    currency: z.enum(["RUB", "USD", "EUR"]).optional(),
  })
  .strict()
  .nullable();

/**
 * Прелиминар: есть ли в тексте вообще признаки зарплаты?
 * true → стоит вызвать AI. false → точно null (нет цифр/валют/k).
 *
 * Маркеры: цифры рядом с $/€/₽/руб/к/k/тыс, либо слова «зарплата»/«зп»/«вилка»/«salary».
 */
export function mightContainSalary(text: string): boolean {
  // Цифра + маркер валюты/множителя в одном «окне» (±15 символов).
  if (/\d[\d.,\s]{0,4}\s*(k|к|тыс|usd|eur|руб|rub|\$|€|₽)/i.test(text)) return true;
  if (/(\$|€|₽)\s*[\d.,]+/i.test(text)) return true;
  // Ключевые слова зарплаты рядом с цифрой.
  if (/(зарплат[аы]|зп|вилк[аи]|salary|compensation|компенсаци)/i.test(text)) return true;
  return false;
}

/**
 * Извлечь зарплату из текста поста.
 *
 * @param text полный текст поста.
 * @param provider опционально — переопределить z.ai (для тестов/моков).
 * @returns ParsedSalary (возможно пустой) или null, если не найдено.
 *          Никогда не бросает — AI-ошибка → null.
 */
export async function parseSalaryAi(
  text: string,
  provider: AiProvider = zai,
): Promise<ParsedSalary | null> {
  // 1. Прелиминар: нет признаков зарплаты → null без AI.
  if (!mightContainSalary(text)) return null;

  // 2. AI-промпт.
  let content: string;
  try {
    const resp = await provider.chat({
      messages: buildSalaryMessages(text),
      temperature: 0, // детерминированность парсинга
    });
    content = resp.content.trim();
  } catch {
    // AI-сбой → null (зарплата опциональна, не валить сбор).
    return null;
  }

  // 3. Парсинг JSON-ответа. Модель может обернуть в ```json — чистим.
  const cleaned = stripCodeFence(content);
  try {
    const raw = JSON.parse(cleaned) as unknown;
    return salaryResponseSchema.parse(raw);
  } catch {
    // Невалидный JSON/схема → null.
    return null;
  }
}

/** Убрать markdown-обёртку ```json ... ``` если модель её добавила. */
function stripCodeFence(s: string): string {
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1]!.trim() : s;
}
