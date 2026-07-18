/**
 * Разбор multipart-формы шаблона резюме → вход для репозитория.
 *
 * Общая логика для action'ов new/edit. Возвращает либо
 * { ok: true, input } для создания/обновления, либо { ok: false, errors }.
 *
 * Файл (.md/.pdf), если приложен, переопределяет content_md извлечённым текстом.
 */
import { experienceSchema, skillsSchema } from "~/db/repositories/_shared";
import { detectKind, importMarkdown, importPdf } from "~/resumes/import";
import type { CreateResumeTemplateInput } from "~/db/repositories/resume_templates";
import type { ResumeFormErrors } from "~/resumes/ResumeForm";

export type ParsedForm =
  | { ok: true; input: Omit<CreateResumeTemplateInput, "is_active"> }
  | { ok: false; errors: ResumeFormErrors };

export async function parseResumeForm(request: Request): Promise<ParsedForm> {
  const formData = await request.formData();
  const errors: ResumeFormErrors = {};

  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  const skillsRaw = String(formData.get("skills") ?? "").trim();
  const experienceRaw = String(formData.get("experience_json") ?? "").trim();
  const contentMd = String(formData.get("content_md") ?? "");

  if (!name) errors.name = "Укажите название";
  if (!role) errors.role = "Укажите роль";

  // skills: «React, TypeScript,» → ["React", "TypeScript"]
  const skills = skillsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const skillsResult = skillsSchema.safeParse(skills);
  if (!skillsResult.success) errors.skills = "Неверный формат навыков";

  // experience: пустая строка → [], иначе парсим JSON + zod.
  // (UI-редактор сериализует массив в hidden-поле experience_json.)
  let experience: unknown;
  if (experienceRaw === "") {
    experience = [];
  } else {
    try {
      experience = JSON.parse(experienceRaw);
    } catch {
      errors.experience = "Опыт: невалидный JSON";
      experience = [];
    }
  }
  const experienceResult = experienceSchema.safeParse(experience);
  if (!experienceResult.success) {
    errors.experience =
      "Опыт: неверная форма. Нужен массив { company, role, period{from,to}, description }.";
  }

  // content_md: файл переопределяет текстовое поле, если приложен.
  let content_md = contentMd;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const kind = detectKind(file.name);
    if (kind === null) {
      errors.file = "Поддерживаются только .md и .pdf";
    } else if (kind === "md") {
      content_md = importMarkdown(await file.text()).content_md;
    } else {
      try {
        content_md = (await importPdf(Buffer.from(await file.arrayBuffer()))).content_md;
      } catch (e) {
        errors.file = e instanceof Error ? e.message : "Не удалось извлечь текст из PDF";
      }
    }
  }
  if (!content_md.trim()) {
    errors.content_md = "Содержание пусто — введите текст или загрузите файл";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    input: {
      name,
      role,
      summary,
      skills: skillsResult.success ? skillsResult.data : [],
      experience: experienceResult.success ? experienceResult.data : [],
      content_md,
    },
  };
}
