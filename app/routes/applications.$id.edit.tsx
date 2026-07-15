import { data, redirect } from "react-router";
import { Link } from "react-router";
import { applicationsRepo, coverLettersRepo } from "~/db/repositories";
import type { Route } from "./+types/applications.\$id.edit";

/**
 * Редактирование письма отклика — `/applications/:id/edit` (фаза 10 review-ui).
 *
 * loader: findById → 404 если application или cover_letter нет.
 * action: intent = save (updateBody письма, с валидацией) | approve (status).
 *
 * Сохранение через coverLettersRepo.updateBody (ставит edited_at — отличает
 * ручную правку от AI-генерации, важно для аудита). Регенерация AI — в инбоксе.
 */

const NOT_FOUND = (id: number) =>
  data(`Отклик ${id} не найден или у него нет письма`, { status: 404 });

export async function loader(args: Route.LoaderArgs) {
  const id = Number(args.params.id);
  if (!Number.isFinite(id)) throw NOT_FOUND(id);
  const app = await applicationsRepo.findById(id);
  if (!app || !app.cover_letter) throw NOT_FOUND(id);
  return { app };
}

export type ActionData = {
  values: { body_md: string };
  errors?: { body_md?: string };
};

export async function action(
  args: Route.ActionArgs,
): Promise<ActionData | Response> {
  const id = Number(args.params.id);
  if (!Number.isFinite(id)) throw NOT_FOUND(id);

  const formData = await args.request.formData();
  const intent = String(formData.get("intent") ?? "");

  const app = await applicationsRepo.findById(id);
  if (!app || !app.cover_letter) throw NOT_FOUND(id);

  if (intent === "approve") {
    applicationsRepo.update(id, { status: "approved" });
    return redirect("/applications");
  }

  // intent = save
  const body_md = String(formData.get("body_md") ?? "").trim();
  if (body_md.length === 0) {
    return {
      values: { body_md },
      errors: { body_md: "Письмо не может быть пустым" },
    };
  }

  coverLettersRepo.updateBody(app.cover_letter.id, body_md);
  return redirect("/applications");
}

export default function Edit({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { app } = loaderData;
  const vacancy = app.vacancy;
  const resume = app.resume_template;
  // actionData есть только после неудачного save — показываем введённое значение.
  const bodyValue = actionData?.values.body_md ?? app.cover_letter!.body_md;
  const companyName = vacancy.company?.name;

  return (
    <main className="page">
      <header className="page__header">
        <h1>Редактирование письма</h1>
        <Link to="/applications" className="btn">
          ← К списку
        </Link>
      </header>

      <div className="card">
        <div className="card__title">{vacancy.title}</div>
        <div className="card__role">
          {companyName ? `${companyName} · ` : ""}
          {resume.role}
          {app.match_score !== null && (
            <span className="badge badge--muted">скор {app.match_score}</span>
          )}
        </div>
      </div>

      <form method="post" className="form">
        {actionData?.errors?.body_md && (
          <p className="form__error form__error--block">{actionData.errors.body_md}</p>
        )}
        <div className="form__field">
          <label className="form__label" htmlFor="body_md">
            Сопроводительное письмо
          </label>
          <textarea
            id="body_md"
            name="body_md"
            rows={20}
            defaultValue={bodyValue}
          />
        </div>
        <div className="form__actions">
          <button type="submit" name="intent" value="save" className="btn btn--primary">
            Сохранить
          </button>
          <button type="submit" name="intent" value="approve" className="btn">
            ✓ Сохранить и одобрить
          </button>
          <Link to="/applications" className="btn">
            Отмена
          </Link>
        </div>
      </form>
    </main>
  );
}
