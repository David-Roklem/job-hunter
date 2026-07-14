/**
 * Просмотр последних собранных вакансий (для ручного smoke/дебага).
 *
 * Запуск:
 *   npm run vacancies:list              — последние 20
 *   npm run vacancies:list -- --status=matched   — только matched
 *   npm run vacancies:list -- --limit=50
 *
 * Использует репозиторий напрямую (без sqlite3 CLI). Не требует env (БД-чтение).
 */
import { loadEnv } from "./_env";

loadEnv();

const { vacanciesRepo } = await import("~/db/repositories");

function parseArgs(argv: string[]): { status?: string; limit?: number } {
  const out: { status?: string; limit?: number } = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--status=")) out.status = arg.split("=")[1];
    else if (arg.startsWith("--limit=")) out.limit = Number(arg.split("=")[1]);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const limit = args.limit ?? 20;

  const vacancies = await vacanciesRepo.list(
    args.status ? { status: args.status as never, limit } : { limit },
  );

  if (vacancies.length === 0) {
    console.log("Вакансий не найдено.");
    return;
  }

  console.log(`Найдено вакансий (показаны последние ${vacancies.length}):\n`);
  console.log(
    "id   | status   | salary              | location   | title",
  );
  console.log("-".repeat(110));

  for (const v of [...vacancies].reverse()) {
    const salary = [v.salary_from, v.salary_to]
      .filter((x) => x !== null)
      .map((x) => String(x))
      .join("–");
    const salaryStr = salary ? `${salary} ${v.currency ?? ""}`.trim() : "—";
    const title = v.title.length > 50 ? `${v.title.slice(0, 49)}…` : v.title;
    const location = (v.location ?? "—").padEnd(10);
    console.log(
      `${String(v.id).padEnd(4)} | ${v.status.padEnd(8)} | ${salaryStr.padEnd(19)} | ${location} | ${title}`,
    );
  }

  console.log(
    `\nДетально по id: sqlite3 data/job_hunter.sqlite "SELECT * FROM vacancies WHERE id=N;"`,
  );
}

main();
