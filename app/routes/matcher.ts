/**
 * Resource route для матчинга (фаза 08) — `/matcher`.
 *
 * Только action (без loader/UI): запуск скоринга из будущего review-ui (фаза 10)
 * или из CLI по HTTP. Возвращает JSON-результат.
 *
 * Форматы запроса:
 *   { intent: "one", vacancyId, resumeId?, threshold? }   — одна пара
 *   { intent: "one", vacancyId }                           — вакансия × все активные шаблоны
 *   { intent: "all", threshold?, max? }                    — батч по status='new'
 *
 * Поддерживает JSON-body и form-data (intent из поля).
 */
import { matchAll, matchVacancy } from "~/matcher/match";
import { resumeTemplatesRepo } from "~/db/repositories";
import type { Route } from "./+types/matcher";

export type MatcherActionData =
  | { kind: "one"; vacancyId: number; results: unknown[] }
  | { kind: "all"; stats: unknown };

export async function action(
  args: Route.ActionArgs,
): Promise<MatcherActionData | Response> {
  const { intent, vacancyId, resumeId, threshold, max } = await parseRequest(
    args.request,
  );

  if (intent === "all") {
    const stats = await matchAll({ threshold, max });
    return { kind: "all", stats };
  }

  if (intent === "one") {
    if (vacancyId === undefined) {
      return jsonError(400, "intent=one требует vacancyId");
    }
    const targets =
      resumeId !== undefined
        ? [resumeId]
        : resumeTemplatesRepo.list().filter((r) => r.is_active).map((r) => r.id);
    const results = [];
    for (const rid of targets) {
      results.push(await matchVacancy(vacancyId, rid, { threshold }));
    }
    return { kind: "one", vacancyId, results };
  }

  return jsonError(400, `неизвестный intent: ${JSON.stringify(intent)}`);
}

type ParsedRequest = {
  intent: "one" | "all";
  vacancyId?: number;
  resumeId?: number;
  threshold?: number;
  max?: number;
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

  const intent =
    raw.intent === "all" ? "all" : raw.intent === "one" ? "one" : "one";

  return {
    intent,
    vacancyId: numOrNull(raw.vacancyId) ?? undefined,
    resumeId: numOrNull(raw.resumeId) ?? undefined,
    threshold: numOrNull(raw.threshold) ?? undefined,
    max: numOrNull(raw.max) ?? undefined,
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
