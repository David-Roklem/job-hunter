/**
 * Переиспользуемая seed-логика для источников (фаза ui-control).
 *
 * Вынесена из scripts/seed-{hh,wellfound,telegram}.ts чтобы её можно было
 * вызывать как из CLI, так и из action /sources. Чистые функции, работают
 * с репозиториями, idempotent (find-or-create по имени).
 *
 * Возвращают { source_id, profile_id, created: bool } — caller сам решает,
 * что печатать/логировать.
 */
import {
  sourcesRepo,
  searchProfilesRepo,
  telegramChannelsRepo,
} from "~/db/repositories";
import type { SourceKind } from "~/db/schema";

/** Семантический ярлык источника (для UI/логов). Расширяет SourceKind. */
export type SeedKind = SourceKind | "wellfound";

/** Результат seed-операции. */
export type SeedResult = {
  kind: SeedKind;
  source_id: number;
  profile_id: number;
  created: boolean; // true если хотя бы что-то создано (source или profile).
  channels_added?: number; // для telegram.
};

/** Имена по умолчанию (совпадают с прежними CLI-скриптами — обратная совместимость). */
export const SEED_NAMES = {
  hh: { source: "hh.ru (основной)", profile: "Backend Node.js" },
  wellfound: { source: "Wellfound", profile: "Backend (Wellfound)" },
  telegram: { source: "Telegram", profile: "Backend (Telegram)" },
} as const;

/**
 * Seed hh: source (kind=hh) + search_profile под Node.js backend.
 * Idempotent: повторный вызов не дублирует, возвращает существующие id.
 */
export function seedHh(): SeedResult {
  const names = SEED_NAMES.hh;
  let created = false;

  let source = sourcesRepo.list().find((s) => s.name === names.source);
  if (!source) {
    const row = sourcesRepo.create({ kind: "hh", name: names.source, config: {} });
    source = sourcesRepo.findById(row.id);
    if (!source) throw new Error("hh source create failed");
    created = true;
  }

  let profile = searchProfilesRepo.list().find((p) => p.name === names.profile);
  if (!profile) {
    const row = searchProfilesRepo.create({
      name: names.profile,
      query: "Node.js backend разработчик",
      areas: ["1"], // 1 = Москва
      employment_types: ["full"],
      include_keywords: ["node.js", "node js", "backend"],
      exclude_keywords: ["frontend", "стажёр", "intern", "junior"],
      min_salary: null,
      is_active: true,
    });
    // create() возвращает raw SearchProfile — нужен id; перечитывать не обязательно.
    profile = searchProfilesRepo.findById(row.id);
    if (!profile) throw new Error("hh profile create failed");
    created = true;
  }

  // Связать profile с source.
  if (source.config.search_profile_id !== profile.id) {
    sourcesRepo.update(source.id, {
      config: { ...source.config, search_profile_id: profile.id },
    });
  }

  return { kind: "hh", source_id: source.id, profile_id: profile.id, created };
}

/**
 * Seed Wellfound: source (kind=aggregator) + search_profile.
 * Idempotent. Англоязычные критерии под международный рынок.
 */
export function seedWellfound(): SeedResult {
  const names = SEED_NAMES.wellfound;
  let created = false;

  let source = sourcesRepo.list().find((s) => s.name === names.source);
  if (!source) {
    const row = sourcesRepo.create({
      kind: "aggregator",
      name: names.source,
      config: {
        job_role: "backend-engineer",
        location: "Remote",
        remote_only: true,
      },
    });
    source = sourcesRepo.findById(row.id);
    if (!source) throw new Error("wellfound source create failed");
    created = true;
  }

  let profile = searchProfilesRepo.list().find((p) => p.name === names.profile);
  if (!profile) {
    const row = searchProfilesRepo.create({
      name: names.profile,
      query: "backend engineer",
      areas: [],
      employment_types: ["full"],
      include_keywords: ["backend", "node", "node.js", "python", "golang", "engineer", "api"],
      exclude_keywords: ["frontend", "intern", "internship", "junior"],
      min_salary: null,
      is_active: true,
    });
    profile = searchProfilesRepo.findById(row.id);
    if (!profile) throw new Error("wellfound profile create failed");
    created = true;
  }

  if (source.config.search_profile_id !== profile.id) {
    sourcesRepo.update(source.id, {
      config: { ...source.config, search_profile_id: profile.id },
    });
  }

  return { kind: "wellfound", source_id: source.id, profile_id: profile.id, created };
}

/**
 * Дефолтный список telegram-каналов вакансий (русскоязычные IT).
 * Пользователь редактирует под свой рынок через /sources или CLI.
 */
export const DEFAULT_TELEGRAM_CHANNELS: Array<{ username: string; title?: string }> = [
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

/**
 * Seed Telegram: source (kind=telegram) + search_profile + каналы по умолчанию.
 *
 * channels: можно передать свой список; по умолчанию DEFAULT_TELEGRAM_CHANNELS.
 * Idempotent: существующие каналы по username пропускаются.
 */
export function seedTelegram(
  channels: Array<{ username: string; title?: string }> = DEFAULT_TELEGRAM_CHANNELS,
): SeedResult {
  const names = SEED_NAMES.telegram;
  let created = false;

  let source = sourcesRepo.list().find((s) => s.name === names.source);
  if (!source) {
    const row = sourcesRepo.create({
      kind: "telegram",
      name: names.source,
      config: { job_role: "backend-engineer" },
    });
    source = sourcesRepo.findById(row.id);
    if (!source) throw new Error("telegram source create failed");
    created = true;
  }

  let profile = searchProfilesRepo.list().find((p) => p.name === names.profile);
  if (!profile) {
    const row = searchProfilesRepo.create({
      name: names.profile,
      query: "backend",
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
    profile = searchProfilesRepo.findById(row.id);
    if (!profile) throw new Error("telegram profile create failed");
    created = true;
  }

  if (source.config.search_profile_id !== profile.id) {
    sourcesRepo.update(source.id, {
      config: { ...source.config, search_profile_id: profile.id },
    });
  }

  // Каналы: find-or-create по username.
  let channelsAdded = 0;
  for (const ch of channels) {
    if (telegramChannelsRepo.findByUsername(ch.username)) continue;
    telegramChannelsRepo.create({
      source_id: source.id,
      username: ch.username,
      title: ch.title ?? null,
    });
    channelsAdded += 1;
    created = true;
  }

  return {
    kind: "telegram",
    source_id: source.id,
    profile_id: profile.id,
    created,
    channels_added: channelsAdded,
  };
}

/**
 * Диспетчер по kind — удобно из action /sources.
 * kind="aggregator" трактуется как wellfound (единственный aggregator сейчас).
 */
export function seedByKind(kind: SourceKind): SeedResult {
  if (kind === "hh") return seedHh();
  if (kind === "aggregator") return seedWellfound();
  if (kind === "telegram") return seedTelegram();
  // kind="company" — нет дефолтного seed; caller создаёт вручную.
  throw new Error(`seed для kind="${kind}" не реализован (нет дефолта)`);
}
