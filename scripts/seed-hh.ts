/**
 * CLI: seed source + profile для hh.ru.
 *
 * Запуск: npm run hh:seed (idempotent).
 * Логика в app/sources/seed.ts — переиспользуется action /sources.
 */
import { loadEnv } from "./_env";

loadEnv();

const { seedHh } = await import("../app/sources/seed");

async function main(): Promise<void> {
  console.log("=== seed hh source + profile ===\n");
  const res = seedHh();
  console.log(
    `${res.created ? "✓ создано" : "• уже есть"}: source id=${res.source_id}, profile id=${res.profile_id}`,
  );
  console.log("\nДальше:");
  console.log("  npm run hh:login");
  console.log(`  npm run hh:collect -- --source=${res.source_id} --profile=${res.profile_id}`);
}

main();
