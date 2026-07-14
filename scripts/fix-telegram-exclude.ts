/**
 * Одноразовая правка exclude-ключевых слов профиля id=3 (Backend Telegram).
 *
 * Добавляет английские варианты стажёрских позиций (intern/junior/graduate/
 * trainee), которые проходят через русский-only exclude. Запускать ОДИН раз.
 *
 * После: новые посты с intern/junior будут rejected. Уже собранные вакансии
 * сохраняют свой статус (matcher фазы 08 пересчитает релевантность позже).
 *
 * Запуск: npm run telegram:fix-exclude
 */
import { loadEnv } from "./_env";

loadEnv();

const { searchProfilesRepo } = await import("~/db/repositories");

const PROFILE_ID = 3;
const ADD_EXCLUDE = ["intern", "internship", "junior", "graduate", "trainee"];

async function main(): Promise<void> {
  const profile = searchProfilesRepo.findById(PROFILE_ID);
  if (!profile) {
    console.error(`✗ profile ${PROFILE_ID} not found`);
    process.exitCode = 1;
    return;
  }

  console.log(`=== fix exclude for profile ${PROFILE_ID} (${profile.name}) ===\n`);
  console.log(`было exclude: ${JSON.stringify(profile.exclude_keywords)}`);

  // Мержим без дублей, сохраняя порядок (существующие → новые).
  const existing = new Set(profile.exclude_keywords.map((k) => k.toLowerCase()));
  const added = ADD_EXCLUDE.filter((k) => !existing.has(k.toLowerCase()));
  const merged = [...profile.exclude_keywords, ...added];

  searchProfilesRepo.update(PROFILE_ID, { exclude_keywords: merged });
  console.log(`стало exclude: ${JSON.stringify(merged)}`);
  console.log(`\n✓ добавлено: ${added.length > 0 ? added.join(", ") : "(ничего — уже были)"}`);
}

main();
