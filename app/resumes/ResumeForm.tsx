/**
 * Переиспользуемая форма шаблона резюме для создания и редактирования.
 *
 * Поля:
 *  - name, role, summary — простые текстовые
 *  - skills — через запятую (преобразуется в string[] в action)
 *  - experience — JSON-textarea (строгая форма объявлена в _shared.ts).
 *    Осознанное упрощение фазы 03: полноценный UI-редактор опыта отложен.
 *  - content_md — основное тело резюме (markdown)
 *  - файл .md/.pdf — если приложен, переопределяет content_md извлечённым текстом
 *
 * Ошибки валидации показываются под полями (errors[field]).
 * Удаление — отдельная intent-кнопка (только в режиме редактирования).
 */
import { useState } from "react";
import type { ResumeTemplateDTO } from "~/db/repositories/resume_templates";

export type ResumeFormErrors = Partial<
  Record<
    | "name"
    | "role"
    | "summary"
    | "skills"
    | "experience"
    | "content_md"
    | "file"
    | "_form",
    string
  >
>;

export type ResumeFormValues = {
  name: string;
  role: string;
  summary: string;
  skills: string; // comma-separated
  experience: string; // JSON string
  content_md: string;
};

export function valuesFromTemplate(t: ResumeTemplateDTO): ResumeFormValues {
  return {
    name: t.name,
    role: t.role,
    summary: t.summary,
    skills: t.skills.join(", "),
    experience: t.experience.length > 0 ? JSON.stringify(t.experience, null, 2) : "",
    content_md: t.content_md,
  };
}

export const EMPTY_VALUES: ResumeFormValues = {
  name: "",
  role: "",
  summary: "",
  skills: "",
  experience: "",
  content_md: "",
};

export function ResumeForm({
  action,
  values,
  errors,
  isEdit,
}: {
  action: string;
  values: ResumeFormValues;
  errors?: ResumeFormErrors;
  isEdit?: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <form method="post" action={action} encType="multipart/form-data" className="form">
      <label className="form__field">
        <span className="form__label">Название *</span>
        <input name="name" defaultValue={values.name} autoFocus />
        {errors?.name && <span className="form__error">{errors.name}</span>}
      </label>

      <label className="form__field">
        <span className="form__label">Роль *</span>
        <input name="role" defaultValue={values.role} placeholder="Напр. React Developer" />
        {errors?.role && <span className="form__error">{errors.role}</span>}
      </label>

      <label className="form__field">
        <span className="form__label">Краткое описание</span>
        <textarea
          name="summary"
          defaultValue={values.summary}
          rows={2}
          placeholder="Одно-два предложения о вас"
        />
        {errors?.summary && <span className="form__error">{errors.summary}</span>}
      </label>

      <label className="form__field">
        <span className="form__label">Навыки (через запятую)</span>
        <input
          name="skills"
          defaultValue={values.skills}
          placeholder="React, TypeScript, Node.js"
        />
        {errors?.skills && <span className="form__error">{errors.skills}</span>}
      </label>

      <label className="form__field">
        <span className="form__label">
          Опыт (JSON){" "}
          <span className="form__hint">
            массив вида <code>{'[{ "company", "role", "period": {"from","to"}, "description" }]'}</code>;
            to = null = «по настоящее»
          </span>
        </span>
        <textarea
          name="experience"
          defaultValue={values.experience}
          rows={4}
          placeholder='[{"company":"Acme","role":"Frontend","period":{"from":"2022-01","to":null},"description":"..."}]'
          spellCheck={false}
        />
        {errors?.experience && <span className="form__error">{errors.experience}</span>}
      </label>

      <label className="form__field">
        <span className="form__label">Содержание резюме (markdown)</span>
        <textarea
          name="content_md"
          defaultValue={values.content_md}
          rows={14}
          spellCheck={false}
        />
        {errors?.content_md && <span className="form__error">{errors.content_md}</span>}
      </label>

      <label className="form__field">
        <span className="form__label">
          Загрузить файл (.md / .pdf){" "}
          <span className="form__hint">переопределит «Содержание» извлечённым текстом</span>
        </span>
        <input type="file" name="file" accept=".md,.markdown,.pdf" />
        {errors?.file && <span className="form__error">{errors.file}</span>}
      </label>

      {errors?._form && <div className="form__error form__error--block">{errors._form}</div>}

      <div className="form__actions">
        <button type="submit" className="btn btn--primary">
          {isEdit ? "Сохранить" : "Создать"}
        </button>
        {isEdit && (
          <>
            {!confirmDelete ? (
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => setConfirmDelete(true)}
              >
                Удалить
              </button>
            ) : (
              <button
                type="submit"
                name="intent"
                value="delete"
                className="btn btn--danger"
              >
                Точно удалить?
              </button>
            )}
          </>
        )}
      </div>
    </form>
  );
}
