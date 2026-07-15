import { Link } from "react-router";
import type { Route } from "./+types/_index";

/**
 * Дашборд. Корневой маршрут `/`.
 *
 * Loader возвращает `{ status: "ok", version }` — контракт, который проверяет
 * smoke-тест и который убеждает, что связка loader↔рендер жива.
 */
export type IndexLoaderData = { status: "ok"; version: string };

export async function loader(_args: Route.LoaderArgs): Promise<IndexLoaderData> {
  return { status: "ok", version: "0.1.0" };
}

const SECTIONS = [
  {
    key: "vacancies",
    title: "Вакансии",
    hint: "Собранные вакансии из hh.ru, сайтов компаний и Telegram-каналов",
  },
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
    key: "sources",
    title: "Источники",
    hint: "Подключённые источники вакансий и состояние сбора",
  },
] as const;

/**
 * Чистый UI-компонент, не зависит от typegen'а React Router.
 * Default export ниже — обёртка, чтобы маршрут соответствовал конвенции RR7.
 */
export function Dashboard({ loaderData }: { loaderData: IndexLoaderData }) {
  const { status, version } = loaderData;
  return (
    <main className="dashboard">
      <header>
        <h1>job_hunter</h1>
        <p>
          <span className="dashboard__status">статус: {status}</span>
        </p>
      </header>

      <ul className="dashboard__sections">
        {SECTIONS.map((section) => {
          const inner = (
            <>
              <h2>{section.title}</h2>
              <p>{section.hint}</p>
            </>
          );
          return (
            <li key={section.key} className="dashboard__section">
              {"href" in section && section.href ? (
                <Link to={section.href}>{inner}</Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>

      <footer className="dashboard__footer">v{version}</footer>
    </main>
  );
}

export default function Index({ loaderData }: Route.ComponentProps) {
  return <Dashboard loaderData={loaderData as IndexLoaderData} />;
}
