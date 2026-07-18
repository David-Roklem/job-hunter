/**
 * Чтение/запись .env файла (фаза ui-control).
 *
 * Атомарная запись: temp-файл в той же директории + rename (согласовано с
 * temp-files rule). Не затираем неизвестные ключи (сохраняем ручные комментарии
 * и сторонние переменные) — обновляем только переданные.
 *
 * Парсинг .env здесь намеренно упрощённый (KEY=VALUE построчно). Полная
 * валидация происходит через EnvSchema при следующем старте процесса — мы
 * только пишем, не валидируем (zod сделает это).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { EDITABLE_KEY_SET } from "./schema";
import type { EditableKey } from "./schema";

/** Белый список редактируемых ключей (реэкспорт для удобства). */
export type { EditableKey } from "./schema";

/** Путь к .env в корне проекта. */
export const ENV_PATH = path.join(process.cwd(), ".env");

/** Результат чтения .env. */
export type ReadEnvResult = {
  /** Полный путь к файлу (для UI). */
  path: string;
  /** Существует ли файл. */
  exists: boolean;
  /** Распарсенные пары key→value (только валидный KEY=VALUE). */
  values: Record<string, string>;
};

/**
 * Прочитать .env. Если файла нет — exists:false, values:{}.
 *
 * Не падает на повреждённых строках — пропускает. Обрамляющие кавычки
 * снимаются (как в _env.ts loadEnv, для консистентности).
 */
export function readEnvFile(envPath: string = ENV_PATH): ReadEnvResult {
  if (!existsSync(envPath)) {
    return { path: envPath, exists: false, values: {} };
  }
  let content: string;
  try {
    content = readFileSync(envPath, "utf8");
  } catch {
    return { path: envPath, exists: true, values: {} };
  }
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    values[key] = val;
  }
  return { path: envPath, exists: true, values };
}

/** Внутренний тип для строки .env. */
type Line = { key: string; raw: string; value: string; wasQuoted: boolean };

/**
 * Применить обновления к .env атомарно (temp + rename).
 *
 * Стратегия: читаем существующий файл построчно; для каждой строки с KEY=...
 * проверяем, есть ли обновление — если есть, переписываем VALUE (с сохранением
 * формата кавычек если они были). Если ключа в файле не было — дописываем в
 * конец. Сторонние ключи/комментарии сохраняются как есть.
 *
 * Пустое значение в updates → записываем KEY= (пусто), чтобы затереть секрет.
 */
export function writeEnvFile(
  updates: Partial<Record<EditableKey, string>>,
  envPath: string = ENV_PATH,
): void {
  // Валидируем что все ключи в updates — из белого списка.
  for (const k of Object.keys(updates)) {
    if (!EDITABLE_KEY_SET.has(k as EditableKey)) {
      throw new Error(`ключ ${k} не в белом списке EDITABLE_KEYS`);
    }
  }

  const existing = existsSync(envPath)
    ? readFileSync(envPath, "utf8")
    : "";
  const lines = existing.split(/\r?\n/);

  // Распарсить существующие строки на ключи.
  const parsed: Line[] = lines.map((raw) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return { key: "", raw, value: "", wasQuoted: false };
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) return { key: "", raw, value: "", wasQuoted: false };
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    let wasQuoted = false;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
      wasQuoted = true;
    }
    return { key, raw, value: val, wasQuoted };
  });

  const applied = new Set<string>();

  // Обновить существующие строки.
  const updatedLines = parsed.map((line) => {
    if (!line.key) return line.raw;
    if (!(line.key in updates)) return line.raw;
    const newVal = updates[line.key as EditableKey] ?? "";
    applied.add(line.key);
    // Сохраняем кавычки если были, иначе пишем как есть (без кавычек).
    if (line.wasQuoted) {
      return `${line.key}="${newVal}"`;
    }
    return `${line.key}=${newVal}`;
  });

  // Дописать ключи, которых не было в файле.
  for (const [k, v] of Object.entries(updates)) {
    if (applied.has(k)) continue;
    updatedLines.push(`${k}=${v ?? ""}`);
  }

  const newContent = updatedLines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";

  // Атомарная запись: temp в той же директории (cross-device safe), затем rename.
  const dir = path.dirname(envPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(envPath)}.${process.pid}.tmp`);
  writeFileSync(tmpPath, newContent, "utf8");
  try {
    renameSync(tmpPath, envPath);
  } catch (err) {
    // best-effort cleanup
    try {
      writeFileSync(tmpPath, "", "utf8");
    } catch {
      // ignore
    }
    throw err;
  }
}

/** Для тестов: получить путь во временном каталоге (согласовано с temp-files rule). */
export function tmpEnvPath(name: string = "test.env"): string {
  return path.join(os.tmpdir(), `job_hunter-env-${process.pid}`, name);
}
