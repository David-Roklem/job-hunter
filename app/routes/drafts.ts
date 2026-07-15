/**
 * Resource route для генерации черновиков писем (фаза 09) — `/drafts`.
 *
 * Только action (без loader/UI): запуск генерации из будущего review-ui
 * (фаза 10) или из CLI по HTTP. Возвращает JSON-результат.
 *
 * Форматы запроса (intent-паттерн, зеркало matcher):
 *   { intent: "one", applicationId }                       — одно письмо
 *   { intent: "all", threshold?, max?, locale? }           — батч по status='draft'
 *
 * Поддерживает JSON-body и form-data (intent из поля).
 */
import { generateDraftsAll, generateDraftsOne } from "~/ai/generateDrafts";
import { applicationsRepo } from "~/db/repositories";
import type { CoverLetterLocale } from "~/ai/prompts/coverLetter";
import type { Route } from "./+types/drafts";

export type DraftsActionData =
  | { kind: "one"; applicationId: number; result: unknown }
  | { kind: "all"; stats: unknown };

export async function action(
  args: Route.ActionArgs,
): Promise<DraftsActionData | Response> {
  const { intent, applicationId, threshold, max, locale } = await parseRequest(
    args.request,
  );

  if (intent === "all") {
    const stats = await generateDraftsAll({ minScore: threshold, max, locale });
    return { kind: "all", stats };
  }

  if (intent === "one") {
    if (applicationId === undefined) {
      return jsonError(400, "intent=one требует applicationId");
    }
    const app = await applicationsRepo.findById(applicationId);
    if (!app) {
      return jsonError(404, `application ${applicationId} не найден`);
    }
    try {
      const result = await generateDraftsOne(applicationId, { locale });
      return { kind: "one", applicationId, result };
    } catch (err) {
      return jsonError(
        500,
        err instanceof Error ? err.message : "ошибка генерации",
      );
    }
  }

  return jsonError(400, `неизвестный intent: ${JSON.stringify(intent)}`);
}

type ParsedRequest = {
  intent: "one" | "all";
  applicationId?: number;
  threshold?: number;
  max?: number;
  locale?: CoverLetterLocale;
};

async function parseRequest(req: Request): Promise<ParsedRequest> {
  const contentType = req.headers.get("content-type") ?? "";
  let raw: Record<string, unknown>;

  if (contentType.includes("application/json")) {
    raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  } else {
    const fd = await req.formData().catch(() => null);
    raw = fd ? Object.fromEntries(fd.entries()) : {};
  }

  const intent = raw.intent === "all" ? "all" : "one";

  const localeRaw = raw.locale;
  const locale: CoverLetterLocale | undefined =
    localeRaw === "en" ? "en" : localeRaw === "ru" ? "ru" : undefined;

  return {
    intent,
    applicationId: numOrNull(raw.applicationId) ?? undefined,
    threshold: numOrNull(raw.threshold) ?? undefined,
    max: numOrNull(raw.max) ?? undefined,
    locale,
  };
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return v !== "" && Number.isFinite(n) ? n : null;
  }
  return null;
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
