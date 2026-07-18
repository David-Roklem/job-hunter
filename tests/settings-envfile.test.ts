/**
 * Тесты app/settings/envFile.ts (фаза ui-control).
 *
 * Изолируем во временном каталоге (temp-files rule: os.tmpdir). Проверяем:
 *  - readEnvFile: парсинг KEY=VALUE, кавычки, комментарии
 *  - writeEnvFile: обновление существующих, дописывание новых, атомарность
 *  - сохранение комментариев и сторонних ключей
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readEnvFile, writeEnvFile, tmpEnvPath } from "~/settings/envFile";

const ENV_DIR = path.dirname(tmpEnvPath());

beforeEach(() => {
  mkdirSync(ENV_DIR, { recursive: true });
});
afterEach(() => {
  try {
    rmSync(ENV_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("settings/envFile readEnvFile", () => {
  it("нет файла → exists:false, values:{}", () => {
    const res = readEnvFile(tmpEnvPath("missing.env"));
    expect(res.exists).toBe(false);
    expect(res.values).toEqual({});
  });

  it("парсит KEY=VALUE, снимает кавычки, игнорирует комментарии", () => {
    const p = tmpEnvPath();
    writeFileSync(p, [
      "# comment",
      'FOO="bar baz"',
      "BAZ=qux",
      "EMPTY=",
      "NOT_A_LINE",
    ].join("\n"), "utf8");
    const res = readEnvFile(p);
    expect(res.exists).toBe(true);
    expect(res.values.FOO).toBe("bar baz");
    expect(res.values.BAZ).toBe("qux");
    expect(res.values.EMPTY).toBe("");
    // NOT_A_LINE (без =) пропущена.
    expect(res.values.NOT_A_LINE).toBeUndefined();
  });
});

describe("settings/envFile writeEnvFile", () => {
  it("создаёт новый файл если не было", () => {
    const p = tmpEnvPath("new.env");
    writeEnvFile({ ZAI_MODEL: "glm-6" }, p);
    expect(existsSync(p)).toBe(true);
    const content = readFileSync(p, "utf8");
    expect(content).toContain("ZAI_MODEL=glm-6");
  });

  it("обновляет существующий ключ, сохраняя кавычки если были", () => {
    const p = tmpEnvPath();
    writeFileSync(p, 'ZAI_API_KEY="old-secret"\nOTHER=keep\n', "utf8");
    writeEnvFile({ ZAI_API_KEY: "new-secret" }, p);
    const content = readFileSync(p, "utf8");
    expect(content).toContain('ZAI_API_KEY="new-secret"');
    expect(content).toContain("OTHER=keep");
  });

  it("дописывает новый ключ в конец", () => {
    const p = tmpEnvPath();
    writeFileSync(p, "ZAI_MODEL=glm-5\n", "utf8");
    writeEnvFile({ ZAI_BASE_URL: "https://x" }, p);
    const content = readFileSync(p, "utf8");
    expect(content).toContain("ZAI_MODEL=glm-5");
    expect(content).toContain("ZAI_BASE_URL=https://x");
  });

  it("сохраняет комментарии и сторонние ключи", () => {
    const p = tmpEnvPath();
    writeFileSync(p, [
      "# my comment",
      "CUSTOM_KEY=value",
      "ZAI_MODEL=old",
      "",
    ].join("\n"), "utf8");
    writeEnvFile({ ZAI_MODEL: "new" }, p);
    const content = readFileSync(p, "utf8");
    expect(content).toContain("# my comment");
    expect(content).toContain("CUSTOM_KEY=value");
    expect(content).toContain("ZAI_MODEL=new");
  });

  it("пустое значение → KEY= (затирка секрета)", () => {
    const p = tmpEnvPath();
    writeFileSync(p, "ZAI_API_KEY=secret\n", "utf8");
    writeEnvFile({ ZAI_API_KEY: "" }, p);
    const content = readFileSync(p, "utf8");
    expect(content).toContain("ZAI_API_KEY=");
    expect(content).not.toContain("ZAI_API_KEY=secret");
  });

  it("ключ вне белого списка → throw", () => {
    const p = tmpEnvPath();
    expect(() =>
      // @ts-expect-error — намеренно плохой ключ
      writeEnvFile({ BOGUS_KEY: "x" }, p),
    ).toThrow(/не в белом списке/);
  });

  it("не оставляет temp-файл после успеха", () => {
    const p = tmpEnvPath();
    writeEnvFile({ ZAI_MODEL: "x" }, p);
    const dir = path.dirname(p);
    const leftovers = existsSync(path.join(dir, `.${path.basename(p)}.${process.pid}.tmp`));
    expect(leftovers).toBe(false);
  });
});
