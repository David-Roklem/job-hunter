/**
 * CLI сбора вакансий с hh.ru.
 *
 * Запуск: npm run hh:collect -- --source=<id> --profile=<id> [--max=<n>] [--headed]
 *
 * Грузит .env (для db path), читает аргументы, вызывает collectVacancies,
 * печатает статистику. Требует предварительный логин (npm run hh:login).
 */
import { loadEnv } from "./_env";

loadEnv();

const { collectVacancies } = await import("../app/hh/collect");

function parseArgs(argv: string[]): {
  source?: number;
  profile?: number;
  max?: number;
  headed?: boolean;
} {
  const out: { source?: number; profile?: number; max?: number; headed?: boolean } = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--source=")) out.source = Number(arg.split("=")[1]);
    else if (arg.startsWith("--profile=")) out.profile = Number(arg.split("=")[1]);
    else if (arg.startsWith("--max=")) out.max = Number(arg.split("=")[1]);
    else if (arg === "--headed") out.headed = true;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.source === undefined || args.profile === undefined) {
    console.error(
      "Использование: npm run hh:collect -- --source=<id> --profile=<id> [--max=<n>] [--headed]",
    );
    console.error("  --source   id источника в БД (kind=hh)");
    console.error("  --profile  id профиля критериев (search_profiles)");
    console.error("  --max      лимит вакансий (дефолт 20)");
    console.error("  --headed   видимый браузер (debug)");
    process.exit(1);
  }

  console.log("=== hh.ru collect ===\n");
  console.log(`source=${args.source}, profile=${args.profile}, max=${args.max ?? 20}\n`);

  try {
    const stats = await collectVacancies({
      sourceId: args.source,
      profileId: args.profile,
      maxVacancies: args.max,
      headed: args.headed,
    });
    console.log("\n✓ Сбор завершён.");
    console.log(`  собрано:    ${stats.collected}`);
    console.log(`  matched:    ${stats.matched}`);
    console.log(`  rejected:   ${stats.rejected}`);
    console.log(`  дублей:     ${stats.duplicates}`);
    if (stats.captcha) {
      console.log("  ⚠ капча детектнута — повторите логин (npm run hh:login)");
    }
  } catch (err) {
    console.error("\n✗ Ошибка:", err);
    process.exit(1);
  }
}

main();
