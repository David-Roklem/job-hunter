import { redirect } from "react-router";
import { Link } from "react-router";
import { resumeTemplatesRepo } from "~/db/repositories";
import { parseResumeForm } from "~/resumes/parseForm";
import {
  EMPTY_VALUES,
  ResumeForm,
  type ResumeFormErrors,
  type ResumeFormValues,
} from "~/resumes/ResumeForm";
import type { Route } from "./+types/resumes.new";

/**
 * Создание шаблона резюме — `/resumes/new`.
 *
 * action: парсит multipart-форму (вкл. загрузку .md/.pdf), валидирует и
 * создаёт шаблон. При ошибках возвращает values + errors для повторного
 * рендера формы. После успеха — редирект на список.
 */
export type ActionData = {
  values: ResumeFormValues;
  errors?: ResumeFormErrors;
};

export async function action(args: Route.ActionArgs): Promise<ActionData | Response> {
  const parsed = await parseResumeForm(args.request);
  if (!parsed.ok) {
    // values восстанавливаются из сырых полей — пере-рендер формы с ошибками.
    const fd = await args.request.formData().catch(() => null);
    const values: ResumeFormValues = {
      name: String(fd?.get("name") ?? ""),
      role: String(fd?.get("role") ?? ""),
      summary: String(fd?.get("summary") ?? ""),
      skills: String(fd?.get("skills") ?? ""),
      experience: String(fd?.get("experience_json") ?? ""),
      content_md: String(fd?.get("content_md") ?? ""),
    };
    return { values, errors: parsed.errors };
  }
  const created = resumeTemplatesRepo.create(parsed.input);
  return redirect(`/resumes/${created.id}/edit`);
}

export function ResumeNew() {
  return (
    <main className="page">
      <header className="page__header">
        <h1>Новое резюме</h1>
        <Link to="/resumes" className="btn">
          ← К списку
        </Link>
      </header>
      <ResumeForm action="/resumes/new" values={EMPTY_VALUES} />
    </main>
  );
}

// Пере-рендер с ошибками: actionData несёт values + errors.
export default function New({ actionData }: Route.ComponentProps) {
  if (!actionData || !("values" in actionData)) {
    return <ResumeNew />;
  }
  return (
    <main className="page">
      <header className="page__header">
        <h1>Новое резюме</h1>
        <Link to="/resumes" className="btn">
          ← К списку
        </Link>
      </header>
      <ResumeForm
        action="/resumes/new"
        values={actionData.values}
        errors={actionData.errors}
      />
    </main>
  );
}
