/**
 * Оркестратор сбора вакансий с hh.ru.
 *
 * Основной цикл: страницы поиска → карточки → детальные страницы →
 * include/exclude фильтр → запись в БД (с дедупликацией). Анти-детект
 * уровень 2: stealth (в session.ts) + поведенческая имитация (human.ts) +
 * задержки + детект капчи.
 *
 * Синхронный (один прогон). Очередь/планировщик — фаза 12.
 */
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { companies, type EmploymentType } from "~/db/schema";
import {
  searchProfilesRepo,
  sourcesRepo,
  vacanciesRepo,
} from "~/db/repositories";
import { filterVacancy } from "./filter";
import { humanDelay, humanPretend, humanScroll } from "./human";
import {
  parseSalary,
  parseSearchResults,
  parseVacancyDetail,
} from "./parsers";
import { HH_SEARCH_URL, isCaptchaUrl } from "./selectors";
import { createContext } from "./session";

/** Ошибка капчи — graceful exit, не падать. */
export class HhCaptchaError extends Error {
  constructor(message = "hh.ru показал капчу — повторите логин (npm run hh:login) или снизьте частоту") {
    super(message);
    this.name = "HhCaptchaError";
  }
}

export type CollectOptions = {
  sourceId: number;
  profileId: number;
  /** Лимит вакансий за прогон (дефолт 20 — безопасный для dev). */
  maxVacancies?: number;
  /** Видимый браузер (debug). По умолчанию false (headless). */
  headed?: boolean;
  /** Макс. страниц поиска (дефолт 3). */
  maxPages?: number;
};

export type CollectStats = {
  collected: number;
  matched: number;
  rejected: number;
  duplicates: number;
  captcha: boolean;
};

const DEFAULT_MAX_VACANCIES = 20;
const DEFAULT_MAX_PAGES = 3;
/** Задержка между детальными страницами (анти-лимит), мс. */
const DETAIL_DELAY_MS: [number, number] = [3000, 7000];
/** Задержка между страницами поиска, мс. */
const PAGE_DELAY_MS: [number, number] = [2000, 5000];

/**
 * Собрать вакансии по профилю критериев.
 */
export async function collectVacancies(
  opts: CollectOptions,
): Promise<CollectStats> {
  const source = sourcesRepo.findById(opts.sourceId);
  if (!source) {
    throw new Error(`source ${opts.sourceId} not found`);
  }
  if (source.kind !== "hh") {
    throw new Error(`source ${opts.sourceId} is not kind="hh" (got "${source.kind}")`);
  }
  const profile = searchProfilesRepo.findById(opts.profileId);
  if (!profile) {
    throw new Error(`search_profile ${opts.profileId} not found`);
  }

  const maxVacancies = opts.maxVacancies ?? DEFAULT_MAX_VACANCIES;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const stats: CollectStats = {
    collected: 0,
    matched: 0,
    rejected: 0,
    duplicates: 0,
    captcha: false,
  };

  const context = await createContext({ headed: opts.headed });
  try {
    const page = await context.newPage();
    let collected = 0;

    for (let pageNum = 0; pageNum < maxPages && collected < maxVacancies; pageNum++) {
      const url = buildSearchUrl(profile, pageNum);
      await humanPretend(page);
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });

      // Детект капчи.
      if (isCaptchaUrl(page.url()) || response?.status() === 403) {
        stats.captcha = true;
        throw new HhCaptchaError();
      }

      const searchHtml = await page.content();
      const { cards } = parseSearchResults(searchHtml);

      for (const card of cards) {
        if (collected >= maxVacancies) break;
        if (vacanciesRepo.findByExternalId(source.id, card.external_id)) {
          stats.duplicates++;
          continue;
        }

        // Детальная страница (с задержкой + поведением).
        await humanDelay(...DETAIL_DELAY_MS);
        await humanPretend(page);
        const detailResp = await page.goto(card.url, { waitUntil: "domcontentloaded" });
        if (isCaptchaUrl(page.url()) || detailResp?.status() === 403) {
          stats.captcha = true;
          throw new HhCaptchaError();
        }
        const detailHtml = await page.content();
        const { description, key_skills } = parseVacancyDetail(detailHtml);

        // Фильтр include/exclude.
        const status = filterVacancy(
          { title: card.title, description, key_skills },
          profile,
        );

        // Компания (find-or-create по имени; hh_id не извлекаем здесь).
        const company_id = card.company_name
          ? findOrCreateCompany(card.company_name)
          : null;

        // Запись вакансии (идемпотентно через onConflictDoNothing).
        const salary = parseSalary(card.salary_text ?? "");
        const created = vacanciesRepo.create({
          source_id: source.id,
          external_id: card.external_id,
          company_id,
          title: card.title,
          description,
          salary_from: salary.from ?? null,
          salary_to: salary.to ?? null,
          currency: salary.currency ?? null,
          location: card.location ?? null,
          employment_type: pickEmploymentType(profile.employment_types),
          url: card.url,
          raw: { salary_text: card.salary_text, key_skills },
          collected_at: new Date(),
        });

        // Выставить статус фильтра (create ставит дефолт "new").
        vacanciesRepo.update(created.id, { status });

        stats.collected++;
        if (status === "matched") stats.matched++;
        else stats.rejected++;
        collected++;
      }

      if (pageNum < maxPages - 1) {
        await humanScroll(page);
        await humanDelay(...PAGE_DELAY_MS);
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  return stats;
}

/** Собрать URL поиска hh по профилю. */
function buildSearchUrl(
  profile: { query: string; areas: string[]; employment_types: EmploymentType[] },
  pageNum: number,
): string {
  const params = new URLSearchParams();
  params.set("text", profile.query);
  // area — id региона (берём первый; hh поддерживает несколько через &area=).
  for (const area of profile.areas) {
    params.append("area", area);
  }
  // employment (hh-коды: full=full_time, part=part_time, project=project).
  for (const et of profile.employment_types) {
    params.append("employment", hhEmploymentCode(et));
  }
  params.set("page", String(pageNum)); // hh пагинация 0-indexed.
  return `${HH_SEARCH_URL}?${params.toString()}`;
}

/** Маппинг нашего enum employmentTypes → код hh. */
function hhEmploymentCode(et: EmploymentType): string {
  switch (et) {
    case "full": return "full";
    case "part": return "part";
    case "contract": return "probation";
    case "project": return "project";
  }
}

/** Найти компанию по имени, иначе создать. Возвращает company_id. */
function findOrCreateCompany(name: string): number | null {
  const existing = db
    .select()
    .from(companies)
    .where(eq(companies.name, name))
    .get();
  if (existing) return existing.id;
  const created = db
    .insert(companies)
    .values({ name })
    .returning()
    .get();
  return created.id;
}

/**
 * Выбрать тип занятости для вакансии (из разрешённых в профиле).
 * Берём первый; hh не отдаёт точный тип в карточке, фильтр — на уровне поиска.
 */
function pickEmploymentType(
  types: EmploymentType[],
): EmploymentType | undefined {
  return types[0];
}
