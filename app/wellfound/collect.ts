/**
 * Оркестратор сбора вакансий с Wellfound (wellfound.com).
 *
 * Основной цикл: страницы поиска → ожидание рендера (SPA!) → карточки →
 * детальные страницы → include/exclude фильтр → запись в БД (с дедупликацией).
 *
 * Переиспользует инфраструктуру фазы 05:
 *  - app/hh/filter.ts → filterVacancy (бинарный matched/rejected)
 *  - app/hh/human.ts → поведенческая имитация + задержки (анти-бот)
 *  - app/browser/session.ts → Camoufox persistent context (geoip + humanize)
 *  - таблицы vacancies/companies, репозитории
 *
 * Отличия от hh/collect.ts:
 *  - Wellfound = React SPA → waitForSelector карточки перед page.content()
 *    (DOM рендерится после networkidle, domcontentloaded отдаёт пустой shell)
 *  - своя сессия (data/wellfound-profile, en-US)
 *  - error типа WellfoundBlockError (анти-бот Cloudflare) вместо капчи
 *  - external_id из URL /jobs/<id>-<slug>
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
import { filterVacancy } from "~/hh/filter";
import { humanDelay, humanPretend, humanScroll } from "~/hh/human";
import {
  parseSalary,
  parseSearchResults,
  parseVacancyDetail,
} from "./parsers";
import { WF_SEARCH_URL, isBlockUrl } from "./selectors";
import { createContext } from "./session";

/** Ошибка анти-бот блокировки — graceful exit, не падать. */
export class WellfoundBlockError extends Error {
  constructor(
    message = "Wellfound показал анти-бот страницу (Cloudflare?) — повторите логин (npm run wellfound:login) или снизьте частоту",
  ) {
    super(message);
    this.name = "WellfoundBlockError";
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
  blocked: boolean;
};

const DEFAULT_MAX_VACANCIES = 20;
const DEFAULT_MAX_PAGES = 3;
/** Задержка между детальными страницами (анти-лимит), мс. */
const DETAIL_DELAY_MS: [number, number] = [3000, 7000];
/** Задержка между страницами поиска, мс. */
const PAGE_DELAY_MS: [number, number] = [2000, 5000];
/** Таймаут ожидания рендера SPA-карточки, мс. */
const SPA_WAIT_TIMEOUT_MS = 15000;

/**
 * Собрать вакансии Wellfound по профилю критериев.
 */
export async function collectVacancies(
  opts: CollectOptions,
): Promise<CollectStats> {
  const source = sourcesRepo.findById(opts.sourceId);
  if (!source) {
    throw new Error(`source ${opts.sourceId} not found`);
  }
  if (source.kind !== "aggregator") {
    throw new Error(
      `source ${opts.sourceId} is not kind="aggregator" (got "${source.kind}")`,
    );
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
    blocked: false,
  };

  const context = await createContext({ headed: opts.headed });
  try {
    const page = await context.newPage();
    let collected = 0;

    for (let pageNum = 0; pageNum < maxPages && collected < maxVacancies; pageNum++) {
      const url = buildSearchUrl(profile, pageNum, source.config);
      await humanPretend(page);
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });

      // Детект анти-бот блокировки (Cloudflare challenge и т.п.).
      if (isBlockUrl(page.url()) || response?.status() === 403) {
        stats.blocked = true;
        throw new WellfoundBlockError();
      }

      // SPA: ждём рендера карточек перед чтением HTML.
      // Если карточек нет (пустая выдача/смена вёрстки) — page.content() отдаст
      // shell, parseSearchResults вернёт []. Не ошибка, просто выходим из цикла.
      await page
        .waitForSelector('[data-testid="job-listing"]', {
          timeout: SPA_WAIT_TIMEOUT_MS,
        })
        .catch(() => {});

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
        const detailUrl = absoluteUrl(card.url);
        const detailResp = await page.goto(detailUrl, {
          waitUntil: "domcontentloaded",
        });
        if (isBlockUrl(page.url()) || detailResp?.status() === 403) {
          stats.blocked = true;
          throw new WellfoundBlockError();
        }
        // SPA: детальная тоже может рендериться после load — короткое ожидание
        // селектора описания, но не падать, если его нет (валидация на parseVacancyDetail).
        await page
        .waitForSelector('[data-testid="job-description"]', {
            timeout: SPA_WAIT_TIMEOUT_MS,
          })
          .catch(() => {});
        const detailHtml = await page.content();
        const { description, key_skills } = parseVacancyDetail(detailHtml);

        // Фильтр include/exclude (общий с hh).
        const status = filterVacancy(
          { title: card.title, description, key_skills },
          profile,
        );

        // Компания (find-or-create по имени; hh_id/wellfound id не пишем здесь).
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
          url: detailUrl,
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

/**
 * Собрать URL поиска Wellfound по профилю + config источника.
 *
 * config источника может содержать wellfound-специфичные параметры:
 *  - job_role: slug роли (напр. "backend-engineer") → подставляется в path
 *  - location: локация/Remote
 *  - remote_only: true → ?remote=true
 *
 * Базовый URL: https://wellfound.com/jobs. Поиск по тексту — через query-параметр
 * (Wellfound поддерживает ?q=). Точная форма параметров уточняется в smoke.
 */
function buildSearchUrl(
  profile: { query: string },
  pageNum: number,
  config: Record<string, unknown>,
): string {
  const params = new URLSearchParams();
  params.set("q", profile.query);
  if (config.remote_only === true) params.set("remote", "true");
  if (typeof config.location === "string" && config.location) {
    params.set("location", config.location);
  }
  // Пагинация Wellfound — ?page=N (1-indexed в большинстве случаев; уточнить в smoke).
  params.set("page", String(pageNum + 1));
  return `${WF_SEARCH_URL}?${params.toString()}`;
}

/** Сделать URL абсолютным (Wellfound возвращает относительные href). */
function absoluteUrl(url: string): string {
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://wellfound.com${url}`;
  return `https://wellfound.com/${url}`;
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
 * Берём первый; Wellfound не отдаёт точный тип в карточке.
 */
function pickEmploymentType(
  types: EmploymentType[],
): EmploymentType | undefined {
  return types[0];
}
