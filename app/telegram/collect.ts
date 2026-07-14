/**
 * Оркестратор сбора вакансий из Telegram-каналов (фаза 07).
 *
 * Основной цикл (аналог app/hh/collect.ts): для каждого активного канала →
 * fetch новых постов (message_id > last_message_id) → парсинг скелета +
 * AI-зарплата → include/exclude фильтр → запись в vacancies (с дедупликацией
 * по source_id+message_id) → обновление курсора канала.
 *
 * Без браузера/анти-бота: MTProto через gramjs. Троттлинг — sleep между
 * каналами + ловля FloodWaitError (Telegram сам регулирует MTProto-частоту).
 *
 * Синхронный (один прогон). Очередь/планировщик — фаза 12.
 */
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { companies } from "~/db/schema";
import {
  searchProfilesRepo,
  sourcesRepo,
  telegramChannelsRepo,
  vacanciesRepo,
} from "~/db/repositories";
import { filterVacancy } from "~/hh/filter";
import { createTelegramClient } from "./client";
import { fetchNewPosts, type ChannelPost } from "./fetch";
import { parsePost } from "./parsers";
import { parseSalaryAi } from "./salary";
import type { Api } from "telegram";
import type { TelegramClient } from "telegram";

/** Ошибка троттлинга Telegram — нужно подождать и повторить позже. */
export class TelegramFloodError extends Error {
  constructor(
    message: string,
    readonly waitSeconds: number,
  ) {
    super(message);
    this.name = "TelegramFloodError";
  }
}

export type CollectOptions = {
  sourceId: number;
  profileId: number;
  /** Лимит вакансий за прогон (дефолт 50). */
  maxVacancies?: number;
  /** Лимит постов на канал за вызов (дефолт 50 — анти-флуд). */
  postsPerChannel?: number;
  /**
   * Ограничить сбор конкретными каналами (username без @). Иначе — все активные
   * каналы этого source.
   */
  channels?: string[];
  /**
   * Тестовый внедряемый client (мок gramjs). В реальном запуске не задаётся —
   * client создаётся из env (TG_SESSION).
   */
  client?: TelegramClient;
  /**
   * Внедряемый AI-провайдер (для тестов). Дефолт — z.ai синглтон (в salary.ts).
   * Здесь не параметризуется явно, чтобы не дублировать сигнатуру parseSalaryAi.
   */
};

export type CollectStats = {
  collected: number;
  matched: number;
  rejected: number;
  duplicates: number;
  /** Каналы, обработанные в этом прогоне. */
  channels: number;
  /** FloodWait пойман — сбор прерван досрочно, повторить позже. */
  flood: boolean;
};

const DEFAULT_MAX_VACANCIES = 50;
const DEFAULT_POSTS_PER_CHANNEL = 50;
/** Задержка между каналами (анти-флуд), мс. */
const CHANNEL_DELAY_MS: [number, number] = [300, 800];

/**
 * Собрать вакансии из Telegram-каналов по профилю критериев.
 *
 * @throws Error если source/profile не найдены или source не kind="telegram".
 *         НЕ бросает при FloodWait — возвращает stats с flood:true.
 */
export async function collectVacancies(
  opts: CollectOptions,
): Promise<CollectStats> {
  const source = sourcesRepo.findById(opts.sourceId);
  if (!source) throw new Error(`source ${opts.sourceId} not found`);
  if (source.kind !== "telegram") {
    throw new Error(
      `source ${opts.sourceId} is not kind="telegram" (got "${source.kind}")`,
    );
  }
  const profile = searchProfilesRepo.findById(opts.profileId);
  if (!profile) throw new Error(`search_profile ${opts.profileId} not found`);

  const maxVacancies = opts.maxVacancies ?? DEFAULT_MAX_VACANCIES;
  const postsPerChannel = opts.postsPerChannel ?? DEFAULT_POSTS_PER_CHANNEL;

  // Каналы: либо явно заданные, либо все активные этого source.
  let channels = telegramChannelsRepo.list({
    sourceId: source.id,
    active: true,
  });
  if (opts.channels && opts.channels.length > 0) {
    const wanted = new Set(opts.channels);
    channels = channels.filter((c) => wanted.has(c.username));
  }

  const stats: CollectStats = {
    collected: 0,
    matched: 0,
    rejected: 0,
    duplicates: 0,
    channels: 0,
    flood: false,
  };

  if (channels.length === 0) {
    return stats;
  }

  // Подключение к Telegram (создаётся здесь, если не внедрён client).
  const client = opts.client ?? createTelegramClient();
  const ownsClient = opts.client === undefined; // закрываем только свой.
  if (ownsClient) await client.connect();

  try {
    let collected = 0;
    for (const channel of channels) {
      if (collected >= maxVacancies) break;

      let posts: ChannelPost[];
      let maxId: number;
      try {
        const result = await fetchNewPosts(
          client,
          channel.username,
          channel.last_message_id,
          postsPerChannel,
        );
        posts = result.posts;
        maxId = result.maxId;
      } catch (err) {
        if (isFloodWait(err)) {
          stats.flood = true;
          break; // досрочно — повторить позже
        }
        throw err;
      }

      stats.channels++;

      for (const post of posts) {
        if (collected >= maxVacancies) break;

        // Дедупликация: source_id + message_id (external_id).
        const externalId = String(post.messageId);
        if (vacanciesRepo.findByExternalId(source.id, externalId)) {
          stats.duplicates++;
          continue;
        }

        // Парсинг скелета + зарплата (AI, может быть null/медленным).
        const parsed = parsePost(post, channel.username);
        const salary = await parseSalaryAi(post.text).catch(() => null);

        // Бинарный include/exclude фильтр (общий с hh).
        const status = filterVacancy(
          { title: parsed.title, description: parsed.description, key_skills: [] },
          profile,
        );

        // Компания: канал = «работодатель» (часто так; имя канала как имя компании).
        const company_id = channel.title
          ? findOrCreateCompany(channel.title)
          : null;

        const created = vacanciesRepo.create({
          source_id: source.id,
          external_id: externalId,
          company_id,
          title: parsed.title,
          description: parsed.description,
          salary_from: salary?.from ?? null,
          salary_to: salary?.to ?? null,
          currency: salary?.currency ?? null,
          location: parsed.location,
          url: parsed.url,
          raw: {
            contacts: parsed.contacts,
            channel_username: channel.username,
            message_id: post.messageId,
            date: post.date,
          },
          collected_at: new Date(),
        });

        // Статус фильтра (create ставит дефолт "new").
        vacanciesRepo.update(created.id, { status });

        stats.collected++;
        if (status === "matched") stats.matched++;
        else stats.rejected++;
        collected++;
      }

      // Курсор обновляем даже если не дошли до лимита — посты прочитаны.
      if (maxId > channel.last_message_id) {
        telegramChannelsRepo.updateCursor(channel.id, maxId);
      }

      // Задержка между каналами.
      await sleep(randomBetween(...CHANNEL_DELAY_MS));
    }
  } finally {
    if (ownsClient) await client.disconnect().catch(() => {});
  }

  return stats;
}

/** Найти компанию по имени, иначе создать. Возвращает company_id. */
function findOrCreateCompany(name: string): number | null {
  const existing = db.select().from(companies).where(eq(companies.name, name)).get();
  if (existing) return existing.id;
  const created = db.insert(companies).values({ name }).returning().get();
  return created.id;
}

/** Распознать FloodWaitError gramjs и извлечь секунды ожидания. */
function isFloodWait(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // gramjs: "A wait of X seconds is required before..." (RpcError FLOOD_WAIT_%d)
  return /wait of \d+ seconds is required/i.test(err.message) || /FloodWait/i.test(err.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

/** Экспорт для тестов (импортируетсяAiProvider-мок). */
export type { Api };
