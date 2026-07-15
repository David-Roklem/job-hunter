/**
 * Батч-оркестратор генерации сопроводительных писем (фаза 09).
 *
 * Не reimplements `generateCoverLetter()` (фаза 04) — переиспользует его как
 * есть. Этот модуль добавляет:
 *  - generateDraftsOne: обёртка для одного application → DraftResult
 *  - generateDraftsAll: батч по applications status='draft' без письма,
 *    с continue-on-error (зеркало matcher 08).
 *
 * Resume НЕ адаптируется — это загруженный пользователем шаблон (truth #1).
 * AI пишет только сопроводительное письмо.
 */
import { applicationsRepo, coverLettersRepo } from "~/db/repositories";
import type { CoverLetterLocale } from "./prompts/coverLetter";
import { generateCoverLetter } from "./generateCoverLetter";

export type GenerateDraftsOptions = {
  /** Только applications с match_score >= порога (опц., по умолчанию без фильтра). */
  minScore?: number;
  /** Локаль промпта (по умолчанию 'ru'). */
  locale?: CoverLetterLocale;
  /** Переопределить модель env (ZAI_MODEL). */
  model?: string;
  /** Температура генерации (пробрасывается в generateCoverLetter). */
  temperature?: number;
  /** Лимит кандидатов (для дешёвых прогонов/тестов). */
  max?: number;
};

export type DraftResult = {
  applicationId: number;
  vacancyId: number;
  resumeTemplateId: number;
  success: boolean;
  /** Длина сгенерированного письма (для лога/CLI-вывода). */
  bodyLength: number;
};

export type DraftError = {
  applicationId: number;
  message: string;
};

export type GenerateDraftsStats = {
  /** Сколько candidates (draft без письма, после minScore) найдено. */
  candidates: number;
  /** Сколько писем успешно сгенерировано. */
  generated: number;
  /** Сколько пропущено (уже есть письмо / не прошёл minScore). */
  skipped: number;
  /** Ошибки AI mid-batch (continue-on-error, не роняет весь прогон). */
  errors: DraftError[];
  /** Детали по каждой паре (для CLI-вывода). */
  results: DraftResult[];
};

/**
 * Сгенерировать письмо для одного application (обёртка над generateCoverLetter).
 *
 * Бросает, если application не найден (делегирует generateCoverLetter) или при
 * сбое AI (проброс). На успехе возвращает DraftResult с длиной тела.
 *
 * НЕ проверяет наличие существующего письма — upsert в cover_letters (фаза 04)
 * идемпотентно перезапишет. Для батча с дедупом используй generateDraftsAll.
 */
export async function generateDraftsOne(
  applicationId: number,
  opts: GenerateDraftsOptions = {},
): Promise<DraftResult> {
  const app = await applicationsRepo.findById(applicationId);
  if (!app) {
    // Делегируем каноничное сообщение об ошибке generateCoverLetter, чтобы
    // сохранить единое поведение с фазой 04 (там бросает с тем же текстом).
    await generateCoverLetter(applicationId, {
      locale: opts.locale,
      model: opts.model,
      temperature: opts.temperature,
    });
    throw new Error("unreachable: generateCoverLetter should have thrown");
  }

  const result = await generateCoverLetter(applicationId, {
    locale: opts.locale,
    model: opts.model,
    temperature: opts.temperature,
  });

  return {
    applicationId,
    vacancyId: app.vacancy_id,
    resumeTemplateId: app.resume_template_id,
    success: true,
    bodyLength: result.body_md.length,
  };
}

/**
 * Сгенерировать письма для всех applications status='draft' без письма.
 *
 * Continue-on-error: transient-ошибка z.ai (429/перегрузка/сеть) на одном
 * application НЕ роняет батч — пара фиксируется в `errors`, остальные
 * обрабатываются. Уже созданные письма сохраняются (БД коммитится построчно).
 *
 * Фильтры:
 *  - status='draft' (от matcher'а фазы 08)
 *  - нет cover_letter (дедуп — повторный прогон пропускает обработанные)
 *  - match_score >= minScore (опц., если задан)
 *
 * @param opts minScore/locale/model/temperature/max.
 */
export async function generateDraftsAll(
  opts: GenerateDraftsOptions = {},
): Promise<GenerateDraftsStats> {
  const drafts = await applicationsRepo.list({ status: "draft" });

  // Фильтр minScore: отсечь слабые скоры ДО проверки письма (дешевле).
  const afterScore =
    opts.minScore !== undefined
      ? drafts.filter((a) => (a.match_score ?? 0) >= opts.minScore!)
      : drafts;

  // Фильтр «нет письма» — дедуп (повторный прогон не перегенерирует).
  const candidates = afterScore.filter(
    (a) => coverLettersRepo.findByApplicationId(a.id) === undefined,
  );

  const capped =
    opts.max !== undefined ? candidates.slice(0, opts.max) : candidates;

  const results: DraftResult[] = [];
  const errors: DraftError[] = [];
  // skipped = отброшено minScore + уже имеет письмо.
  const skipped = drafts.length - afterScore.length + (afterScore.length - candidates.length);

  for (const app of capped) {
    try {
      const result = await generateCoverLetter(app.id, {
        locale: opts.locale,
        model: opts.model,
        temperature: opts.temperature,
      });
      results.push({
        applicationId: app.id,
        vacancyId: app.vacancy_id,
        resumeTemplateId: app.resume_template_id,
        success: true,
        bodyLength: result.body_md.length,
      });
    } catch (err) {
      // Continue-on-error: фиксируем и идём дальше. Брошенные generateCoverLetter
      // ошибки — провайдер (429/сеть) или невалидный ответ. Не найденный application
      // сюда не попадёт (он только что прочитан из list).
      errors.push({
        applicationId: app.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    candidates: capped.length,
    generated: results.filter((r) => r.success).length,
    skipped,
    errors,
    results,
  };
}
