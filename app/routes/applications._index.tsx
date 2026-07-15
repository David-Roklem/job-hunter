import { data, redirect } from "react-router";
import { Link } from "react-router";
import { applicationsRepo } from "~/db/repositories";
import { generateCoverLetter } from "~/ai/generateCoverLetter";
import type { ApplicationStatus } from "~/db/schema";
import type { Route } from "./+types/applications._index";

/**
 * Инбокс откликов — `/applications` (фаза 10 review-ui).
 *
 * Показывает applications, у которых есть сгенерированное cover_letter (от
 * draft-generator фазы 09). Действия: одобрить / отклонить / регенерировать
 * письмо. Редактирование — на отдельной странице /applications/:id/edit.
 *
 * loader: listWithLetter (relations + фильтр «есть письмо»).
 * action: intent = approve | reject | regenerate.
 */

type ApplicationRow = Awaited<ReturnType<typeof applicationsRepo.listWithLetter>>[number];

export type LoaderData = {
  applications: ApplicationRow[];
};

export async function loader(_args: Route.LoaderArgs): Promise<LoaderData> {
  const applications = await applicationsRepo.listWithLetter();
  return { applications };
}

export type ActionData = { ok: true } | { error: string };

export async function action(
  args: Route.ActionArgs,
): Promise<ActionData | Response> {
  const formData = await args.request.formData();
  const intent = String(formData.get("intent") ?? "");
  const id = Number(formData.get("id"));

  if (!Number.isFinite(id)) {
    throw data("неверный id", { status: 400 });
  }

  const app = await applicationsRepo.findById(id);
  if (!app) {
    throw data(`application ${id} не найден`, { status: 404 });
  }

  if (intent === "approve" || intent === "reject") {
    const status: ApplicationStatus = intent === "approve" ? "approved" : "rejected";
    applicationsRepo.update(id, { status });
    return redirect("/applications");
  }

  if (intent === "regenerate") {
    // generateCoverLetter (фаза 04) — upsert: перезаписывает body_md, сбрасывает
    // edited_at (контент пересгенерирован — корректно). Бросает при сбое AI.
    try {
      await generateCoverLetter(id);
      return redirect("/applications");
    } catch (err) {
      throw data(
        err instanceof Error ? err.message : "ошибка регенерации",
        { status: 500 },
      );
    }
  }

  throw data(`неизвестный intent: ${intent}`, { status: 400 });
}

/** CSS-класс badge по статусу application. */
function statusBadgeClass(status: ApplicationStatus): string {
  if (status === "approved") return "badge badge--approved";
  if (status === "rejected") return "badge badge--rejected";
  return "badge badge--draft";
}

/** Человекочитаемый статус. */
function statusLabel(status: ApplicationStatus): string {
  const map: Record<ApplicationStatus, string> = {
    draft: "черновик",
    pending_review: "на ревью",
    approved: "одобрен",
    sent: "отправлен",
    failed: "ошибка",
    rejected: "отклонён",
  };
  return map[status];
}

/** Превью тела письма (первые ~200 символов, нормализуя пробелы). */
function preview(body: string, max = 200): string {
  const one = body.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/** Карточка одного отклика с действиями. */
function ApplicationCard({ app }: { app: ApplicationRow }) {
  const vacancy = app.vacancy;
  const resume = app.resume_template;
  const letter = app.cover_letter;
  const companyName = vacancy.company?.name;

  return (
    <li className="card">
      <div className="card__title">
        <Link to={`/applications/${app.id}/edit`} className="card__link">
          {vacancy.title}
        </Link>
        <span className={statusBadgeClass(app.status)}>{statusLabel(app.status)}</span>
      </div>
      <div className="card__role">
        {companyName ? `${companyName} · ` : ""}
        {resume.role}
        {app.match_score !== null && (
          <span className="badge badge--muted">скор {app.match_score}</span>
        )}
      </div>
      {letter && <p className="card__summary">{preview(letter.body_md)}</p>}
      {letter && (
        <p className="card__meta">
          письмо от{" "}
          {new Date(letter.generated_at).toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
          {letter.edited_at && " (ред.)"}
        </p>
      )}
      <form method="post" action="/applications" className="card__actions">
        <input type="hidden" name="id" value={app.id} />
        <button type="submit" name="intent" value="approve" className="btn btn--primary">
          ✓ Одобрить
        </button>
        <button type="submit" name="intent" value="reject" className="btn btn--danger">
          ✕ Отклонить
        </button>
        <button type="submit" name="intent" value="regenerate" className="btn">
          ↻ Регенерировать
        </button>
        <Link to={`/applications/${app.id}/edit`} className="btn">
          Редактировать
        </Link>
      </form>
    </li>
  );
}

export function ApplicationsList({ loaderData }: { loaderData: LoaderData }) {
  const { applications } = loaderData;
  return (
    <main className="page">
      <header className="page__header">
        <h1>Отклики</h1>
        <Link to="/" className="btn">
          ← На главную
        </Link>
      </header>

      {applications.length === 0 ? (
        <p className="page__empty">
          Нет подготовленных откликов. Сгенерируйте письма:{" "}
          <code>npm run generate-drafts -- --all</code>
        </p>
      ) : (
        <ul className="cards">
          {applications.map((app) => (
            <ApplicationCard key={app.id} app={app} />
          ))}
        </ul>
      )}
    </main>
  );
}

export default function Index({ loaderData }: Route.ComponentProps) {
  return <ApplicationsList loaderData={loaderData as LoaderData} />;
}
