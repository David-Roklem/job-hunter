/**
 * Промпт для AI-скоринга релевантности вакансии кандидату (фаза 08).
 *
 * После rule-based префильтра (prefilter.ts) пара вакансия×резюме идёт сюда:
 * z.ai оценивает релевантность и возвращает {score, rationale}. Score 0–100 —
 * целое, соответствует applications.match_score (integer).
 *
 * Возвращает СТРОГО JSON: {"score": 0-100, "rationale": "<1-2 предложения>"}.
 * Низкая температура (0.2) для устойчивости. По образцу salary.ts.
 */
import { z } from "zod";
import type { ChatMessage } from "../types";

/** Максимальная длина описания вакансии в промпте (защита контекста токенов). */
const MAX_DESC_CHARS = 2500;

/** Максимальная длина summary резюме в промпте. */
const MAX_SUMMARY_CHARS = 1000;

/** Вход сборки промпта. */
export type MatchPromptInput = {
  vacancy: {
    title: string;
    /** Может быть null/undefined — вакансии Telegram не всегда привязаны к компании. */
    company?: string | null;
    description: string;
    location?: string | null;
    salaryFrom?: number | null;
    salaryTo?: number | null;
    currency?: string | null;
  };
  resume: {
    name: string;
    role: string;
    summary?: string | null;
    skills: string[];
  };
};

/** Собирает system + user сообщения для скоринга релевантности. */
export function buildMatchMessages(input: MatchPromptInput): ChatMessage[] {
  const v = input.vacancy;
  const r = input.resume;

  const desc = clamp(v.description, MAX_DESC_CHARS);
  const summary = r.summary ? clamp(r.summary, MAX_SUMMARY_CHARS) : "—";
  const skills = r.skills.length > 0 ? r.skills.join(", ") : "—";
  const company = v.company ?? "—";
  const location = v.location ?? "—";
  const salary = formatSalary(v.salaryFrom, v.salaryTo, v.currency);

  const user = [
    "## Вакансия",
    `Название: ${v.title}`,
    `Компания: ${company}`,
    `Локация: ${location}`,
    salary ? `Зарплата: ${salary}` : "Зарплата: не указана",
    "",
    "Описание:",
    desc,
    "",
    "## Кандидат",
    `Имя: ${r.name}`,
    `Роль: ${r.role}`,
    `Навыки: ${skills}`,
    "О себе:",
    summary,
    "",
    "Оцени релевантность кандидата этой вакансии.",
  ].join("\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/** Zod-схема ответа скоринга. */
export const matchResponseSchema = z.object({
  score: z.number().int().min(0).max(100),
  rationale: z.string(),
});

export type MatchResponse = z.infer<typeof matchResponseSchema>;

/**
 * Распарсить ответ AI в {score, rationale}.
 *
 * Допускает JSON в markdown-обёртке ```json ... ``` (модели иногда добавляют).
 * Некорректный JSON или невалидная форма → бросок (как parseSalary в фазе 07:
 * лучше упасть явно, чем молча вернуть мусорный скор).
 */
export function parseMatchResponse(content: string): MatchResponse {
  const json = stripCodeFence(content).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new Error(
      `parseMatchResponse: ответ не является JSON (префикс=${JSON.stringify(json.slice(0, 80))})`,
      { cause },
    );
  }
  return matchResponseSchema.parse(parsed);
}

// --- промпт ----------------------------------------------------------------

const SYSTEM_PROMPT = [
  "Ты — технический рекрутер, оценивающий релевантность кандидата вакансии.",
  "Верни СТРОГО JSON без markdown-обёртки и пояснений:",
  '  {"score": <целое 0-100>, "rationale": "<1-2 предложения>"}',
  "Критерии оценки score:",
  "- 90-100: кандидат идеально подходит — стек/навыки совпадают, уровень опыта соответствует роли.",
  "- 70-89:  сильное совпадение по большинству ключевых требований.",
  "- 50-69:  частичное совпадение — есть релевантные навыки, но не все ключевые покрыты.",
  "- 30-49:  слабое совпадение — роль смежная, но заметны пробелы по ключевому стеку.",
  "- 0-29:   не подходит — роль/уровень/стек существенно расходятся.",
  "Учитывай: совпадение ключевых навыков/технологий, соответствие роли и уровня,",
  "релевантность опыта. Штрафуй за отсутствие явно требуемых технологий в стеке кандидата.",
  "rationale — кратко: что совпало и чего не хватило. На русском.",
  "Никаких полей кроме score и rationale, никакого текста кроме JSON.",
].join("\n");

// --- хелперы ----------------------------------------------------------------

/** Обрезать текст до лимита с многоточием. */
function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Снять markdown-блок кода ```json ... ``` или ``` ... ```, если модель его добавила.
 * Возвращает исходную строку, если блока нет.
 */
function stripCodeFence(content: string): string {
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i;
  const match = content.match(fence);
  return match ? match[1]! : content;
}

/** Форматировать зарплату в человекочитаемый вид (или пусто, если не задана). */
function formatSalary(
  from?: number | null,
  to?: number | null,
  currency?: string | null,
): string {
  if (from === null && to === null) return "";
  const cur = currency ?? "";
  if (from !== null && from !== undefined && to !== null && to !== undefined) {
    return `${from}-${to} ${cur}`.trim();
  }
  if (from !== null && from !== undefined) return `от ${from} ${cur}`.trim();
  if (to !== null && to !== undefined) return `до ${to} ${cur}`.trim();
  return "";
}
