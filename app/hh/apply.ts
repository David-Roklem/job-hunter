/**
 * Авто-отклик на hh.ru — фаза 11 apply-hh.
 *
 * Оркестратор submitApplication(applicationId): открывает форму отклика по
 * каноничному URL, выбирает резюме (маппинг resume_template_id → hh resume_id),
 * подставляет сопроводительное письмо (cover_letters.body_md), submit.
 * При успехе application.status → 'sent' + submitted_at, при ошибке → 'failed'.
 *
 * Поток (по разведке 2026-07-16, data/dumps/hh-apply-form.html):
 *   1. GET /applicant/vacancy_response?vacancyId=X → форма отклика
 *   2. Выбор резюме: клик div[role=button] (dropdown) → выбор пункта по имени
 *      резюме (resume_templates.name). hh НЕ даёт dropdown data-qa.
 *   3. Письмо: клик [data-qa=vacancy-response-letter-toggle] → ждём textarea →
 *      заполнение cover_letters.body_md.
 *   4. Submit: [data-qa=vacancy-response-submit-popup].
 *
 * Анти-лимиты: humanDelay перед submit (поведенческая имитация из human.ts),
 * детект капчи/403 — как в collect.ts.
 *
 * Headless (сессия + fingerprint — из hh/session.ts дефолты).
 */
import type { Page } from "playwright";
import { applicationsRepo, coverLettersRepo, hhResumeMappingRepo, vacanciesRepo, resumeTemplatesRepo } from "~/db/repositories";
import { buildApplyFormUrl, HH_SELECTORS, isCaptchaUrl } from "./selectors";
import { createContext } from "./session";
import { humanDelay, humanPretend } from "./human";

/** Ошибка капчи — graceful, не падать. */
export class HhApplyCaptchaError extends Error {
  constructor(message = "hh.ru показал капчу при отклике — повторите позже или снизьте частоту") {
    super(message);
    this.name = "HhApplyCaptchaError";
  }
}

export type SubmitApplicationOptions = {
  applicationId: number;
  /** Видимый браузер (debug). По умолчанию false (headless). */
  headed?: boolean;
  /** Принудительно откликнуться даже если status='sent' (повторный submit).
   * По умолчанию false — идемпотентно. */
  force?: boolean;
};

export type SubmitResult = {
  ok: boolean;
  /** При ok=false — человекочитаемая причина (для записи в лог/UI). */
  reason?: string;
  /** URL формы (для диагностики). */
  formUrl?: string;
};

/** Задержка перед submit (анти-лимит), мс. */
const SUBMIT_DELAY_MS: [number, number] = [2000, 5000];
/** Задержка после клика dropdown/toggle (ждать JS-рендер), мс. */
const RENDER_WAIT_MS = 1500;

/**
 * Подать отклик на hh.ru для application.
 *
 * @throws HhApplyCaptchaError если hh показал капчу (graceful — статус не 'failed').
 */
export async function submitApplication(
  opts: SubmitApplicationOptions,
): Promise<SubmitResult> {
  const application = await applicationsRepo.findById(opts.applicationId);
  if (!application) {
    return { ok: false, reason: `application ${opts.applicationId} не найдена` };
  }

  // Идемпотентность: повторный apply на sent — no-op (если не force).
  if (application.status === "sent" && !opts.force) {
    return {
      ok: false,
      reason: `application ${opts.applicationId} уже отправлена (status=sent)`,
    };
  }

  // Маппинг resume_template_id → hh resume_id.
  const mapping = hhResumeMappingRepo.findByTemplateId(
    application.resume_template_id,
  );
  if (!mapping) {
    markFailed(opts.applicationId, "нет маппинга resume_template_id → hh_resume_id");
    return {
      ok: false,
      reason: `нет маппинга для resume_template_id=${application.resume_template_id}. Запустите npm run hh:map-resumes.`,
    };
  }

  // Резюме-шаблон (нужен name для выбора в dropdown).
  const template = await resumeTemplatesRepo.findById(application.resume_template_id);
  if (!template) {
    markFailed(opts.applicationId, `resume_template ${application.resume_template_id} не найден`);
    return { ok: false, reason: `resume_template не найден` };
  }

  // Письмо (cover_letters.body_md).
  const letter = coverLettersRepo.findByApplicationId(application.id);

  // Вакансия (нужен external_id для URL).
  const vacancy = await vacanciesRepo.findById(application.vacancy_id);
  if (!vacancy) {
    markFailed(opts.applicationId, `vacancy ${application.vacancy_id} не найдена`);
    return { ok: false, reason: `vacancy не найдена` };
  }

  const formUrl = buildApplyFormUrl(vacancy.external_id);

  const context = await createContext({ headed: opts.headed });
  try {
    const page = await context.newPage();
    await humanPretend(page);

    // 1. Открыть форму отклика.
    const response = await page.goto(formUrl, { waitUntil: "domcontentloaded" });
    if (isCaptchaUrl(page.url()) || response?.status() === 403) {
      throw new HhApplyCaptchaError();
    }
    // Подождать рендера формы (SPA).
    await page
      .waitForSelector(HH_SELECTORS.apply.submit, { timeout: 10_000 })
      .catch(() => {});
    await page.waitForTimeout(RENDER_WAIT_MS);

    // 2. Выбор резюме: dropdown → пункт по имени template.name.
    const selectOk = await selectResume(page, template.name);
    if (!selectOk) {
      // Не критично — hh может уже подставить верное резюме. Логируем, продолжаем.
      console.warn(
        `[apply] не удалось выбрать резюме "${template.name}" — используется текущее`,
      );
    }

    // 3. Письмо (если есть).
    if (letter) {
      await fillLetter(page, letter.body_md);
    }

    // 4. Submit (с анти-лимитом).
    await humanPretend(page);
    await humanDelay(...SUBMIT_DELAY_MS);
    await page.locator(HH_SELECTORS.apply.submit).first().click();

    // Дождаться результата: либо успех (редирект/сообщение), либо ошибка.
    await page.waitForTimeout(RENDER_WAIT_MS);
    if (isCaptchaUrl(page.url())) {
      throw new HhApplyCaptchaError();
    }

    // Успех: hh редиректит на /applicant/negotiations (Отклики) или показывает
    // подтверждение. Считаем успехом, если не упали и не капча.
    applicationsRepo.update(opts.applicationId, {
      status: "sent",
      submitted_at: new Date(),
    });
    return { ok: true, formUrl };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Выбрать резюме в dropdown формы по имени.
 * hh НЕ даёт dropdown data-qa → кликаем первый div[role=button] в форме,
 * затем ищем пункт списка с совпадающим текстом.
 *
 * Возвращает false если не получилось (не падает — можно идти с текущим резюме).
 */
async function selectResume(page: Page, resumeName: string): Promise<boolean> {
  const dropdown = page.locator(HH_SELECTORS.apply.resumeDropdown).first();
  if ((await dropdown.count()) === 0) return false;
  await dropdown.click();
  await page.waitForTimeout(RENDER_WAIT_MS);

  // Список резюме: пункты с role=option или кликабельные элементы с текстом.
  // Ищем пункт, чей текст содержит имя резюме.
  const option = page
    .locator('[role="option"], [role="menuitem"], li, [role="button"]')
    .filter({ hasText: resumeName })
    .first();
  if ((await option.count()) === 0) return false;
  await option.click();
  await page.waitForTimeout(RENDER_WAIT_MS);
  return true;
}

/**
 * Заполнить поле письма: клик toggle → ждать textarea → ввести текст.
 * Toggle рендерит textarea через JS, поэтому waitForSelector обязателен.
 */
async function fillLetter(page: Page, bodyMd: string): Promise<void> {
  const toggle = page.locator(HH_SELECTORS.apply.letterToggle).first();
  if ((await toggle.count()) === 0) return;
  await toggle.click();
  const textarea = page.locator(HH_SELECTORS.apply.letterTextarea).first();
  await textarea.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  if ((await textarea.count()) === 0) return;
  await textarea.fill(bodyMd);
}

/** Пометить application как failed с причиной (в reason не лезем — отдельное поле
 * нет, пишем в консоль; статус=fail достаточен для UI/повтора). */
function markFailed(applicationId: number, reason: string): void {
  console.error(`[apply] application ${applicationId} → failed: ${reason}`);
  applicationsRepo.update(applicationId, { status: "failed" });
}
