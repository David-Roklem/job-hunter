/**
 * CLI: seed source + profile для Wellfound.
 *
 * Запуск: npm run wellfound:seed (idempotent).
 * Логика в app/sources/seed.ts — переиспользуется action /sources.
 */
import { loadEnv } from "./_env";

loadEnv();

const { seedWellfound } = await import("../app/sources/seed");

async function main(): Promise<void> {
  console.log("=== seed wellfound source + profile ===\n");
  const res = seedWellfound();
  console.log(
    `${res.created ? "✓ создано" : "• уже есть"}: source id=${res.source_id}, profile id=${res.profile_id}`,
  );
  console.log("\nДальше:");
  console.log("  npm run wellfound:login");
  console.log(
    `  npm run wellfound:collect -- --source=${res.source_id} --profile=${res.profile_id}`,
  );
}

main();
