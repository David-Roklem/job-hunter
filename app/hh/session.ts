/**
 * Playwright-сессия для hh.ru — тонкая обёртка над общим app/browser/session.ts.
 *
 * Исторически (фаза 05) createContext/isLoggedIn жили здесь; вынесены в
 * app/browser/session.ts в фазе 06 для переиспользования wellfound и будущими
 * источниками. Публичный API этого модуля сохранён ради обратной совместимости
 * (скрипты hh-login/stealth-check/collect-hh и vi.mock("~/hh/session") в тестах).
 *
 * hh-специфика: profileDir=data/hh-profile, locale=ru-RU,
 * маркеры залогиненности — hh-селекторы. (timezone убран в фазе camoufox-stealth —
 * Camoufox geoip:true вычисляет timezone по IP автоматически.)
 */
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import {
  createContext as createContextBase,
  isLoggedIn as isLoggedInBase,
  type CreateContextOptions as BaseCreateContextOptions,
} from "~/browser/session";

/** Директория персистентного профиля браузера hh (data/hh-profile). */
export const PROFILE_DIR = path.join(process.cwd(), "data", "hh-profile");

/**
 * JSON-файл storageState (куки+localStorage hh-сессии).
 *
 * launch_server() неперсистентен (см. ~/browser/session.ts), поэтому сессия
 * хранится здесь: hh-login.ts вызывает saveSession(context) после логина,
 * collect/apply подгружают storageState через STORAGE_STATE_PATH → createContext.
 */
export const STORAGE_STATE_PATH = path.join(
  process.cwd(),
  "data",
  "hh-session.json",
);

/** Маркеры залогиненности на hh (проверяются через общий isLoggedIn). */
const HH_LOGIN_MARKERS = [
  '[data-qa="mainmenu_myResumes"]',
  '[data-qa="account-menu"]',
];

export type CreateContextOptions = Pick<
  BaseCreateContextOptions,
  "headed" | "storageStatePath"
>;

/**
 * Создать browser context с hh-профилем + анти-детектом.
 * locale зафиксирован под hh (ru-RU). timezone — через Camoufox geoip.
 * storageState по умолчанию подгружается из STORAGE_STATE_PATH (если файл есть) —
 * это позволяет collect/apply переиспользовать сессию из hh-login.
 * Передай storageStatePath: null, чтобы явно отключить (например, для login).
 */
export function createContext(
  opts: CreateContextOptions = {},
): ReturnType<typeof createContextBase> {
  return createContextBase({
    profileDir: PROFILE_DIR,
    headed: opts.headed,
    locale: "ru-RU",
    storageStatePath: opts.storageStatePath ?? STORAGE_STATE_PATH,
  });
}

/**
 * Сохранить сессию (куки+localStorage) в STORAGE_STATE_PATH.
 * Вызывается hh-login.ts после подтверждения isLoggedIn. Без этого collect/apply
 * не увидят сессию (launch_server неперсистентен).
 */
export async function saveSession(
  context: BrowserContext,
): Promise<void> {
  await context.storageState({ path: STORAGE_STATE_PATH });
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
