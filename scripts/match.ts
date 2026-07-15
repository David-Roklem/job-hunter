/**
 * CLI матчинга вакансий (фаза 08).
 *
 * Запуск:
 *   npm run match -- --vacancy=<id> [--resume=<id>] [--threshold=50]   # разовый
 *   npm run match -- --all [--threshold=50] [--max=200]                  # батч
 *
 * --vacancy — id вакансии в БД. Без --resume скорит по всем активным шаблонам.
 * --all     — все вакансии status='new' × все активные resume_templates.
 *
 * Грузит .env (ZAI_API_KEY обязателен для AI-скоринга). Печатает статистику
 * и таблицу {vacancy × resume → score, passed}. По образцу collect-telegram.ts.
 */
import { loadEnv } from "./_env";

loadEnv();

const { matchVacancy, matchAll } = await import("../app/matcher/match");
const { resumeTemplatesRepo } = await import("../app/db/repositories");

interface ParsedArgs {
  vacancy?: number;
  resume?: number;
  all?: boolean;
  threshold?: number;
  max?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--vacancy=")) out.vacancy = Number(arg.split("=")[1]);
    else if (arg.startsWith("--resume=")) out.resume = Number(arg.split("=")[1]);
    else if (arg === "--all") out.all = true;
    else if (arg.startsWith("--threshold=")) out.threshold = Number(arg.split("=")[1]);
    else if (arg.startsWith("--max=")) out.max = Number(arg.split("=")[1]);
  }
  return out;
}

function usage(): void {
  console.error(
    [
      "Использование:",
      "  npm run match -- --vacancy=<id> [--resume=<id>] [--threshold=50]",
      "  npm run match -- --all [--threshold=50] [--max=200]",
      "",
      "Опции:",
      "  --vacancy=<id>   id вакансии; без --resume — по всем активным шаблонам",
      "  --resume=<id>    id резюме-шаблона (только с --vacancy)",
      "  --all            батч: вакансии status='new' × активные шаблоны",
      "  --threshold=<n>  порог создания application (дефолт 50)",
      "  --max=<n>        лимит вакансий в батче",
    ].join("\n"),
  );
}

async function runOne(
  vacancyId: number,
  resumeId: number | undefined,
  threshold?: number,
): Promise<void> {
  const targets =
    resumeId !== undefined
      ? [resumeId]
      : resumeTemplatesRepo.list().filter((r) => r.is_active).map((r) => r.id);

  if (targets.length === 0) {
    console.error("Нет активных шаблонов резюме для скоринга.");
    process.exitCode = 1;
    return;
  }

  const rows: string[] = [];
  let matched = 0;
  for (const rid of targets) {
    const result = await matchVacancy(vacancyId, rid, { threshold });
    if (result.passed) matched++;
    const flag = result.passed ? "✓" : "·";
    const ai = result.aiCalled ? `AI ${result.provider}/${result.model}` : "prefilter-cut";
    rows.push(
      `  vacancy ${result.vacancyId} × resume ${result.resumeTemplateId}: ${result.score.toString().padStart(3)} ${flag}  [${ai}]  ${truncate(result.rationale, 70)}`,
    );
  }
  console.log(`\nМатчинг вакансии ${vacancyId}:`);
  console.log(rows.join("\n"));
  console.log(
    `\nИтого: ${targets.length} пар, ${matched} прошли порог (threshold=${threshold ?? 50}).`,
  );
}

async function runAll(threshold?: number, max?: number): Promise<void> {
  const stats = await matchAll({ threshold, max });
  console.log(`\nБатч-матчинг: ${stats.vacancies} вакансий × активные шаблоны`);
  console.log(
    `  scanned=${stats.scanned}  aiCalls=${stats.aiCalls}  matched=${stats.matched}` +
      (stats.errors.length > 0 ? `  errors=${stats.errors.length}` : ""),
  );
  const passed = stats.results.filter((r) => r.passed);
  if (passed.length > 0) {
    console.log("\nПрошедшие порог:");
    for (const r of passed.sort((a, b) => b.score - a.score)) {
      console.log(
        `  v${r.vacancyId} × r${r.resumeTemplateId}: ${r.score}  ${truncate(r.rationale, 70)}`,
      );
    }
  } else {
    console.log("\nНи одна пара не прошла порог.");
  }
  if (stats.errors.length > 0) {
    console.log("\nОшибки (continue-on-error, прогон продолжен):");
    for (const e of stats.errors) {
      console.log(`  v${e.vacancyId} × r${e.resumeTemplateId}: ${truncate(e.message, 80)}`);
    }
  }
}

function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.all) {
    await runAll(args.threshold, args.max);
    return;
  }

  if (args.vacancy === undefined) {
    console.error("Нужно указать --vacancy=<id> или --all.\n");
    usage();
    process.exitCode = 1;
    return;
  }

  await runOne(args.vacancy, args.resume, args.threshold);
}

await main().catch((err) => {
  console.error("Matcher упал:", err);
  process.exitCode = 1;
});
