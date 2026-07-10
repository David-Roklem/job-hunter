/**
 * Репозиторий источников вакансий (sources).
 *
 * Тонкий CRUD без бизнес-логики. Доступ к БД — через db из app/db/index.ts.
 */
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { sources, type SourceKind } from "~/db/schema";
import {
  fromJson,
  sourceConfigSchema,
  sourceKindSchema,
  toJson,
  type ListOptions,
} from "./_shared";

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;

/** Вход создания источника (с zod-валидацией). */
export type CreateSourceInput = {
  kind: SourceKind;
  name: string;
  config: Record<string, unknown>;
};

/** DTO с распарсенным config (вместо непрозрачной строки config_json). */
export type SourceDTO = Omit<Source, "config_json"> & {
  config: Record<string, unknown>;
};

function toDTO(row: Source): SourceDTO {
  const { config_json, ...rest } = row;
  return { ...rest, config: fromJson(config_json, sourceConfigSchema) };
}

/** Создать источник. */
export function create(input: CreateSourceInput): Source {
  sourceKindSchema.parse(input.kind);
  const config_json = toJson(sourceConfigSchema.parse(input.config));
  const row = db
    .insert(sources)
    .values({ kind: input.kind, name: input.name, config_json })
    .returning()
    .get();
  if (!row) {
    throw new Error(
      `source insert returned no row (name=${JSON.stringify(input.name)})`,
    );
  }
  return row;
}

/** Найти источник по id. */
export function findById(id: number): SourceDTO | undefined {
  const row = db.select().from(sources).where(eq(sources.id, id)).get();
  return row ? toDTO(row) : undefined;
}

/** Список источников (с нативной пагинацией Drizzle, как в остальных репо). */
export function list(opts: ListOptions = {}): SourceDTO[] {
  const rows = db
    .select()
    .from(sources)
    .limit(opts.limit)
    .offset(opts.offset)
    .all();
  return rows.map(toDTO);
}

/** Обновить поля источника. Пустой patch — no-op (возвращает текущую строку). */
export function update(
  id: number,
  patch: Partial<Pick<Source, "name">> & {
    kind?: SourceKind;
    config?: Record<string, unknown>;
  },
): Source | undefined {
  const values: Partial<NewSource> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.kind !== undefined) values.kind = sourceKindSchema.parse(patch.kind);
  if (patch.config !== undefined) {
    values.config_json = toJson(sourceConfigSchema.parse(patch.config));
  }
  if (Object.keys(values).length === 0) {
    return db.select().from(sources).where(eq(sources.id, id)).get();
  }
  return db
    .update(sources)
    .set(values)
    .where(eq(sources.id, id))
    .returning()
    .get();
}
