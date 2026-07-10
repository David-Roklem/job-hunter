/**
 * Репозиторий профилей критериев поиска (search_profiles).
 *
 * Тонкий CRUD без бизнес-логики. JSON-массивы (areas/employment_types/
 * include_keywords/exclude_keywords) парсятся в DTO через zod.
 * Стиль паритетен sources.ts.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { searchProfiles, type EmploymentType } from "~/db/schema";
import {
  employmentTypeSchema,
  fromJson,
  toJson,
  type ListOptions,
} from "./_shared";

const stringArraySchema = z.array(z.string());
const employmentTypeArraySchema = z.array(employmentTypeSchema);

export type SearchProfile = typeof searchProfiles.$inferSelect;
export type NewSearchProfile = typeof searchProfiles.$inferInsert;

/** Вход создания профиля (с zod-валидацией массивов). */
export type CreateSearchProfileInput = {
  name: string;
  query: string;
  areas?: string[];
  employment_types?: EmploymentType[];
  include_keywords?: string[];
  exclude_keywords?: string[];
  min_salary?: number | null;
  is_active?: boolean;
};

/** DTO с распарсенными JSON-массивами. */
export type SearchProfileDTO = Omit<
  SearchProfile,
  | "areas_json"
  | "employment_types_json"
  | "include_keywords_json"
  | "exclude_keywords_json"
> & {
  areas: string[];
  employment_types: EmploymentType[];
  include_keywords: string[];
  exclude_keywords: string[];
};

/** Patch для update. Все поля опциональны. */
export type UpdateSearchProfilePatch = Partial<CreateSearchProfileInput>;

function toDTO(row: SearchProfile): SearchProfileDTO {
  const {
    areas_json,
    employment_types_json,
    include_keywords_json,
    exclude_keywords_json,
    ...rest
  } = row;
  return {
    ...rest,
    areas: fromJson(areas_json, stringArraySchema),
    employment_types: fromJson(employment_types_json, employmentTypeArraySchema),
    include_keywords: fromJson(include_keywords_json, stringArraySchema),
    exclude_keywords: fromJson(exclude_keywords_json, stringArraySchema),
  };
}

/** Создать профиль поиска. */
export function create(input: CreateSearchProfileInput): SearchProfile {
  const row = db
    .insert(searchProfiles)
    .values({
      name: input.name,
      query: input.query,
      areas_json: toJson(stringArraySchema.parse(input.areas ?? [])),
      employment_types_json: toJson(
        employmentTypeArraySchema.parse(input.employment_types ?? []),
      ),
      include_keywords_json: toJson(
        stringArraySchema.parse(input.include_keywords ?? []),
      ),
      exclude_keywords_json: toJson(
        stringArraySchema.parse(input.exclude_keywords ?? []),
      ),
      min_salary: input.min_salary ?? null,
      is_active: input.is_active ?? true,
    })
    .returning()
    .get();
  if (!row) {
    throw new Error(
      `search_profiles insert returned no row (name=${JSON.stringify(input.name)})`,
    );
  }
  return row;
}

/** Найти профиль по id. */
export function findById(id: number): SearchProfileDTO | undefined {
  const row = db
    .select()
    .from(searchProfiles)
    .where(eq(searchProfiles.id, id))
    .get();
  return row ? toDTO(row) : undefined;
}

/** Список профилей (с нативной пагинацией Drizzle). */
export function list(opts: ListOptions = {}): SearchProfileDTO[] {
  const rows = db
    .select()
    .from(searchProfiles)
    .limit(opts.limit as number)
    .offset(opts.offset as number)
    .all();
  return rows.map(toDTO);
}

/** Обновить поля профиля. Пустой patch — no-op (возвращает текущую строку). */
export function update(
  id: number,
  patch: UpdateSearchProfilePatch,
): SearchProfileDTO | undefined {
  const values: Partial<NewSearchProfile> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.query !== undefined) values.query = patch.query;
  if (patch.areas !== undefined) {
    values.areas_json = toJson(stringArraySchema.parse(patch.areas));
  }
  if (patch.employment_types !== undefined) {
    values.employment_types_json = toJson(
      employmentTypeArraySchema.parse(patch.employment_types),
    );
  }
  if (patch.include_keywords !== undefined) {
    values.include_keywords_json = toJson(
      stringArraySchema.parse(patch.include_keywords),
    );
  }
  if (patch.exclude_keywords !== undefined) {
    values.exclude_keywords_json = toJson(
      stringArraySchema.parse(patch.exclude_keywords),
    );
  }
  if (patch.min_salary !== undefined) values.min_salary = patch.min_salary;
  if (patch.is_active !== undefined) values.is_active = patch.is_active;

  if (Object.keys(values).length === 0) {
    const row = db
      .select()
      .from(searchProfiles)
      .where(eq(searchProfiles.id, id))
      .get();
    return row ? toDTO(row) : undefined;
  }
  const row = db
    .update(searchProfiles)
    .set(values)
    .where(eq(searchProfiles.id, id))
    .returning()
    .get();
  return row ? toDTO(row) : undefined;
}

/** Удалить профиль. */
export function remove(id: number): boolean {
  const res = db
    .delete(searchProfiles)
    .where(eq(searchProfiles.id, id))
    .run();
  return res.changes > 0;
}
