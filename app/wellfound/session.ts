/**
 * Playwright-сессия для Wellfound — тонкая обёртка над общим app/browser/session.ts.
 *
 * Параметризует общий createContext под Wellfound:
 *  - profileDir = data/wellfound-profile (ОТДЕЛЬНЫЙ от hh — куки не смешиваются)
 *  - locale = en-US, timezone = America/New_York (американская площадка)
 *
 * Анти-детект (stealth) и поведенческая имитация (human) — общие с hh.
 *
 * Первый запуск — headed (ручной логин в wellfound-login.ts).
 * Дальше — headless, куки переиспользуются.
 */
import path from "node:path";
import type { Page } from "playwright";
import {
  createContext as createContextBase,
  isLoggedIn as isLoggedInBase,
  type CreateContextOptions as BaseCreateContextOptions,
} from "~/browser/session";
import { WF_LOGIN_MARKERS } from "./selectors";

/** Директория персистентного профиля браузера Wellfound (data/wellfound-profile). */
export const PROFILE_DIR = path.join(process.cwd(), "data", "wellfound-profile");

export type CreateContextOptions = Pick<BaseCreateContextOptions, "headed">;

/**
 * Создать browser context с персистентным wellfound-профилем + анти-детектом.
 * locale/timezone зафиксированы под Wellfound (en-US / America/New_York).
 */
export function createContext(
  opts: CreateContextOptions = {},
): ReturnType<typeof createContextBase> {
  return createContextBase({
    profileDir: PROFILE_DIR,
    headed: opts.headed,
    locale: "en-US",
    timezone: "America/New_York",
  });
}

/**
 * Проверить, залогинен ли пользователь на Wellfound.
 * URL входа (/users/sign_in) трактуется как «не залогинен».
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("/users/sign_in") || url.includes("/sign_in")) {
    return false;
  }
  return isLoggedInBase(page, [...WF_LOGIN_MARKERS]);
}
