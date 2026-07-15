/**
 * Rule-based префильтр матчинга (фаза 08).
 *
 * Детерминированная, дешёвая проверка «есть ли смысл гнать пару вакансия×резюме
 * через AI-скоринг». Без БД/AI — чистая функция, тривиально юнит-тестируется.
 *
 * Логика: нормализуем навыки резюме (lower/trim + синонимы), считаем сколько из
 * них встречаются в тексте вакансии (title + description). Если нашлось хотя бы
 * MIN_SKILL_HITS — пара проходит префильтр и уходит в AI-скоринг (z.ai). Иначе —
 * отсекается здесь, без дорогого AI-вызова (соответствует решению фазы 05:
 * бинарный include/exclude фильтр при сборе отсекает мусор рано).
 *
 * Матч навыка — на границе слова, но \b (ASCII-only) НЕ работает для кириллицы
 * (урок фазы 07: parseLocation возвращал null для «в Москве»). Используем
 * lookbehind/lookahead на не-букву с флагом u, который покрывает \p{L} (все
 * скрипты, вкл. кириллицу).
 */

/** Сколько навыков должно совпасть, чтобы пара прошла префильтр. */
export const MIN_SKILL_HITS = 1;

/** Вход префильтра: минимум полей вакансии, нужных для матчинга. */
export type PrefilterVacancy = {
  title: string;
  description: string;
};

/** Вход префильтра: минимум полей резюме. */
export type PrefilterResume = {
  skills: string[];
};

/**
 * Базовый словарь синонимов навыков. Ключ — нормализованная (lower/trim) форма,
 * значение — канон. Расширяемо: добавь строку и матч подхватит вариант.
 *
 * Покрывает частые расхождения написания стека: «React.js» vs «react»,
 * «Node.JS» vs «node», «TS» vs «typescript». Намеренно короткий — это НЕ
 * полная онтология, а снятие тривиальных расхождений; остальное допскажет AI.
 */
const SYNONYMS: Readonly<Record<string, string>> = {
  "react.js": "react",
  "reactjs": "react",
  "react-native": "react native",
  "react native": "react native",
  "node.js": "node",
  "nodejs": "node",
  "node js": "node",
  vuejs: "vue",
  "vue.js": "vue",
  "next.js": "next",
  "nextjs": "next",
  "nuxt.js": "nuxt",
  nuxtjs: "nuxt",
  ts: "typescript",
  js: "javascript",
  "c++": "cpp",
  "c#": "csharp",
  "go": "golang",
  golang: "golang",
  postgres: "postgresql",
  postgresql: "postgresql",
  pgsql: "postgresql",
  mongo: "mongodb",
  k8s: "kubernetes",
  "rest api": "rest",
  graphql: "graphql",
  tailwindcss: "tailwind",
};

/** Привести навык к канонической форме (lower/trim + синоним). */
export function normalizeSkill(skill: string): string {
  const base = skill.trim().toLowerCase();
  return SYNONYMS[base] ?? base;
}

/**
 * Построить regex для поиска навыка в тексте.
 *
 * Использует lookbehind/lookahead на не-букву (\p{L}) вместо \b, чтобы матчить
 * кириллицу и любые скрипты. Флаг u обязателен для \p{...}.
 * Навык экранируется от regex-метасимволов.
 */
function buildSkillRegex(skill: string): RegExp {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // (?<![\p{L}]) — перед навыком не буква (или начало строки);
  // (?![\p{L}])  — после навыка не буква (или конец строки).
  return new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`, "iu");
}

/**
 * Подготовить вакансию к матчингу: слить title + description, lowercased.
 */
function vacancyText(vacancy: PrefilterVacancy): string {
  return `${vacancy.title}\n${vacancy.description}`.toLowerCase();
}

/**
 * Сколько навыков резюме встречаются в тексте вакансии.
 * Каждый канонический навык считается один раз (Set).
 */
export function countSkillHits(
  vacancy: PrefilterVacancy,
  resume: PrefilterResume,
): number {
  const text = vacancyText(vacancy);
  const seen = new Set<string>();
  for (const raw of resume.skills) {
    const skill = normalizeSkill(raw);
    if (!skill) continue;
    if (seen.has(skill)) continue;
    if (buildSkillRegex(skill).test(text)) {
      seen.add(skill);
    }
  }
  return seen.size;
}

/**
 * Проходит ли пара префильтр (есть смысл гнать в AI-скоринг).
 *
 * true — если countSkillHits ≥ MIN_SKILL_HITS. Пустой skills резюме → false
 * (без навыков матчить нечего; AI будет гадать).
 */
export function prefilter(
  vacancy: PrefilterVacancy,
  resume: PrefilterResume,
): boolean {
  if (resume.skills.length === 0) return false;
  return countSkillHits(vacancy, resume) >= MIN_SKILL_HITS;
}
