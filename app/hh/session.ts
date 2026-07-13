/**
 * Playwright-сессия для hh.ru — тонкая обёртка над общим app/browser/session.ts.
 *
 * Исторически (фаза 05) createContext/isLoggedIn жили здесь; вынесены в
 * app/browser/session.ts в фазе 06 для переиспользования wellfound и будущими
 * источниками. Публичный API этого модуля сохранён ради обратной совместимости
 * (скрипты hh-login/stealth-check/collect-hh и vi.mock("~/hh/session") в тестах).
 *
 * hh-специфика: profileDir=data/hh-profile, locale=ru-RU, timezone=Europe/Moscow,
 * маркеры залогиненности — hh-селекторы.
 */
import path from "node:path";
import type { Page } from "playwright";
import {
  createContext as createContextBase,
  isLoggedIn as isLoggedInBase,
  type CreateContextOptions as BaseCreateContextOptions,
} from "~/browser/session";

/** Директория персистентного профиля браузера hh (data/hh-profile). */
export const PROFILE_DIR = path.join(process.cwd(), "data", "hh-profile");

/** Маркеры залогиненности на hh (проверяются через общий isLoggedIn). */
const HH_LOGIN_MARKERS = [
  '[data-qa="mainmenu_myResumes"]',
  '[data-qa="account-menu"]',
];

export type CreateContextOptions = Pick<BaseCreateContextOptions, "headed">;

/**
 * Создать browser context с персистентным hh-профилем + анти-детектом.
 * locale/timezone зафиксированы под hh (ru-RU / Europe-Moscow).
 */
export function createContext(
  opts: CreateContextOptions = {},
): ReturnType<typeof createContextBase> {
  return createContextBase({
    profileDir: PROFILE_DIR,
    headed: opts.headed,
    locale: "ru-RU",
    timezone: "Europe/Moscow",
  });
}

/**
 * Проверить, залогинен ли пользователь на hh.ru.
 * Детект по наличию селектора аккаунта (data-qa markers). URL логина
 * (/account/login, /auth) трактуется как «не залогинен».
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("/account/login") || url.includes("/auth")) {
    return false;
  }
  return isLoggedInBase(page, HH_LOGIN_MARKERS);
}
