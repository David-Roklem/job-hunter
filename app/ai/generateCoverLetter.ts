/**
 * Генерация сопроводительного письма для отклика.
 *
 * End-to-end срез AI-функциональности: ввод из БД (application + relations) →
 * промпт → LLM (z.ai) → запись в cover_letters. Фаза 09 (draft-generator)
 * расширит это UI-оркестрацией и адаптацией резюме.
 */
import { applicationsRepo, coverLettersRepo, userProfileRepo } from "~/db/repositories";
import { type AiProvider } from "~/db/schema";
import { skillsSchema } from "~/db/repositories/_shared";
import { buildCoverLetterMessages, type CoverLetterLocale } from "./prompts/coverLetter";
import { zai } from "./providers/zai";

export type GenerateCoverLetterOptions = {
  locale?: CoverLetterLocale;
  /** Переопределить модель env (ZAI_MODEL). */
  model?: string;
  /** Температура генерации (дефолт 0.7 — творческий, но устойчивый). */
  temperature?: number;
};

export type GeneratedCoverLetter = {
  body_md: string;
  model: string;
  provider: string;
};

/**
 * Сгенерировать сопроводительное для application и записать в cover_letters.
 *
 * Бросает, если application/vacancy/resume не найдены. Пробрасывает
 * AiProviderError при сбое LLM (без записи в БД — upsert не вызывается).
 */
export async function generateCoverLetter(
  applicationId: number,
  opts: GenerateCoverLetterOptions = {},
): Promise<GeneratedCoverLetter> {
  // 1. Загрузить application с relations (vacancy → company, resume_template).
  // findById не тянет nested company — отдельный запрос через repo для компании.
  const app = await applicationsRepo.findById(applicationId);
  if (!app) {
    throw new Error(`application ${applicationId} not found`);
  }
  const vacancy = app.vacancy;
  const resume = app.resume_template;
  if (!vacancy || !resume) {
    throw new Error(`missing vacancy/resume for application ${applicationId}`);
  }

  // company_name: vacancy → company relation (nested в findById).
  const companyName = vacancy.company?.name;

  // skills: resume_template хранит skills_json (сырой TEXT) — парсим через zod.
  const skills = parseSkills(resume.skills_json);

  // Профиль кандидата (фаза cover-letter-profile): реальные имя/контакты для
  // подписи, чтобы модель не вставляла плейсхолдеры. null = профиль не задан.
  const userProfile = userProfileRepo.get();
  const candidateProfile = userProfile
    ? {
        name: userProfile.name,
        contacts: userProfile.contacts,
        signature: userProfile.signature_md || undefined,
      }
    : undefined;

  // 2. Собрать промпт.
  const messages = buildCoverLetterMessages({
    vacancy: {
      title: vacancy.title,
      company: companyName,
      description: vacancy.description,
      location: vacancy.location ?? undefined,
    },
    resume: {
      name: resume.name,
      role: resume.role,
      summary: resume.summary ?? undefined,
      skills,
      contentMd: resume.content_md ?? undefined,
    },
    locale: opts.locale ?? "ru",
    candidateProfile,
  });

  // 3. Вызвать провайдер.
  const resp = await zai.chat({
    messages,
    model: opts.model,
    temperature: opts.temperature ?? 0.7,
  });

  // 4. Записать в cover_letters (upsert по application_id).
  coverLettersRepo.upsert({
    application_id: applicationId,
    body_md: resp.content,
    ai_provider: resp.provider as AiProvider,
    model: resp.model,
  });

  return {
    body_md: resp.content,
    model: resp.model,
    provider: resp.provider,
  };
}

/** Безопасный парсинг skills_json → string[]. Невалидный → []. */
function parseSkills(skillsJson: string | null): string[] {
  if (!skillsJson) return [];
  try {
    const raw = JSON.parse(skillsJson) as unknown;
    const parsed = skillsSchema.safeParse(raw);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
