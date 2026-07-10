/**
 * Playwright-сессия для hh.ru.
 *
 * Использует launchPersistentContext — реальный профиль браузера в
 * data/hh-profile (куки/localStorage/cache/indexedDB персистятся). Это
 * правдоподобнее с точки зрения fingerprint, чем изолированный newContext
 * каждый раз. Применяется анти-детект (applyStealth) + согласованные
 * locale/UA/viewport.
 *
 * Первый запуск — headed (ручной логин с капчей/2FA в hh-login.ts).
 * Дальше — headless, куки переиспользуются.
 */
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { applyStealth } from "./stealth";

/** Директория персистентного профиля браузера (data/hh-profile). */
export const PROFILE_DIR = path.join(process.cwd(), "data", "hh-profile");

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
  /** true → видимый браузер (для ручного логина). По умолчанию false (headless). */
  headed?: boolean;
};

/**
 * Создать browser context с персистентным профилем + анти-детектом.
 *
 * ВНИМАНИЕ: launchPersistentContext может открыть только ОДИН context на
 * PROFILE_DIR одновременно. Скрипты сбора/логина должны закрывать context
 * перед завершением (try/finally).
 */
export async function createContext(
  opts: CreateContextOptions = {},
): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !opts.headed,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    viewport: randomViewport(),
    userAgent: DESKTOP_UA,
  });
  await applyStealth(context);
  return context;
}

/**
 * Проверить, залогинен ли пользователь на hh.ru.
 * Детект по наличию селектора залогиненного состояния (кнопка входа исчезла
 * ИЛИ появился селектор меню аккаунта). Точный селектор уточняется при smoke.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  // На hh.ru после логина появляется блок аккаунта (селектор может меняться —
  // проверяем несколько признаков). URL логина редиректит на главную.
  const url = page.url();
  if (url.includes("/account/login") || url.includes("/auth")) {
    return false;
  }
  // Признак залогиненности: есть ссылка на резюме/отклики в шапке.
  const accountMarker = await page
    .locator('[data-qa="mainmenu_myResumes"], [data-qa="account-menu"]')
    .count()
    .catch(() => 0);
  return accountMarker > 0;
}
