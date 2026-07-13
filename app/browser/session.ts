/**
 * Общий браузерный контекст для всех источников вакансий (hh, wellfound, …).
 *
 * Движок: **Camoufox** (модифицированный Firefox с FingerprintForge на уровне
 * движка C++). Заменил Chromium/Playwright + ручные stealth init-scripts
 * (фаза camoufox-stealth) после Cloudflare bot-detect'а Wellfound'а.
 *
 * Camoufox покрывает анти-детект нативно: fingerprint генерируется через
 * BrowserForge, `humanize:true` — реалистичные движения курсора, `geoip:true`
 * автоматически вычисляет timezone/locale/country по IP (согласованный отпечаток,
 * убирает рассогласование timezone vs IP-геолокации).
 *
 * Источник-специфичные обёртки (app/hh/session.ts, app/wellfound/session.ts)
 * передают сюда свой profileDir (= Camoufox data_dir, persistent context) и
 * locale (языковой интерфейс). Поведенческая имитация (human.ts) — общая.
 *
 * ВНИМАНИЕ: один Camoufox-процесс на data_dir одновременно. Скрипты должны
 * закрывать context (try/finally).
 */
import { Camoufox } from "./camoufox";
import type { BrowserContext, Page } from "playwright";

export type CreateContextOptions = {
  /** Директория персистентного профиля браузера (ОБЯЗАТЕЛЬНО — у каждого источника свой). */
  profileDir: string;
  /** true → видимый браузер (для ручного логина). По умолчанию false (headless). */
  headed?: boolean;
  /** locale браузера (языковой интерфейс). Дефолт "ru-RU" (hh). Wellfound → "en-US". */
  locale?: string;
};

/**
 * Создать Camoufox browser context с персистентным профилем.
 *
 * Camoufox сам генерирует fingerprint (UA, screen, WebGL, plugins и т.д.) через
 * BrowserForge — ручные stealth-патчи НЕ применяются (они были Chromium-specific
 * и конфликтовали с fingerprint-генератором).
 *
 * geoip:true — Camoufox определяет IP и выставляет timezone/locale/country
 * согласованно (убирает рассогласование, которое было при ручном timezoneId).
 *
 * @throws если profileDir не передан
 */
export async function createContext(
  opts: CreateContextOptions,
): Promise<BrowserContext> {
  if (!opts.profileDir) {
    throw new Error(
      "createContext: profileDir обязателен (у каждого источника свой)",
    );
  }
  const context = (await Camoufox({
    data_dir: opts.profileDir,
    headless: !opts.headed,
    humanize: true,
    locale: opts.locale ?? "ru-RU",
  })) as BrowserContext;
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
