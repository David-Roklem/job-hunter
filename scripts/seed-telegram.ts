/**
 * Seed: создать source (telegram) + search_profile + каналы-примеры.
 *
 * Запуск: npm run telegram:seed
 * (idempotent — повторный запуск не дублирует: find-or-create по имени/username).
 *
 * После: npm run telegram:login (если ещё не залогинен),
 *   затем npm run telegram:collect -- --source=<id> --profile=<id>
 *
 * КАНАЛЫ: список реальных @username вакансий-каналов пользователь редактирует
 * под свой рынок. Ниже — закомментированные примеры популярных русскоязычных
 * каналов; раскомментируйте нужные или добавьте свои в массив CHANNEL_USERNAMES.
 */
import { loadEnv } from "./_env";

loadEnv();

const {
  sourcesRepo,
  searchProfilesRepo,
  telegramChannelsRepo,
} = await import("~/db/repositories");

const SOURCE_NAME = "Telegram";
const PROFILE_NAME = "Backend (Telegram)";

/**
 * Каналы вакансий (username без @). Закомментированные — примеры популярных
 * русскоязычных IT-каналов вакансий. РАСКОММЕНТИРУЙТЕ нужные или впишите свои.
 */
const CHANNEL_USERNAMES: Array<{ username: string; title?: string }> = [
  { username: "p_rabota", title: "Python Вакансии Junior/Middle" },
  { username: "geekjobs", title: "Job in IT&Digital" },
  { username: "remotegeekjob", title: "RemoteGeekjob" },

  { username: "forpython", title: "Job for Python" },
  { username: "it_vakansii_jobs", title: "СЕТИ — IT & Digital вакансии" },
  { username: "sparklesjobs", title: "Секретные вакансии в IT и Digital — Sparkles" },
  { username: "zarubezhom_jobs", title: "Connectable Jobs" },

  { username: "Getitrussia", title: "Get IT" },
  { username: "Relocats", title: "IT Relocation (Inflow)" },
  { username: "jobs_juniors_remote", title: "Авоська — junior IT вакансии/cтажировки" },
  { username: "it_jobs_remote", title: "IT вакансии (релокейт, удалёнка)" },
];

async function main(): Promise<void> {
  console.log("=== seed telegram source + profile + channels ===\n");

  // --- Source: find-or-create по имени. ---
  let source = sourcesRepo.list().find((s) => s.name === SOURCE_NAME);
  if (!source) {
    const created = sourcesRepo.create({
      kind: "telegram",
      name: SOURCE_NAME,
      config: { job_role: "backend-engineer" },
    });
    source = sourcesRepo.findById(created.id);
    if (!source) throw new Error("source create failed");
    console.log(`✓ создан source id=${source.id} (kind=telegram)`);
  } else {
    console.log(`• source уже есть: id=${source.id}`);
  }

  // --- Profile: find-or-create по имени. ---
  let profile = searchProfilesRepo.list().find((p) => p.name === PROFILE_NAME);
  if (!profile) {
    profile = searchProfilesRepo.create({
      name: PROFILE_NAME,
      query: "backend", // не используется telegram-сбором (поиск по каналам), но нужно для консистентности
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
        "разработчик",
        "бэкенд",
      ],
      exclude_keywords: ["frontend", "интерн", "стажёр", "новости", "репост"],
      min_salary: null,
      is_active: true,
    });
    console.log(`✓ создан profile id=${profile.id}`);
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

  // --- Channels: find-or-create по username. ---
  if (CHANNEL_USERNAMES.length === 0) {
    console.log(
      "\n⚠ CHANNEL_USERNAMES пуст. Откройте scripts/seed-telegram.ts и",
    );
    console.log(
      "  раскомментируйте/добавьте каналы в массиве CHANNEL_USERNAMES.",
    );
  } else {
    for (const ch of CHANNEL_USERNAMES) {
      const existing = telegramChannelsRepo.findByUsername(ch.username);
      if (existing) {
        console.log(`• канал @${ch.username} уже есть: id=${existing.id}`);
        continue;
      }
      const created = telegramChannelsRepo.create({
        source_id: source.id,
        username: ch.username,
        title: ch.title ?? null,
      });
      console.log(
        `✓ добавлен канал @${ch.username} → telegram_channels id=${created.id}`,
      );
    }
  }

  console.log("\nДальше:");
  console.log("  npm run telegram:login  (если TG_SESSION пуст в .env)");
  console.log(
    `  npm run telegram:collect -- --source=${source.id} --profile=${profile.id}`,
  );
}

main();
