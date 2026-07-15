/**
 * Matcher — матчинг вакансия × резюме-шаблон с AI-скорингом (фаза 08).
 *
 * Двухуровневый алгоритм:
 *   1. rule-based префильтр (prefilter.ts) — дёшево, детерминированно, отсекает
 *      нерелевантное БЕЗ AI-вызова;
 *   2. AI-скоринг z.ai (prompts/match.ts) — только для прошедших префильтр,
 *      возвращает {score 0-100, rationale}.
 *
 * Результат: при score ≥ threshold создаётся application (status='draft' с
 * посчитанным match_score; 'matched' НЕ входит в enum applicationStatuses —
 * это только vacancy.status) и вакансия переводится в status='matched'.
 * draft-generator (фаза 09) найдёт эти applications и наполнит их письмом
 * (→ status='pending_review'). Идемпотентность — повторный матч обновляет
 * score существующего application, а не создаёт дубль.
 *
 * Пробрасывает AiProviderError (как generateCoverLetter) — без записи в БД.
 */
import {
  applicationsRepo,
  resumeTemplatesRepo,
  vacanciesRepo,
} from "~/db/repositories";
import { buildMatchMessages, parseMatchResponse } from "~/ai/prompts/match";
import { zai } from "~/ai/providers/zai";
import type { AiProvider } from "~/ai/types";
import { prefilter } from "./prefilter";

/** Дефолтный порог: score ≥ этого → создаётся application. */
export const DEFAULT_MATCH_THRESHOLD = 50;

/** Входные опции matchVacancy / matchAll. */
export type MatchOptions = {
  /** Порог создания application (дефолт DEFAULT_MATCH_THRESHOLD). */
  threshold?: number;
  /** Переопределить провайдера (для тестов). Дефолт — zai-синглтон. */
  provider?: AiProvider;
  /** Переопределить модель env (ZAI_MODEL). */
  model?: string;
};

/** Результат скоринга одной пары. */
export type MatchResult = {
  vacancyId: number;
  resumeTemplateId: number;
  /** 0-100. 0 — если пара не прошла префильтр (без AI). */
  score: number;
  /** Краткое объяснение скоринга (от AI) или причина отсечения префильтром. */
  rationale: string;
  /** Прошла ли пара порог threshold → создан/обновлён application. */
  passed: boolean;
  /** id созданного/обновлённого application (только если passed). */
  applicationId?: number;
  /** Был ли сделан AI-вызов (false = отсечена префильтром). */
  aiCalled: boolean;
  /** Фактически использованный провайдер (если AI вызывался). */
  provider?: string;
  /** Фактически использованная модель (если AI вызывался). */
  model?: string;
};

/**
 * Сскорить пару вакансия×резюме и (если passed) создать/обновить application.
 *
 * @throws если вакансия/резюме не найдены. Пробрасывает AiProviderError.
 */
export async function matchVacancy(
  vacancyId: number,
  resumeTemplateId: number,
  opts: MatchOptions = {},
): Promise<MatchResult> {
  const threshold = opts.threshold ?? DEFAULT_MATCH_THRESHOLD;
  const provider = opts.provider ?? zai;

  // 1. Загрузить вакансию (relations: source, company) и резюме.
  const vacancy = await vacanciesRepo.findById(vacancyId);
  if (!vacancy) {
    throw new Error(`vacancy ${vacancyId} not found`);
  }
  const resume = resumeTemplatesRepo.findById(resumeTemplateId);
  if (!resume) {
    throw new Error(`resume_template ${resumeTemplateId} not found`);
  }
  if (!resume.is_active) {
    // Согласованность с matchAll (который фильтрует is_active): неактивное
    // резюме = удалено из ротации, скорить по нему нельзя. Возвращаем
    // явный отсев префильтром, БЕЗ AI, БЕЗ application.
    return {
      vacancyId,
      resumeTemplateId,
      score: 0,
      rationale: `resume_template ${resumeTemplateId} неактивен (is_active=false)`,
      passed: false,
      aiCalled: false,
    };
  }

  const base: Pick<MatchResult, "vacancyId" | "resumeTemplateId"> = {
    vacancyId,
    resumeTemplateId,
  };

  // 2. Rule-based префильтр. Не прошёл → score 0, без AI, без application.
  if (!prefilter(vacancy, resume)) {
    return {
      ...base,
      score: 0,
      rationale:
        "не прошёл префильтр: ни один из навыков резюме не найден в тексте вакансии",
      passed: false,
      aiCalled: false,
    };
  }

  // 3. AI-скоринг.
  const messages = buildMatchMessages({
    vacancy: {
      title: vacancy.title,
      company: vacancy.company?.name ?? null,
      description: vacancy.description,
      location: vacancy.location,
      salaryFrom: vacancy.salary_from,
      salaryTo: vacancy.salary_to,
      currency: vacancy.currency,
    },
    resume: {
      name: resume.name,
      role: resume.role,
      summary: resume.summary,
      skills: resume.skills,
    },
  });

  const resp = await provider.chat({
    messages,
    model: opts.model,
    temperature: 0.2,
  });

  // 4. Распарсить ответ (бросок при невалидном JSON — как salary в фазе 07).
  const { score, rationale } = parseMatchResponse(resp.content);
  const passed = score >= threshold;

  // 5. Записать результат: создать/обновить application + перевести вакансию.
  let applicationId: number | undefined;
  if (passed) {
    const existing = applicationsRepo.findByVacancyAndResume(
      vacancyId,
      resumeTemplateId,
    );
    if (existing) {
      // Идемпотентность: повторный матч обновляет score.
      // Статус оставляем как есть — matcher не меняет lifecycle application
      // (draft → pending_review после draft-generator → approved → sent).
      const updated = applicationsRepo.update(existing.id, {
        match_score: score,
      });
      applicationId = updated?.id ?? existing.id;
    } else {
      // Новый application стартует как 'draft' (скор посчитан, черновик письма
      // ещё не сгенерирован — это работа draft-generator, фаза 09). Статус
      // application 'matched' НЕ существует в enum applicationStatuses
      // (draft|pending_review|approved|sent|failed|rejected); 'matched' —
      // только vacancy.status.
      const created = applicationsRepo.create({
        vacancy_id: vacancyId,
        resume_template_id: resumeTemplateId,
        match_score: score,
        status: "draft",
      });
      applicationId = created.id;
    }
    // Вакансия переведена в matched (статус одноразовый — повторный апдейт no-op).
    vacanciesRepo.update(vacancyId, { status: "matched" });
  }

  return {
    ...base,
    score,
    rationale,
    passed,
    applicationId,
    aiCalled: true,
    provider: resp.provider,
    model: resp.model,
  };
}

/** Статистика батчевого прогона matchAll. */
export type MatchAllStats = {
  /** Сколько пар (vacancy × resume) всего проверено. */
  scanned: number;
  /** Сколько из них прошли префильтр и ушли в AI. */
  aiCalls: number;
  /** Сколько пар прошли порог (создан/обновлён application). */
  matched: number;
  /** Сколько уникальных вакансий обработано. */
  vacancies: number;
  /** Детали по каждой паре (для лога/CLI-вывода). */
  results: MatchResult[];
  /** Ошибки провайдера mid-batch (continue-on-error, не роняет весь прогон). */
  errors: MatchAllError[];
};

/** Одна ошибка mid-batch (continue-on-error: не роняет весь matchAll). */
export type MatchAllError = {
  vacancyId: number;
  resumeTemplateId: number;
  message: string;
};

/**
 * Сскорить все вакансии status='new' × все активные resume_templates.
 *
 * Continue-on-error: ошибка провайдера (429/перегрузка/сеть) на одной паре НЕ
 * роняет весь батч — пара пропускается и фиксируется в `errors`, остальные
 * пары обрабатываются. Это важно при ~100 вакансиях × N шаблонов: одна
 * transient-ошибка z.ai не должна терять весь прогон. Уже созданные
 * applications сохраняются (БД-записи коммитятся построчно).
 *
 * Если несколько резюме матчат одну вакансию — создаётся несколько
 * applications, каждое со своим score (выбор «лучшего» шаблона — в review-ui).
 *
 * @param opts threshold/provider/model + ограничение вакансий (max).
 */
export async function matchAll(
  opts: MatchOptions & { max?: number } = {},
): Promise<MatchAllStats> {
  const vacancies = await vacanciesRepo.list({ status: "new" });
  const capped = opts.max !== undefined ? vacancies.slice(0, opts.max) : vacancies;
  const resumes = resumeTemplatesRepo.list().filter((r) => r.is_active);

  const results: MatchResult[] = [];
  const errors: MatchAllError[] = [];
  for (const vacancy of capped) {
    for (const resume of resumes) {
      try {
        const result = await matchVacancy(vacancy.id, resume.id, opts);
        results.push(result);
      } catch (err) {
        // Continue-on-error: фиксируем и идём дальше, не роняя батч.
        // Брошенные matchVacancy ошибки — провайдер (AiProviderError) или
        // невалидный JSON ответа. Не найденные vacancy/resume сюда не попадут
        // (они только что прочитаны). Часть пар может быть обработана успешно.
        errors.push({
          vacancyId: vacancy.id,
          resumeTemplateId: resume.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return {
    scanned: results.length,
    aiCalls: results.filter((r) => r.aiCalled).length,
    matched: results.filter((r) => r.passed).length,
    vacancies: capped.length,
    results,
    errors,
  };
}
