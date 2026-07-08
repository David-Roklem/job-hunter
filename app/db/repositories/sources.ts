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

/** Сериализованная форма Source для API/UI (config распарсен). */
export type SourceDTO = Omit<Source, "config_json"> & { config: unknown };

function toDTO(row: Source): SourceDTO {
  const { config_json, ...rest } = row;
  return { ...rest, config: fromJson(config_json, sourceConfigSchema) };
}

/** Создать источник. */
export function create(input: CreateSourceInput): Source {
  sourceKindSchema.parse(input.kind);
  const config_json = toJson(sourceConfigSchema.parse(input.config));
  return db
    .insert(sources)
    .values({ kind: input.kind, name: input.name, config_json })
    .returning()
    .get()!;
}

/** Найти источник по id. */
export function findById(id: number): SourceDTO | undefined {
  const row = db.select().from(sources).where(eq(sources.id, id)).get();
  return row ? toDTO(row) : undefined;
}

/** Список источников (с пагинацией). */
export function list(opts: ListOptions = {}): SourceDTO[] {
  const rows = db.select().from(sources).all();
  // Drizzle SQLite sync API не поддерживает limit/offset напрямую на select().all(),
  // но поддерживает через prepare — для тонкого репозитория проще применить в памяти.
  const { limit, offset } = opts;
  let result = rows;
  if (offset !== undefined && offset > 0) result = result.slice(offset);
  if (limit !== undefined && limit > 0) result = result.slice(0, limit);
  return result.map(toDTO);
}

/** Обновить поля источника. */
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
  return db
    .update(sources)
    .set(values)
    .where(eq(sources.id, id))
    .returning()
    .get();
}
