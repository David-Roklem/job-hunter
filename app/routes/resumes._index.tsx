import { Link } from "react-router";
import { resumeTemplatesRepo } from "~/db/repositories";
import type { Route } from "./+types/resumes._index";

/**
 * Список шаблонов резюме — `/resumes`.
 *
 * Loader возвращает все шаблоны (сортировка updated_at desc в репозитории).
 * Карточка кликабельна → редактирование. Кнопка «Создать» → /resumes/new.
 */
export type LoaderData = {
  templates: Awaited<ReturnType<typeof resumeTemplatesRepo.list>>;
};

export async function loader(_args: Route.LoaderArgs): Promise<LoaderData> {
  const templates = resumeTemplatesRepo.list();
  return { templates };
}

export function ResumeList({ loaderData }: { loaderData: LoaderData }) {
  const { templates } = loaderData;
  return (
    <main className="page">
      <header className="page__header">
        <h1>Резюме</h1>
        <div className="page__header-actions">
          <Link to="/" className="btn">
            ← На главную
          </Link>
          <Link to="/resumes/new" className="btn btn--primary">
            + Создать
          </Link>
        </div>
      </header>

      {templates.length === 0 ? (
        <p className="page__empty">
          Шаблонов пока нет. Создайте первый — например, под основную роль.
        </p>
      ) : (
        <ul className="cards">
          {templates.map((t) => (
            <li key={t.id} className="card">
              <Link to={`/resumes/${t.id}/edit`} className="card__link">
                <div className="card__title">
                  {t.name}
                  {!t.is_active && <span className="badge badge--muted">скрыт</span>}
                </div>
                <div className="card__role">{t.role}</div>
                {t.summary && <p className="card__summary">{t.summary}</p>}
                {t.skills.length > 0 && (
                  <p className="card__skills">{t.skills.slice(0, 6).join(" · ")}</p>
                )}
                <p className="card__meta">
                  обновлён{" "}
                  {new Date(t.updated_at).toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function Index({ loaderData }: Route.ComponentProps) {
  return <ResumeList loaderData={loaderData as LoaderData} />;
}
