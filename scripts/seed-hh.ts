/**
 * Seed: создать source (hh) + search_profile для первого прогона сбора.
 *
 * Запуск: npm run hh:seed
 * (idempotent — если source/profile с таким именем есть, пропускает).
 *
 * После: npm run hh:login, затем npm run hh:collect -- --source=<id> --profile=<id>.
 */
import { loadEnv } from "./_env";

loadEnv();

const { sourcesRepo, searchProfilesRepo } = await import(
  "~/db/repositories"
);

const SOURCE_NAME = "hh.ru (основной)";
const PROFILE_NAME = "Backend Node.js";

async function main(): Promise<void> {
  console.log("=== seed hh source + profile ===\n");

  // Source: find-or-create по имени.
  const sources = sourcesRepo.list();
  let source = sources.find((s) => s.name === SOURCE_NAME);
  if (!source) {
    source = sourcesRepo.create({ kind: "hh", name: SOURCE_NAME, config: {} });
    console.log(`✓ создан source id=${source.id} (kind=hh, name="${SOURCE_NAME}")`);
  } else {
    console.log(`• source уже есть: id=${source.id}`);
  }

  // Profile: find-or-create по имени.
  const profiles = searchProfilesRepo.list();
  let profile = profiles.find((p) => p.name === PROFILE_NAME);
  if (!profile) {
    profile = searchProfilesRepo.create({
      name: PROFILE_NAME,
      query: "Node.js backend разработчик",
      areas: ["1"], // 1 = Москва (id региона hh). Дополните: 2 = СПб.
      employment_types: ["full"],
      include_keywords: ["node.js", "node js", "backend"],
      exclude_keywords: ["frontend", "стажёр", "intern", "junior"],
      min_salary: null,
      is_active: true,
    });
    console.log(`✓ создан profile id=${profile.id} (name="${PROFILE_NAME}")`);
  } else {
    console.log(`• profile уже есть: id=${profile.id}`);
  }

  console.log("\nДальше:");
  console.log(`  npm run hh:login`);
  console.log(`  npm run hh:collect -- --source=${source.id} --profile=${profile.id}`);
  console.log(`  npm run hh:stealth-check   # (опционально) проверить анти-детект`);
}

main();
