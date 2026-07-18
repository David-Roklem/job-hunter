import { data, redirect } from "react-router";
import { Link } from "react-router";
import { resumeTemplatesRepo } from "~/db/repositories";
import { parseResumeForm } from "~/resumes/parseForm";
import {
  ResumeForm,
  valuesFromTemplate,
  type ResumeFormErrors,
  type ResumeFormValues,
} from "~/resumes/ResumeForm";
import type { Route } from "./+types/resumes.\$id.edit";

/**
 * Редактирование шаблона резюме — `/resumes/:id/edit`.
 *
 * loader: findById → 404 (data с throw) если нет.
 * action: ветвление по intent:
 *   - intent=delete → remove + redirect на список
 *   - иначе → parseResumeForm → update. При ошибках возвращает values + errors.
 */
const NOT_FOUND = (id: number) =>
  data(`Шаблон резюме ${id} не найден`, { status: 404 });

export async function loader(args: Route.LoaderArgs) {
  const id = Number(args.params.id);
  if (!Number.isFinite(id)) throw NOT_FOUND(id);
  const template = resumeTemplatesRepo.findById(id);
  if (!template) throw NOT_FOUND(id);
  return { template };
}

export type ActionData = {
  values: ResumeFormValues;
  errors?: ResumeFormErrors;
};

export async function action(args: Route.ActionArgs): Promise<ActionData | Response> {
  const id = Number(args.params.id);
  if (!Number.isFinite(id)) throw NOT_FOUND(id);

  const formData = await args.request.clone().formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    resumeTemplatesRepo.remove(id);
    return redirect("/resumes");
  }

  const parsed = await parseResumeForm(args.request);
  if (!parsed.ok) {
    // values восстанавливаются из полей (content_md мог быть перезаписан файлом
    // в parseResumeForm — берём сырое поле, чтобы пользователь видел свой ввод).
    const values: ResumeFormValues = {
      name: String(formData.get("name") ?? ""),
      role: String(formData.get("role") ?? ""),
      summary: String(formData.get("summary") ?? ""),
      skills: String(formData.get("skills") ?? ""),
      experience: String(formData.get("experience_json") ?? ""),
      content_md: String(formData.get("content_md") ?? ""),
    };
    return { values, errors: parsed.errors };
  }

  resumeTemplatesRepo.update(id, parsed.input);
  return redirect("/resumes");
}

export default function Edit({ loaderData, actionData }: Route.ComponentProps) {
  const template = loaderData.template;
  const values = actionData?.values ?? valuesFromTemplate(template);
  return (
    <main className="page">
      <header className="page__header">
        <h1>Редактировать: {template.name}</h1>
        <Link to="/resumes" className="btn">
          ← К списку
        </Link>
      </header>
      <ResumeForm
        action={`/resumes/${template.id}/edit`}
        values={values}
        errors={actionData?.errors}
        isEdit
      />
    </main>
  );
}
