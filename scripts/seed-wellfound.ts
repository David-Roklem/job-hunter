/**
 * Seed: создать source (aggregator) + search_profile для Wellfound.
 *
 * Запуск: npm run wellfound:seed
 * (idempotent — если source/profile с таким именем есть, пропускает).
 *
 * После: npm run wellfound:login, затем
 *   npm run wellfound:collect -- --source=<id> --profile=<id>
 */
import { loadEnv } from "./_env";

loadEnv();

const { sourcesRepo, searchProfilesRepo } = await import(
  "~/db/repositories"
);

const SOURCE_NAME = "Wellfound";
const PROFILE_NAME = "Backend (Wellfound)";

async function main(): Promise<void> {
  console.log("=== seed wellfound source + profile ===\n");

  // Source: find-or-create по имени. kind=aggregator (новое значение из фазы 06).
  const sources = sourcesRepo.list();
  let source = sources.find((s) => s.name === SOURCE_NAME);
  if (!source) {
    source = sourcesRepo.create({
      kind: "aggregator",
      name: SOURCE_NAME,
      config: {
        // search_profile_id проставляется ниже после создания профиля.
        job_role: "backend-engineer",
        location: "Remote",
        remote_only: true,
      },
    });
    console.log(
      `✓ создан source id=${source.id} (kind=aggregator, name="${SOURCE_NAME}")`,
    );
  } else {
    console.log(`• source уже есть: id=${source.id}`);
  }

  // Profile: find-or-create по имени.
  // Критерии под международный рынок: include по backend-рольным словам,
  // exclude — «frontend-only», стажировки. Английский текст ключевых слов
  // (Wellfound — англоязычная площадка).
  const profiles = searchProfilesRepo.list();
  let profile = profiles.find((p) => p.name === PROFILE_NAME);
  if (!profile) {
    profile = searchProfilesRepo.create({
      name: PROFILE_NAME,
      query: "backend engineer",
      // Wellfound — глобальная площадка, area не применима (как у hh).
      areas: [],
      employment_types: ["full"],
      include_keywords: [
        "backend",
        "node",
        "node.js",
        "python",
        "golang",
        "engineer",
        "api",
      ],
      exclude_keywords: ["frontend", "intern", "internship", "junior"],
      min_salary: null,
      is_active: true,
    });
    console.log(`✓ создан profile id=${profile.id} (name="${PROFILE_NAME}")`);
  } else {
    console.log(`• profile уже есть: id=${profile.id}`);
  }

  // Связать profile с source через config.search_profile_id.
  if (source.config.search_profile_id !== profile.id) {
    sourcesRepo.update(source.id, {
      config: { ...source.config, search_profile_id: profile.id },
    });
    console.log(`✓ source.config.search_profile_id = ${profile.id}`);
  }

  console.log("\nДальше:");
  console.log(`  npm run wellfound:login`);
  console.log(
    `  npm run wellfound:collect -- --source=${source.id} --profile=${profile.id}`,
  );
}

main();
