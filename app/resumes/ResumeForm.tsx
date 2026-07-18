/**
 * Переиспользуемая форма шаблона резюме для создания и редактирования.
 *
 * Поля:
 *  - name, role, summary — простые текстовые
 *  - skills — через запятую (преобразуется в string[] в action)
 *  - experience — ДИНАМИЧЕСКИЙ список полей (UI-редактор): кнопка «+ Добавить
 *    место», каждый блок: Компания / Роль / Дата с / Дата по / Описание.
 *    Сериализуется в hidden-поле experience_json (строгий JSON-массив формы
 *    experienceSchema из _shared.ts). Пустая строка = [].
 *  - content_md — основное тело резюме (markdown)
 *  - файл .md/.pdf — если приложен, переопределяет content_md извлечённым текстом
 *
 * Ошибки валидации показываются под полями (errors[field]).
 * Удаление — отдельная intent-кнопка (только в режиме редактирования).
 */
import { useState } from "react";
import type { ResumeTemplateDTO } from "~/db/repositories/resume_templates";
import type { ExperienceItem } from "~/db/repositories/_shared";

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

/**
 * Сериализованное представление для формы. experience — JSON-строка массива
 * ExperienceItem (для hidden-поля experience_json). Пусто = [].
 */
export type ResumeFormValues = {
  name: string;
  role: string;
  summary: string;
  skills: string; // comma-separated
  experience: string; // JSON-строка experience[] (для hidden-поля)
  content_md: string;
};

function experienceToRaw(items: ExperienceItem[]): string {
  return items.length > 0 ? JSON.stringify(items) : "";
}

function rawToExperience(raw: string): ExperienceItem[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ExperienceItem[]) : [];
  } catch {
    return [];
  }
}

export function valuesFromTemplate(t: ResumeTemplateDTO): ResumeFormValues {
  return {
    name: t.name,
    role: t.role,
    summary: t.summary,
    skills: t.skills.join(", "),
    experience: experienceToRaw(t.experience),
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

/** Пустой блок нового места работы. */
function emptyExperienceItem(): ExperienceItem {
  return { company: "", role: "", period: { from: "", to: null }, description: "" };
}

/** UI-редактор опыта: динамический список мест работы. */
function ExperienceEditor({
  items,
  onChange,
  error,
}: {
  items: ExperienceItem[];
  onChange: (next: ExperienceItem[]) => void;
  error?: string;
}) {
  const update = (idx: number, patch: Partial<ExperienceItem>) => {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    onChange(next);
  };
  const remove = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };
  const add = () => {
    onChange([...items, emptyExperienceItem()]);
  };

  return (
    <div className="experience-editor">
      {items.length === 0 && (
        <p className="form__hint">
          Места работы ещё не добавлены. Нажмите «+ Добавить место».
        </p>
      )}

      {items.map((item, idx) => (
        <fieldset key={idx} className="experience-item">
          <legend>Место работы {idx + 1}</legend>

          {items.length > 1 && (
            <button
              type="button"
              className="btn btn--danger experience-item__remove"
              onClick={() => remove(idx)}
              aria-label="Удалить место работы"
            >
              ✕
            </button>
          )}

          <div className="experience-item__row">
            <label className="form__field">
              <span className="form__label">Компания *</span>
              <input
                value={item.company}
                onChange={(e) => update(idx, { company: e.target.value })}
                placeholder="Acme Inc."
              />
            </label>
            <label className="form__field">
              <span className="form__label">Должность *</span>
              <input
                value={item.role}
                onChange={(e) => update(idx, { role: e.target.value })}
                placeholder="Senior Frontend"
              />
            </label>
          </div>

          <div className="experience-item__row">
            <label className="form__field">
              <span className="form__label">С *</span>
              <input
                type="month"
                value={item.period.from}
                onChange={(e) =>
                  update(idx, {
                    period: { ...item.period, from: e.target.value },
                  })
                }
              />
            </label>
            <label className="form__field">
              <span className="form__label">По</span>
              <input
                type="month"
                value={item.period.to ?? ""}
                onChange={(e) =>
                  update(idx, {
                    period: { ...item.period, to: e.target.value || null },
                  })
                }
                placeholder="оставьте пустым для «по настоящее»"
              />
            </label>
          </div>

          <label className="form__field experience-item__current">
            <input
              type="checkbox"
              checked={item.period.to === null}
              onChange={(e) =>
                update(idx, {
                  period: {
                    ...item.period,
                    to: e.target.checked ? null : item.period.from,
                  },
                })
              }
            />
            <span>работаю по настоящее время</span>
          </label>

          <label className="form__field">
            <span className="form__label">Описание / обязанности</span>
            <textarea
              value={item.description}
              onChange={(e) => update(idx, { description: e.target.value })}
              rows={3}
              placeholder="Что делали, стек, достижения"
            />
          </label>
        </fieldset>
      ))}

      <button type="button" className="btn experience-editor__add" onClick={add}>
        + Добавить место
      </button>

      {error && <span className="form__error">{error}</span>}
    </div>
  );
}

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
  // experience из values.experience (JSON-строка) → в UI-стейт массива.
  const [experienceItems, setExperienceItems] = useState<ExperienceItem[]>(
    () => rawToExperience(values.experience),
  );

  // Сериализуем текущий UI-стейт в hidden-поле experience_json при каждом изменении.
  const experienceRaw = experienceToRaw(experienceItems);

  return (
    <form method="post" action={action} encType="multipart/form-data" className="form">
      <input type="hidden" name="experience_json" value={experienceRaw} />

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

      <div className="form__field">
        <span className="form__label">Опыт работы</span>
        <ExperienceEditor
          items={experienceItems}
          onChange={setExperienceItems}
          error={errors?.experience}
        />
      </div>

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
