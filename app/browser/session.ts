/**
 * Общий Playwright-контекст для всех источников вакансий (hh, wellfound, …).
 *
 * Источник-специфичные обёртки (app/hh/session.ts, app/wellfound/session.ts)
 * передают сюда свой profileDir + locale/timezone. Анти-детект (stealth) и
 * поведенческая имитация (human) — общие, живут в app/hh/ (исторически) и
 * реэкспортируются/импортируются напрямую.
 *
 * launchPersistentContext: реальный профиль в data/<source>-profile
 * (куки/localStorage/cache/indexedDB персистятся). Правдоподобнее fingerprint,
 * чем изолированный newContext каждый раз. Применяется анти-детект (applyStealth).
 *
 * ВНИМАНИЕ: launchPersistentContext открывает ОДИН context на profileDir
 * одновременно. Скрипты должны закрывать context (try/finally).
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { applyStealth } from "~/hh/stealth";

/**
 * User-Agent десктопного Chrome (без суффикса HeadlessChrome, который детектится).
 * Согласован с locale/viewport. Обновлять при устаревании.
 */
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Типичные десктопные разрешения (рандомизация viewport — анти-fingerprint). */
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

function randomViewport() {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}

export type CreateContextOptions = {
  /** Директория персистентного профиля браузера (ОБЯЗАТЕЛЬНО — у каждого источника свой). */
  profileDir: string;
  /** true → видимый браузер (для ручного логина). По умолчанию false (headless). */
  headed?: boolean;
  /** locale браузера. Дефолт "ru-RU" (hh). Wellfound → "en-US". */
  locale?: string;
  /** timezone браузера. Дефолт "Europe/Moscow" (hh). Wellfound → "America/New_York". */
  timezone?: string;
};

/**
 * Создать browser context с персистентным профилем + анти-детектом.
 *
 * Источник передаёт свой profileDir и locale/timezone. stealth применяются
 * единообразно для всех источников.
 */
export async function createContext(
  opts: CreateContextOptions,
): Promise<BrowserContext> {
  if (!opts.profileDir) {
    throw new Error("createContext: profileDir обязателен (у каждого источника свой)");
  }
  const context = await chromium.launchPersistentContext(opts.profileDir, {
    headless: !opts.headed,
    locale: opts.locale ?? "ru-RU",
    timezoneId: opts.timezone ?? "Europe/Moscow",
    viewport: randomViewport(),
    userAgent: DESKTOP_UA,
  });
  await applyStealth(context);
  return context;
}

/**
 * Проверить, залогинен ли пользователь, по наличию любого из CSS-маркеров.
 *
 * Каждый источник передаёт свой набор селекторов залогиненного состояния
 * (см. app/hh/session.ts, app/wellfound/session.ts).
 */
export async function isLoggedIn(page: Page, markers: string[]): Promise<boolean> {
  if (markers.length === 0) return false;
  const count = await page
    .locator(markers.join(", "))
    .count()
    .catch(() => 0);
  return count > 0;
}
