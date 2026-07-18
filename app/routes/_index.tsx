import { data, redirect } from "react-router";
import { Link } from "react-router";
import { jobsRepo, schedulerRunsRepo } from "~/db/repositories";
import type { RunStats } from "~/db/repositories/scheduler_runs";
import type { Route } from "./+types/_index";

/**
 * Дашборд. Корневой маршрут `/`.
 *
 * Loader возвращает статус, версию, счётчики очереди и последний завершённый
 * цикл планировщика (для показа итогов под кнопкой «Собрать»).
 * Action: intent=collect_now → энкьют collect_vacancies (запускает цепочку
 * collect → match → generate_draft через очередь jobs фазы 12).
 */
export type IndexLoaderData = {
  status: "ok";
  version: string;
  counts: { queued: number; running: number; failed: number };
  lastRun: {
    id: number;
    finished_at: string;
    stats: Partial<RunStats>;
    last_error: string | null;
  } | null;
};

export async function loader(_args: Route.LoaderArgs): Promise<IndexLoaderData> {
  const counts = jobsRepo.countByStatus();
  const lastRun = schedulerRunsRepo.lastFinished();
  return {
    status: "ok",
    version: "0.1.0",
    counts: {
      queued: counts.queued,
      running: counts.running,
      failed: counts.failed,
    },
    lastRun: lastRun
      ? {
          id: lastRun.id,
          finished_at: lastRun.finished_at
            ? lastRun.finished_at.toISOString()
            : new Date().toISOString(),
          stats: lastRun.stats_json
            ? (JSON.parse(lastRun.stats_json) as Partial<RunStats>)
            : {},
          last_error: lastRun.last_error,
        }
      : null,
  };
}

export type ActionData = { ok: true; jobId: number } | { error: string };

export async function action(
  args: Route.ActionArgs,
): Promise<ActionData | Response> {
  const formData = await args.request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "collect_now") {
    // Энкьютить корневой collect_vacancies — воркер (если запущен) прогонит
    // цепочку collect → match → generate_draft. Пользователь видит прогресс
    // на /jobs и в scheduler_runs.
    jobsRepo.enqueue("collect_vacancies", {});
    return redirect("/jobs");
  }

  throw data(`неизвестный intent: ${intent}`, { status: 400 });
}

const SECTIONS = [
  {
    key: "resumes",
    title: "Резюме",
    hint: "Шаблоны под разные роли и направления",
    href: "/resumes",
  },
  {
    key: "responses",
    title: "Отклики",
    hint: "Черновики откликов на подтверждение",
    href: "/applications",
  },
  {
    key: "jobs",
    title: "Очередь",
    hint: "Фоновые задачи планировщика: сбор, матчинг, генерация, отклики",
    href: "/jobs",
  },
  {
    key: "sources",
    title: "Источники",
    hint: "Подключённые источники вакансий и состояние сессий",
    href: "/sources",
  },
  {
    key: "settings",
    title: "Настройки",
    hint: "Ключи API, лимиты hh, путь к БД — без редактирования .env",
    href: "/settings",
  },
] as const;

/**
 * Чистый UI-компонент, не зависит от typegen'а React Router.
 * Default export ниже — обёртка, чтобы маршрут соответствовал конвенции RR7.
 */
export function Dashboard({ loaderData }: { loaderData: IndexLoaderData }) {
  const { status, version, counts, lastRun } = loaderData;
  return (
    <main className="dashboard">
      <header className="dashboard__header">
        <div className="dashboard__title">
          <h1>job_hunter</h1>
          <p>
            <span className="dashboard__status">статус: {status}</span>
          </p>
        </div>
        {/* action="/?index" обязательно: RR7 в flatRoutes по умолчанию
            резолвит POST "/" к родительскому layout (root), а не к index-маршруту.
            "?index" явно указывает на routes/_index. Без него — 405. */}
        <form method="post" action="/?index" className="dashboard__collect">
          <button type="submit" name="intent" value="collect_now" className="btn btn--primary">
            ↻ Собрать вакансии
          </button>
        </form>
      </header>

      <section className="dashboard__run">
        {lastRun ? (
          <p className="dashboard__run-stats">
            Последний цикл #{lastRun.id} ({" "}
            {new Date(lastRun.finished_at).toLocaleString("ru-RU")} ): собрано{" "}
            <strong>{lastRun.stats.collected ?? 0}</strong>, матчей{" "}
            <strong>{lastRun.stats.matched_pairs ?? 0}</strong>, писем{" "}
            <strong>{lastRun.stats.drafted ?? 0}</strong>.
            {counts.queued + counts.running > 0 && (
              <>
                {" "}
                В очереди: <Link to="/jobs">{counts.queued + counts.running} задач</Link>
                {counts.failed > 0 && <span className="badge badge--danger"> ⚠ {counts.failed} ошибок</span>}
              </>
            )}
          </p>
        ) : (
          <p className="dashboard__run-stats">
            Циклов ещё не было. Нажмите «↻ Собрать вакансии» — запустится цепочка
            collect → match → generate_draft (нужен запущенный{" "}
            <Link to="/jobs">воркер</Link>).
          </p>
        )}
      </section>

      <ul className="dashboard__sections">
        {SECTIONS.map((section) => (
          <li key={section.key} className="dashboard__section">
            <Link to={section.href}>
              <h2>{section.title}</h2>
              <p>{section.hint}</p>
            </Link>
          </li>
        ))}
      </ul>

      <footer className="dashboard__footer">v{version}</footer>
    </main>
  );
}

export default function Index({ loaderData }: Route.ComponentProps) {
  return <Dashboard loaderData={loaderData as IndexLoaderData} />;
}
