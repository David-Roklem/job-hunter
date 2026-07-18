import { data, redirect } from "react-router";
import { Link } from "react-router";
import { sourcesRepo, jobsRepo } from "~/db/repositories";
import type { SourceDTO } from "~/db/repositories/sources";
import { seedByKind } from "~/sources/seed";
import {
  sessionStatusByKind,
  type SessionStatus,
} from "~/sources/sessionStatus";
import {
  startManaged,
  statusManaged,
  type ProcessStatus,
} from "~/processes/manager";
import type { SourceKind } from "~/db/schema";
import type { Route } from "./+types/sources._index";

/**
 * Страница источников — `/sources` (фаза ui-control).
 *
 * Показывает все источники с реальным статусом сессии. Действия:
 *  - seed: find-or-create дефолтного source+profile для kind (через app/sources/seed).
 *  - login: spawn headed-браузера (hh/wellfound) или telegram-login (spawn процесс).
 *    Логин НЕ исполняется в action — нужен GUI пользователя.
 *  - collect: энкейтит корневой collect_vacancies (цикл collect→match→draft).
 *
 * Per-source collect для telegram/wellfound сейчас не поддерживается
 * (runCollect берёт только hh-источники) — кнопка единая «собрать всё».
 */

/** Имя процесса login по kind. */
function loginProcName(kind: SourceKind): string {
  return `${kind}-login`;
}

/** npm-команда login по kind (для spawn). */
function loginNpmScript(kind: SourceKind): string | null {
  switch (kind) {
    case "hh":
      return "hh:login";
    case "aggregator":
      return "wellfound:login";
    case "telegram":
      return "telegram:login";
    case "company":
      return null; // нет логина — прямой scrape
  }
}

type SourceRow = SourceDTO & { session: SessionStatus; loginProc: ProcessStatus };

export type LoaderData = {
  sources: SourceRow[];
  /** Доступные kinds для кнопки seed (если источников такого kind ещё нет). */
  seedableKinds: { kind: SourceKind; label: string; seeded: boolean }[];
};

export async function loader(_args: Route.LoaderArgs): Promise<LoaderData> {
  const rows = sourcesRepo.list();
  const sources: SourceRow[] = rows.map((s) => ({
    ...s,
    session: sessionStatusByKind(s.kind),
    loginProc: statusManaged(loginProcName(s.kind)),
  }));

  // Какие kinds доступны для seed (hh / wellfound / telegram).
  const allKinds: { kind: SourceKind; label: string }[] = [
    { kind: "hh", label: "hh.ru" },
    { kind: "aggregator", label: "Wellfound" },
    { kind: "telegram", label: "Telegram" },
  ];
  const existingKinds = new Set(rows.map((s) => s.kind));
  const seedableKinds = allKinds.map((k) => ({
    ...k,
    seeded: existingKinds.has(k.kind),
  }));

  return { sources, seedableKinds };
}

export type ActionData = { ok: true } | { error: string };

export async function action(
  args: Route.ActionArgs,
): Promise<ActionData | Response> {
  const formData = await args.request.formData();
  const intent = String(formData.get("intent") ?? "");

  // --- seed: создать дефолтный source+profile по kind --------------------
  if (intent === "seed") {
    const kind = String(formData.get("kind") ?? "") as SourceKind;
    try {
      seedByKind(kind);
      return redirect("/sources");
    } catch (err) {
      throw data(
        err instanceof Error ? err.message : "seed failed",
        { status: 500 },
      );
    }
  }

  // --- login: spawn процесса headed-браузера / telegram-login ------------
  if (intent === "login") {
    const kind = String(formData.get("kind") ?? "") as SourceKind;
    const script = loginNpmScript(kind);
    if (!script) {
      throw data(`login для kind=${kind} не поддерживается`, { status: 400 });
    }
    const procName = loginProcName(kind);
    const res = startManaged(procName, "npm", ["run", script]);
    if (!res.ok) {
      throw data(res.error, { status: 409 });
    }
    return redirect("/sources");
  }

  // --- collect: энкьютить корневой collect_vacancies ---------------------
  if (intent === "collect") {
    jobsRepo.enqueue("collect_vacancies", {});
    return redirect("/jobs");
  }

  throw data(`неизвестный intent: ${intent}`, { status: 400 });
}

/** Иконка статуса сессии. */
function sessionBadge(session: SessionStatus): { label: string; cls: string } {
  if (session.loggedIn) return { label: "✓ залогинен", cls: "badge badge--approved" };
  return { label: "✗ не залогинен", cls: "badge badge--danger" };
}

/** Человекочитаемый kind. */
function kindLabel(kind: SourceKind): string {
  const map: Record<SourceKind, string> = {
    hh: "hh.ru",
    company: "сайт компании",
    telegram: "telegram",
    aggregator: "агрегатор",
  };
  return map[kind];
}

/** Карточка одного источника. */
function SourceCard({ source }: { source: SourceRow }) {
  const badge = sessionBadge(source.session);
  const script = loginNpmScript(source.kind);
  const canLogin = script !== null;

  return (
    <li className="card">
      <div className="card__title">
        <span className="card__link">{source.name}</span>
        <span className="badge badge--muted">{kindLabel(source.kind)}</span>
        <span className={badge.cls}>{badge.label}</span>
      </div>
      <div className="card__role">
        id={source.id} · {source.session.hint}
        {source.session.lastSeen && (
          <span className="page__hint">
            {" "}· сессия: {source.session.lastSeen.toLocaleString("ru-RU")}
          </span>
        )}
      </div>
      {source.loginProc.running && (
        <p className="card__meta">
          <span className="badge badge--draft">
            ⟳ login выполняется (pid={source.loginProc.pid})
          </span>{" "}
          см. <code>data/logs/{source.kind}-login.log</code>
          {source.kind === "telegram" && (
            <span className="page__hint">
              {" "}— для ввода кода откройте терминал с логом.
            </span>
          )}
        </p>
      )}
      <form method="post" action="/sources" className="card__actions">
        <input type="hidden" name="kind" value={source.kind} />
        {canLogin && (
          <button
            type="submit"
            name="intent"
            value="login"
            className="btn"
            disabled={source.loginProc.running}
          >
            {source.loginProc.running ? "⟳ логинится…" : "↳ Войти"}
          </button>
        )}
        <button type="submit" name="intent" value="collect" className="btn btn--primary">
          ↻ Собрать
        </button>
      </form>
    </li>
  );
}

export function SourcesList({ loaderData }: { loaderData: LoaderData }) {
  const { sources, seedableKinds } = loaderData;

  return (
    <main className="page">
      <header className="page__header">
        <h1>Источники</h1>
        <Link to="/" className="btn">
          ← На главную
        </Link>
      </header>

      <p className="page__hint">
        Подключённые источники вакансий и состояние их сессий. Логины открывают
        браузер на вашей машине (spawn процесса) — для hh/wellfound это окно с
        капчей/2FA, для telegram нужно вводить код в логе.
      </p>

      {/* Кнопки seed для отсутствующих kinds */}
      <section className="seed-actions">
        <h2>Добавить источник</h2>
        <div className="seed-actions__buttons">
          {seedableKinds.map((k) =>
            k.seeded ? (
              <span key={k.kind} className="badge badge--muted">
                {k.label} уже добавлен
              </span>
            ) : (
              <form key={k.kind} method="post" action="/sources" style={{ display: "inline" }}>
                <input type="hidden" name="intent" value="seed" />
                <input type="hidden" name="kind" value={k.kind} />
                <button type="submit" className="btn">
                  + {k.label}
                </button>
              </form>
            ),
          )}
        </div>
      </section>

      {sources.length === 0 ? (
        <p className="page__empty">
          Источников нет. Добавьте hh.ru / Wellfound / Telegram кнопками выше
          (создаётся source + дефолтный search_profile).
        </p>
      ) : (
        <ul className="cards">
          {sources.map((s) => (
            <SourceCard key={s.id} source={s} />
          ))}
        </ul>
      )}
    </main>
  );
}

export default function Sources({ loaderData }: Route.ComponentProps) {
  return <SourcesList loaderData={loaderData as LoaderData} />;
}
