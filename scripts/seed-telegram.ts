/**
 * CLI: seed source + profile + каналы-примеры для Telegram.
 *
 * Запуск: npm run telegram:seed (idempotent).
 * Логика в app/sources/seed.ts — переиспользуется action /sources.
 *
 * КАНАЛЫ: по умолчанию DEFAULT_TELEGRAM_CHANNELS из app/sources/seed.ts
 * (русскоязычные IT). Отредактируйте под свой рынок в /sources или тут.
 */
import { loadEnv } from "./_env";

loadEnv();

const { seedTelegram, DEFAULT_TELEGRAM_CHANNELS } = await import(
  "../app/sources/seed"
);

async function main(): Promise<void> {
  console.log("=== seed telegram source + profile + channels ===\n");
  const res = seedTelegram(DEFAULT_TELEGRAM_CHANNELS);
  console.log(
    `${res.created ? "✓ создано" : "• уже есть"}: source id=${res.source_id}, profile id=${res.profile_id}`,
  );
  if (res.channels_added !== undefined && res.channels_added > 0) {
    console.log(`✓ добавлено каналов: ${res.channels_added}`);
  }
  console.log(`  всего каналов по умолчанию: ${DEFAULT_TELEGRAM_CHANNELS.length}`);
  console.log("\nДальше:");
  console.log("  npm run telegram:login  (если TG_SESSION пуст в .env)");
  console.log(
    `  npm run telegram:collect -- --source=${res.source_id} --profile=${res.profile_id}`,
  );
}

main();
