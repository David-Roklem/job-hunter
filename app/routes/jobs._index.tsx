import { data, redirect } from "react-router";
import { Link } from "react-router";
import { jobsRepo } from "~/db/repositories";
import type { JobKind, JobStatus } from "~/db/schema";
import type { Route } from "./+types/jobs._index";

/**
 * Инбокс очереди планировщика — `/jobs` (фаза 12 scheduler).
 *
 * Loader: список задач (свежие сверху) + счётчики по статусам.
 * Action: intent = pause | resume | retry | cancel → jobsRepo методы.
 *
 * Просмотр + ручное управление (как resumes/applications фаз 03/10).
 * Шаги цепочки (collect→match→generate_draft) создаются энкьютом корневого
 * collect_vacancies вручную или внешним cron; apply_hh — из approve-action.
 */

type JobRow = ReturnType<typeof jobsRepo.list>[number];

export type LoaderData = {
  jobs: JobRow[];
  counts: Record<JobStatus, number>;
};

export async function loader(_args: Route.LoaderArgs): Promise<LoaderData> {
  const [jobs, counts] = [jobsRepo.list({ limit: 200 }), jobsRepo.countByStatus()];
  return { jobs, counts };
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

  const job = jobsRepo.findById(id);
  if (!job) {
    throw data(`job ${id} не найден`, { status: 404 });
  }

  if (intent === "pause") {
    jobsRepo.pause(id);
    return redirect("/jobs");
  }
  if (intent === "resume") {
    jobsRepo.resume(id);
    return redirect("/jobs");
  }
  if (intent === "retry") {
    jobsRepo.retry(id);
    return redirect("/jobs");
  }
  if (intent === "cancel") {
    jobsRepo.cancel(id);
    return redirect("/jobs");
  }

  throw data(`неизвестный intent: ${intent}`, { status: 400 });
}

/** Человекочитаемый kind. */
function kindLabel(kind: JobKind): string {
  const map: Record<JobKind, string> = {
    collect_vacancies: "сбор вакансий",
    match: "матчинг",
    generate_draft: "генерация писем",
    apply_hh: "отклик hh",
  };
  return map[kind];
}

/** CSS-класс badge по статусу job. */
function statusBadgeClass(status: JobStatus): string {
  if (status === "done") return "badge badge--approved";
  if (status === "running") return "badge badge--draft";
  if (status === "failed") return "badge badge--danger";
  if (status === "cancelled") return "badge badge--muted";
  return "badge badge--draft"; // queued
}

function statusLabel(status: JobStatus): string {
  const map: Record<JobStatus, string> = {
    queued: "в очереди",
    running: "выполняется",
    done: "готово",
    failed: "ошибка",
    cancelled: "отменено",
  };
  return map[status];
}

/** Краткая выдержка из error/result для таблицы. */
function truncate(s: string | null, max = 80): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export function JobsList({ loaderData }: { loaderData: LoaderData }) {
  const { jobs, counts } = loaderData;
  const active = counts.queued + counts.running + counts.failed;

  return (
    <main className="page">
      <header className="page__header">
        <h1>Очередь задач</h1>
        <Link to="/" className="btn">
          ← На главную
        </Link>
      </header>

      <p className="page__hint">
        В очереди: <strong>{active}</strong> активных (queued: {counts.queued},
        running: {counts.running}, failed: {counts.failed}). Выполнено:{" "}
        {counts.done}. Отменено: {counts.cancelled}.
      </p>

      {jobs.length === 0 ? (
        <p className="page__empty">
          Очередь пуста. Цикл <code>collect → match → generate_draft</code>{" "}
          запускается энкьютом корневого <code>collect_vacancies</code>{" "}
          (внешний cron или вручную). <code>apply_hh</code> создаётся{" "}
          <Link to="/applications">одобрением отклика</Link>.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Тип</th>
              <th>Статус</th>
              <th>Попытки</th>
              <th>Запуск после</th>
              <th>Результат / ошибка</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.id}</td>
                <td>{kindLabel(job.kind)}</td>
                <td>
                  <span className={statusBadgeClass(job.status)}>
                    {statusLabel(job.status)}
                  </span>
                </td>
                <td>
                  {job.attempts}/{job.max_attempts}
                </td>
                <td>{new Date(job.run_after).toLocaleString()}</td>
                <td className="table__mono">
                  {truncate(job.error) || truncate(job.result_json)}
                </td>
                <td className="table__actions">
                  {(job.status === "running" || job.status === "queued") && (
                    <form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={job.id} />
                      <button
                        type="submit"
                        name="intent"
                        value="pause"
                        className="btn"
                      >
                        пауза
                      </button>
                    </form>
                  )}
                  {(job.status === "failed" || job.status === "cancelled") && (
                    <form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={job.id} />
                      <button
                        type="submit"
                        name="intent"
                        value="retry"
                        className="btn btn--primary"
                      >
                        retry
                      </button>
                    </form>
                  )}
                  {job.status === "cancelled" && (
                    <form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={job.id} />
                      <button
                        type="submit"
                        name="intent"
                        value="resume"
                        className="btn"
                      >
                        resume
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default function Jobs({ loaderData }: Route.ComponentProps) {
  return <JobsList loaderData={loaderData as LoaderData} />;
}
