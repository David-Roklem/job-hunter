/**
 * Промпт-шаблоны для генерации сопроводительного письма.
 *
 * Локализация: параметр locale (ru/en). ru — дефолт (фокус проекта на РФ-рынок),
 * en заложен под будущие зарубежные площадки. Язык ответа жёстко задаётся в
 * system-промпте, чтобы модель не путалась.
 */
import type { ChatMessage } from "../types";

export type CoverLetterLocale = "ru" | "en";

/** Контекст для генерации письма (данные из БД, уже собранные). */
export type CoverLetterInput = {
  vacancy: {
    title: string;
    company?: string;
    description: string;
    location?: string;
  };
  resume: {
    name: string;
    role: string;
    summary?: string;
    skills: string[];
    contentMd?: string;
  };
  locale: CoverLetterLocale;
  /**
   * Профиль кандидата (фаза cover-letter-profile). Если задан — модель
   * использует реальные имя/контакты в подписи вместо плейсхолдеров.
   * undefined = профиль не заполнен, старое поведение промпта.
   */
  candidateProfile?: {
    name: string;
    contacts: { telegram?: string; email?: string; phone?: string; github?: string; website?: string; linkedin?: string };
    signature?: string;
  };
};

/** Лимит на длину описания вакансии в промпте (защита от превышения контекста). */
const MAX_DESCRIPTION_CHARS = 4000;
/** Лимит на выдержку резюме в промпте. */
const MAX_RESUME_CHARS = 3000;

/** Собирает system + user сообщения для генерации сопроводительного. */
export function buildCoverLetterMessages(input: CoverLetterInput): ChatMessage[] {
  const { vacancy, resume, locale, candidateProfile } = input;
  const system = SYSTEM[locale];
  const user =
    locale === "ru"
      ? buildUserRu(vacancy, resume, candidateProfile)
      : buildUserEn(vacancy, resume, candidateProfile);
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// --- RU --------------------------------------------------------------------

const SYSTEM: Record<CoverLetterLocale, string> = {
  ru: [
    "Ты — опытный карьерный консультант на российском рынке труда.",
    "Напиши сопроводительное письмо кандидата на вакансию.",
    "Требования:",
    "- 3–4 абзаца, без воды и шаблонных клише («коммуникабельный», «стрессоустойчивый»).",
    "- Опирайся на совпадение навыков из резюме и требований вакансии.",
    "- Тон профессиональный, но живой; обращение к работодателю на «Вы».",
    "- Язык ответа — строго русский.",
    "- НЕ выдумывай факты, которых нет в резюме.",
    "- НЕ упоминай зарплату, если она не задана.",
    // Анти-плейсхолдеры (фаза cover-letter-profile): модель не должна вставлять
    // скобочные заглушки в текст — контакты/имя приходят отдельным блоком.
    "- НЕ используй плейсхолдеры в квадратных скобках ([Имя], [Ссылка], [Email] и т.п.).",
    "- Если в данных кандидата есть имя/контакты — используй их в подписи как есть.",
    "- Если имя/контакты не даны — закончи письмо без подписи (без [Имя]).",
  ].join("\n"),
  en: [
    "You are an experienced career advisor.",
    "Write a cover letter for the job application.",
    "Requirements:",
    "- 3–4 paragraphs, no filler or clichés.",
    "- Ground the letter in the overlap between the resume's skills and the job's requirements.",
    "- Professional yet natural tone.",
    "- Response language: strictly English.",
    "- Do NOT invent facts not present in the resume.",
    "- Do NOT mention salary unless it is given.",
    "- Do NOT use square-bracket placeholders ([Name], [Link], [Email], etc.).",
    "- If the candidate's name/contacts are provided, use them verbatim in the sign-off.",
    "- If name/contacts are not provided, end the letter without a sign-off (no [Name]).",
  ].join("\n"),
};

function buildUserRu(
  vacancy: CoverLetterInput["vacancy"],
  resume: CoverLetterInput["resume"],
  candidateProfile?: CoverLetterInput["candidateProfile"],
): string {
  const desc = truncate(vacancy.description, MAX_DESCRIPTION_CHARS);
  const resumeExcerpt = truncate(resume.contentMd ?? "", MAX_RESUME_CHARS);
  return [
    "ВАКАНСИЯ:",
    `Должность: ${vacancy.title}`,
    vacancy.company ? `Компания: ${vacancy.company}` : "",
    vacancy.location ? `Локация: ${vacancy.location}` : "",
    `Описание:\n${desc}`,
    "",
    "РЕЗЮМЕ КАНДИДАТА:",
    `Имя: ${resume.name}`,
    `Желаемая роль: ${resume.role}`,
    resume.summary ? `Краткое о себе: ${resume.summary}` : "",
    `Ключевые навыки: ${resume.skills.join(", ") || "(не указаны)"}`,
    resumeExcerpt ? `\nВыдержка из резюме:\n${resumeExcerpt}` : "",
    candidateProfileBlockRu(candidateProfile),
    "",
    "Напиши сопроводительное письмо под эту вакансию.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Блок «ДАННЫЕ КАНДИДАТА ДЛЯ ПОДПИСИ» — реальные имя/контакты из профиля. */
function candidateProfileBlockRu(
  p: CoverLetterInput["candidateProfile"],
): string {
  if (!p) return "";
  const contactLines: string[] = [];
  if (p.contacts.telegram) contactLines.push(`Telegram: ${p.contacts.telegram}`);
  if (p.contacts.email) contactLines.push(`Email: ${p.contacts.email}`);
  if (p.contacts.phone) contactLines.push(`Телефон: ${p.contacts.phone}`);
  if (p.contacts.github) contactLines.push(`GitHub: ${p.contacts.github}`);
  if (p.contacts.website) contactLines.push(`Сайт: ${p.contacts.website}`);
  if (p.contacts.linkedin) contactLines.push(`LinkedIn: ${p.contacts.linkedin}`);
  return [
    "",
    "ДАННЫЕ КАНДИДАТА ДЛЯ ПОДПИСИ (используй как есть, без плейсхолдеров):",
    `Имя: ${p.name}`,
    contactLines.length > 0 ? `Контакты:\n${contactLines.join("\n")}` : "",
    p.signature ? `Сигнатура письма:\n${p.signature}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildUserEn(
  vacancy: CoverLetterInput["vacancy"],
  resume: CoverLetterInput["resume"],
  candidateProfile?: CoverLetterInput["candidateProfile"],
): string {
  const desc = truncate(vacancy.description, MAX_DESCRIPTION_CHARS);
  const resumeExcerpt = truncate(resume.contentMd ?? "", MAX_RESUME_CHARS);
  return [
    "JOB:",
    `Title: ${vacancy.title}`,
    vacancy.company ? `Company: ${vacancy.company}` : "",
    vacancy.location ? `Location: ${vacancy.location}` : "",
    `Description:\n${desc}`,
    "",
    "CANDIDATE RESUME:",
    `Name: ${resume.name}`,
    `Target role: ${resume.role}`,
    resume.summary ? `Summary: ${resume.summary}` : "",
    `Key skills: ${resume.skills.join(", ") || "(none)"}`,
    resumeExcerpt ? `\nResume excerpt:\n${resumeExcerpt}` : "",
    candidateProfileBlockEn(candidateProfile),
    "",
    "Write a cover letter for this job.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Candidate profile block for the sign-off (real name/contacts). */
function candidateProfileBlockEn(
  p: CoverLetterInput["candidateProfile"],
): string {
  if (!p) return "";
  const contactLines: string[] = [];
  if (p.contacts.telegram) contactLines.push(`Telegram: ${p.contacts.telegram}`);
  if (p.contacts.email) contactLines.push(`Email: ${p.contacts.email}`);
  if (p.contacts.phone) contactLines.push(`Phone: ${p.contacts.phone}`);
  if (p.contacts.github) contactLines.push(`GitHub: ${p.contacts.github}`);
  if (p.contacts.website) contactLines.push(`Website: ${p.contacts.website}`);
  if (p.contacts.linkedin) contactLines.push(`LinkedIn: ${p.contacts.linkedin}`);
  return [
    "",
    "CANDIDATE DETAILS FOR SIGN-OFF (use verbatim, no placeholders):",
    `Name: ${p.name}`,
    contactLines.length > 0 ? `Contacts:\n${contactLines.join("\n")}` : "",
    p.signature ? `Signature:\n${p.signature}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
