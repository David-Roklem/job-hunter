/**
 * Drizzle-схема data-модели job_hunter (фаза 02).
 *
 * Девять таблиц: sources, companies, vacancies, resume_templates, applications,
 * cover_letters, tags, vacancy_tags, jobs.
 *
 * Соглашения:
 *  - имена таблиц во множественном числе (snake_case), колонки snake_case;
 *  - PK — INTEGER AUTOINCREMENT (решение из PLAN.md);
 *  - дедупликация вакансий через UNIQUE(source_id, external_id);
 *  - JSON-поля — text (SQLite без нативного JSON-типа), парсинг на уровне репозиториев;
 *  - timestamps — UNIX-секунды (mode: "timestamp"), default unixepoch(), update — $onUpdateFn.
 *
 * Доступ к БД — только через app/db/index.ts (must_have фазы 1).
 */
import { relations } from "drizzle-orm";
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  index,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Timestamps-хелпер — переиспользуемые created_at / updated_at.
//
// SQLite хранит UNIX-секунды. Drizzle mode: "timestamp" конвертирует в Date.
// default — sql-выражение unixepoch(), обновление — JS-функцией (надёжнее,
// чем SQL, т.к. $onUpdate отрабатывает на каждом update в Drizzle).
// ---------------------------------------------------------------------------

/** Общие таймстемпы. Спредить в определение каждой таблицы. */
const timestamps = {
  created_at: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updated_at: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
} as const;

// ---------------------------------------------------------------------------
// Enum-типы (выводятся из text({ enum }) — без ручных union-ов).
// ---------------------------------------------------------------------------

export const sourceKinds = ["hh", "company", "telegram"] as const;
export type SourceKind = (typeof sourceKinds)[number];

export const vacancyStatuses = [
  "new",
  "matched",
  "applied",
  "rejected",
  "closed",
] as const;
export type VacancyStatus = (typeof vacancyStatuses)[number];

export const employmentTypes = [
  "full",
  "part",
  "contract",
  "project",
] as const;
export type EmploymentType = (typeof employmentTypes)[number];

export const applicationStatuses = [
  "draft",
  "pending_review",
  "approved",
  "sent",
  "failed",
  "rejected",
] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];

export const aiProviders = ["yandex", "gigachat"] as const;
export type AiProvider = (typeof aiProviders)[number];

export const jobKinds = [
  "collect_vacancies",
  "generate_draft",
  "apply_hh",
] as const;
export type JobKind = (typeof jobKinds)[number];

export const jobStatuses = [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof jobStatuses)[number];

// ---------------------------------------------------------------------------
// Таблицы
// ---------------------------------------------------------------------------

/** Источник вакансий: hh.ru / карьерный сайт компании / Telegram-канал. */
export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: sourceKinds }).notNull(),
  name: text("name").notNull(),
  // JSON: { url?, channel?, filters?, ... } — валидируется репозиторием.
  config_json: text("config_json").notNull(),
  ...timestamps,
});

/** Компания-работодатель. */
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  website_url: text("website_url"),
  hh_id: text("hh_id"),
  ...timestamps,
});

/**
 * Вакансия — ядро домена.
 *
 * Дедупликация: UNIQUE(source_id, external_id) — один внешний id на источник.
 * Дубли в пределах источника отбрасываются (onConflictDoNothing в репозитории);
 * кросс-источник разрешается matcher'ом (фаза 08).
 */
export const vacancies = sqliteTable(
  "vacancies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source_id: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    external_id: text("external_id").notNull(),
    company_id: integer("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    salary_from: integer("salary_from"),
    salary_to: integer("salary_to"),
    currency: text("currency"),
    location: text("location"),
    employment_type: text("employment_type", { enum: employmentTypes }),
    url: text("url").notNull(),
    // Полный сырой ответ источника для аудита/перепарсинга.
    raw_json: text("raw_json").notNull(),
    status: text("status", { enum: vacancyStatuses })
      .notNull()
      .default("new"),
    collected_at: integer("collected_at", { mode: "timestamp" }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("vacancies_source_external_unique").on(
      table.source_id,
      table.external_id,
    ),
  ],
);

/**
 * Шаблон резюме под роль/направление.
 * Пользователь ищет работу по нескольким направлениям → несколько шаблонов.
 */
export const resume_templates = sqliteTable("resume_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  role: text("role").notNull(),
  summary: text("summary").notNull(),
  // JSON: string[] навыков.
  skills_json: text("skills_json").notNull(),
  // JSON: опыт работы.
  experience_json: text("experience_json").notNull(),
  // Полный markdown/PDF-текст резюме.
  content_md: text("content_md").notNull(),
  is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

/**
 * Отклик — связка вакансия × резюме-шаблон.
 * UNIQUE(vacancy_id, resume_template_id): один шаблон на вакансию в одном отклике.
 */
export const applications = sqliteTable(
  "applications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    vacancy_id: integer("vacancy_id")
      .notNull()
      .references(() => vacancies.id, { onDelete: "cascade" }),
    resume_template_id: integer("resume_template_id")
      .notNull()
      .references(() => resume_templates.id, { onDelete: "cascade" }),
    match_score: integer("match_score"),
    status: text("status", { enum: applicationStatuses })
      .notNull()
      .default("draft"),
    submitted_at: integer("submitted_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    unique("applications_vacancy_resume_unique").on(
      table.vacancy_id,
      table.resume_template_id,
    ),
  ],
);

/**
 * Сопроводительное письмо (AI-черновик).
 * 1:1 с applications через UNIQUE(application_id).
 */
export const cover_letters = sqliteTable(
  "cover_letters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    application_id: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    body_md: text("body_md").notNull(),
    ai_provider: text("ai_provider", { enum: aiProviders }),
    model: text("model"),
    generated_at: integer("generated_at", { mode: "timestamp" }).notNull(),
    edited_at: integer("edited_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [unique("cover_letters_application_unique").on(table.application_id)],
);

/** Тег для фильтрации/скоринга вакансий. */
export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  color: text("color"),
  created_at: timestamps.created_at,
});

/** Связка many-to-many вакансия ↔ тег. */
export const vacancy_tags = sqliteTable(
  "vacancy_tags",
  {
    vacancy_id: integer("vacancy_id")
      .notNull()
      .references(() => vacancies.id, { onDelete: "cascade" }),
    tag_id: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.vacancy_id, table.tag_id] }),
    index("vacancy_tags_tag_id_idx").on(table.tag_id),
  ],
);

/**
 * Элемент очереди фоновых задач (для scheduler фазы 12).
 * Планировщик берёт следующую: WHERE status='queued' AND run_after<=now
 * ORDER BY run_after — индекс (status, run_after) ускоряет выборку.
 */
export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: jobKinds }).notNull(),
    // JSON-параметры задачи.
    payload_json: text("payload_json").notNull(),
    status: text("status", { enum: jobStatuses }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    max_attempts: integer("max_attempts").notNull().default(3),
    // Когда задачу можно исполнять (для троттлинга/ретраев).
    run_after: integer("run_after", { mode: "timestamp" }).notNull(),
    locked_at: integer("locked_at", { mode: "timestamp" }),
    error: text("error"),
    result_json: text("result_json"),
    finished_at: integer("finished_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [index("jobs_status_run_after_idx").on(table.status, table.run_after)],
);

// ---------------------------------------------------------------------------
// Relations — для query API Drizzle (with: {...}).
// ---------------------------------------------------------------------------

export const sourcesRelations = relations(sources, ({ many }) => ({
  vacancies: many(vacancies),
}));

export const companiesRelations = relations(companies, ({ many }) => ({
  vacancies: many(vacancies),
}));

export const vacanciesRelations = relations(vacancies, ({ one, many }) => ({
  source: one(sources, {
    fields: [vacancies.source_id],
    references: [sources.id],
  }),
  company: one(companies, {
    fields: [vacancies.company_id],
    references: [companies.id],
  }),
  applications: many(applications),
  tags: many(vacancy_tags),
}));

export const resumeTemplatesRelations = relations(
  resume_templates,
  ({ many }) => ({
    applications: many(applications),
  }),
);

export const applicationsRelations = relations(
  applications,
  ({ one }) => ({
    vacancy: one(vacancies, {
      fields: [applications.vacancy_id],
      references: [vacancies.id],
    }),
    resume_template: one(resume_templates, {
      fields: [applications.resume_template_id],
      references: [resume_templates.id],
    }),
    cover_letter: one(cover_letters),
  }),
);

export const coverLettersRelations = relations(cover_letters, ({ one }) => ({
  application: one(applications, {
    fields: [cover_letters.application_id],
    references: [applications.id],
  }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  vacancy_tags: many(vacancy_tags),
}));

export const vacancyTagsRelations = relations(vacancy_tags, ({ one }) => ({
  vacancy: one(vacancies, {
    fields: [vacancy_tags.vacancy_id],
    references: [vacancies.id],
  }),
  tag: one(tags, {
    fields: [vacancy_tags.tag_id],
    references: [tags.id],
  }),
}));

// ---------------------------------------------------------------------------
// Агрегат схемы — для drizzle-kit и передачи в drizzle({ schema }).
// ---------------------------------------------------------------------------

export const schema = {
  sources,
  companies,
  vacancies,
  resume_templates,
  applications,
  cover_letters,
  tags,
  vacancy_tags,
  jobs,
  sourcesRelations,
  companiesRelations,
  vacanciesRelations,
  resumeTemplatesRelations,
  applicationsRelations,
  coverLettersRelations,
  tagsRelations,
  vacancyTagsRelations,
};

export type Schema = typeof schema;
