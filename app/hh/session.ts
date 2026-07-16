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

/**
 * JSON-файл с зафиксированным BrowserForge fingerprint.
 *
 * КРИТИЧНО для hh: между запусками fingerprint должен совпадать, иначе hh
 * инвалидирует сессию даже при валидных куках (кука выдана под fingerprint-A,
 * а collect стартует под fingerprint-B → silent разлогин). Файл генерируется
 * разово через `npm run gen:fingerprint` (scripts/gen-fingerprint.py),
 * serve.py передаёт его в launch_server(fingerprint=...).
 */
export const HH_FINGERPRINT_PATH = path.join(
  process.cwd(),
  "data",
  "hh-fingerprint.json",
);

/** Маркеры залогиненности на hh (проверяются через общий isLoggedIn).
 * hh ~2026-07 сменил mainmenu_myResumes → mainmenu_profileAndResumes
 * (и добавил mainmenu_vacancyResponses — «Отклики» в меню соискателя).
 * Любой из этих селекторов = залогиненная страница. */
const HH_LOGIN_MARKERS = [
  '[data-qa="mainmenu_profileAndResumes"]',
  '[data-qa="profileAndResumes-button"]',
  '[data-qa="mainmenu_vacancyResponses"]',
  // Легаси-маркеры на случай, если hh вернёт старую разметку (A/B-тесты и т.п.).
  '[data-qa="mainmenu_myResumes"]',
  '[data-qa="account-menu"]',
];

export type CreateContextOptions = Pick<
  BaseCreateContextOptions,
  "headed" | "storageStatePath" | "fingerprintPath"
>;

/**
 * Создать browser context с hh-профилем + анти-детектом.
 * locale зафиксирован под hh (ru-RU). timezone — через Camoufox geoip.
 * storageState по умолчанию подгружается из STORAGE_STATE_PATH (если файл есть) —
 * это позволяет collect/apply переиспользовать сессию из hh-login.
 * fingerprint по умолчанию подгружается из HH_FINGERPRINT_PATH — ОБЯЗАТЕЛЬНО
 * совпадает между login и collect/apply, иначе hh инвалидирует сессию.
 * Передай storageStatePath: null или fingerprintPath: null, чтобы явно отключить
 * (например, storageStatePath: null для login — не тащить протухшую сессию).
 */
export function createContext(
  opts: CreateContextOptions = {},
): ReturnType<typeof createContextBase> {
  return createContextBase({
    profileDir: PROFILE_DIR,
    headed: opts.headed,
    locale: "ru-RU",
    storageStatePath: opts.storageStatePath ?? STORAGE_STATE_PATH,
    fingerprintPath: opts.fingerprintPath ?? HH_FINGERPRINT_PATH,
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
