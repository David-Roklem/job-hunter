/**
 * CLI сбора вакансий из Telegram-каналов.
 *
 * Запуск:
 *   npm run telegram:collect -- --source=<id> --profile=<id> [--max=<n>] [--channels=u1,u2]
 *
 * Грузит .env (TG_SESSION обязателен), читает аргументы, вызывает collectVacancies,
 * печатает статистику. Требует предварительный логин (npm run telegram:login).
 *
 * В реальной сети читает публиччные каналы под user-аккаунтом. Анти-флуд
 * Telegram регулируется gramjs автоматически + sleep между каналами.
 */
import { loadEnv } from "./_env";

loadEnv();

const { collectVacancies } = await import("../app/telegram/collect");

function parseArgs(argv: string[]): {
  source?: number;
  profile?: number;
  max?: number;
  channels?: string[];
} {
  const out: { source?: number; profile?: number; max?: number; channels?: string[] } = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--source=")) out.source = Number(arg.split("=")[1]);
    else if (arg.startsWith("--profile=")) out.profile = Number(arg.split("=")[1]);
    else if (arg.startsWith("--max=")) out.max = Number(arg.split("=")[1]);
    else if (arg.startsWith("--channels=")) {
      out.channels = arg
        .split("=")[1]!
        .split(",")
        .map((s) => s.trim().replace(/^@/, ""))
        .filter(Boolean);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.source === undefined || args.profile === undefined) {
    console.error(
      "Использование: npm run telegram:collect -- --source=<id> --profile=<id> [--max=<n>] [--channels=u1,u2]",
    );
    console.error("  --source    id источника в БД (kind=telegram)");
    console.error("  --profile   id профиля критериев (search_profiles)");
    console.error("  --max       лимит вакансий (дефолт 50)");
    console.error("  --channels  ограничить конкретными каналами (username без @)");
    process.exit(1);
  }

  console.log("=== Telegram collect ===\n");
  console.log(
    `source=${args.source}, profile=${args.profile}, max=${args.max ?? 50}`,
  );
  if (args.channels) console.log(`channels: ${args.channels.join(", ")}`);
  console.log("");

  try {
    const stats = await collectVacancies({
      sourceId: args.source,
      profileId: args.profile,
      maxVacancies: args.max,
      channels: args.channels,
    });
    console.log("\n✓ Сбор завершён.");
    console.log(`  каналов:     ${stats.channels}`);
    console.log(`  собрано:     ${stats.collected}`);
    console.log(`  matched:     ${stats.matched}`);
    console.log(`  rejected:    ${stats.rejected}`);
    console.log(`  дублей:      ${stats.duplicates}`);
    if (stats.flood) {
      console.log(
        "  ⚠ Telegram FloodWait — сбор прерван досрочно. Повторите позже.",
      );
    }
  } catch (err) {
    console.error("\n✗ Ошибка:", err);
    process.exitCode = 1;
  }
}

main();
