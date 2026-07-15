/**
 * CLI генерации сопроводительных писем (фаза 09).
 *
 * Запуск:
 *   npm run generate-drafts -- --application=<id>            # одно письмо
 *   npm run generate-drafts -- --all [--threshold=60] [--max=50] [--locale=ru]
 *
 * --application — id application в БД (одиночная генерация).
 * --all         — батч по applications status='draft' без письма.
 *
 * Грузит .env (ZAI_API_KEY обязателен для генерации). По образцу match.ts.
 */
import { loadEnv } from "./_env";

loadEnv();

const { generateDraftsOne, generateDraftsAll } = await import(
  "../app/ai/generateDrafts"
);
const { coverLettersRepo } = await import("../app/db/repositories");

interface ParsedArgs {
  application?: number;
  all?: boolean;
  threshold?: number;
  max?: number;
  locale?: "ru" | "en";
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--application=")) {
      out.application = Number(arg.split("=")[1]);
    } else if (arg === "--all") {
      out.all = true;
    } else if (arg.startsWith("--threshold=")) {
      out.threshold = Number(arg.split("=")[1]);
    } else if (arg.startsWith("--max=")) {
      out.max = Number(arg.split("=")[1]);
    } else if (arg.startsWith("--locale=")) {
      const v = arg.split("=")[1] as "ru" | "en";
      if (v === "ru" || v === "en") out.locale = v;
    }
  }
  return out;
}

function usage(): void {
  console.error(
    [
      "Использование:",
      "  npm run generate-drafts -- --application=<id>",
      "  npm run generate-drafts -- --all [--threshold=60] [--max=50] [--locale=ru]",
      "",
      "Опции:",
      "  --application=<id>  id application (одиночная генерация)",
      "  --all               батч: applications status='draft' без письма",
      "  --threshold=<n>     только match_score >= порога (опц.)",
      "  --max=<n>           лимит кандидатов в батче",
      "  --locale=ru|en      язык промпта (дефолт ru)",
    ].join("\n"),
  );
}

async function runOne(applicationId: number, locale?: "ru" | "en"): Promise<void> {
  try {
    const result = await generateDraftsOne(applicationId, { locale });
    const letter = coverLettersRepo.findByApplicationId(applicationId);
    console.log(`\nПисьмо для application ${applicationId} (vacancy ${result.vacancyId}):`);
    console.log(`  длина: ${result.bodyLength} символов`);
    console.log("\n--- тело письма ---\n");
    console.log(letter?.body_md ?? "(не записано)");
    console.log("\n--- конец ---");
  } catch (err) {
    console.error(
      `\nОшибка генерации для application ${applicationId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}

function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

async function runAll(
  threshold?: number,
  max?: number,
  locale?: "ru" | "en",
): Promise<void> {
  const stats = await generateDraftsAll({ minScore: threshold, max, locale });
  console.log(`\nБатч-генерация писем: ${stats.candidates} кандидатов`);
  console.log(
    `  candidates=${stats.candidates}  generated=${stats.generated}  skipped=${stats.skipped}` +
      (stats.errors.length > 0 ? `  errors=${stats.errors.length}` : ""),
  );

  if (stats.results.length > 0) {
    console.log("\nСгенерировано:");
    for (const r of stats.results) {
      console.log(
        `  application ${r.applicationId} (v${r.vacancyId}×r${r.resumeTemplateId}): ${r.bodyLength} символов`,
      );
    }
  } else if (stats.candidates === 0) {
    console.log("\nНет кандидатов (applications status='draft' без письма).");
  }

  if (stats.errors.length > 0) {
    console.log("\nОшибки (continue-on-error, прогон продолжен):");
    for (const e of stats.errors) {
      console.log(`  application ${e.applicationId}: ${truncate(e.message, 80)}`);
    }
  }
}

const args = parseArgs(process.argv);

if (args.application !== undefined) {
  await runOne(args.application, args.locale);
} else if (args.all) {
  await runAll(args.threshold, args.max, args.locale);
} else {
  usage();
  process.exitCode = 1;
}
