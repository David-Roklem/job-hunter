/**
 * Общий браузерный контекст для всех источников вакансий (hh, wellfound, …).
 *
 * Движок: **Camoufox** (модифицированный Firefox с FingerprintForge на уровне
 * движка C++). Запускается через **Python-bridge** (CDP/Playwright-server):
 *
 *   Node (этот модуль) → spawn `uv run python python-bridge/serve.py`
 *                     → Python запускает Camoufox как Playwright-server
 *                     → возвращает wsEndpoint
 *                     → Node: `firefox.connect(wsEndpoint)`
 *
 * Camoufox покрывает анти-детект нативно: fingerprint генерируется через
 * BrowserForge, `humanize:true` (передаётся в serve.py) — реалистичные движения
 * курсора.
 *
 * ПЕРСИСТЕНТНОСТЬ СЕССИИ: launch_server() (Playwright-server) НЕ использует
 * persistent context — куки/localStorage живут только в памяти процесса и
 * теряются при остановке (data_dir в server-режиме не делает контекст
 * персистентным для подключаемых клиентов). Поэтому сессия сохраняется
 * через **storageState**: после ручного логина context.storageState()
 * пишет куки+localStorage в JSON-файл (storageStatePath), а следующий запуск
 * newContext({storageState}) их подставляет. См. hh-login.ts → hh/session.ts.
 *
 * Почему Python-bridge, а не JS-порт camoufox: JS-порт (camoufox@0.1.19) сырой —
 * 3 бага (ESM dynamic-require, geoip proxy, viewport protocol skew). Python-порт
 * (camoufox@0.4.11) стабилен, активно поддерживается. POC доказан end-to-end
 * 2026-07-13: fingerprint {webdriver:false, plugins:5, Firefox/135}.
 *
 * ВНИМАНИЕ: один Camoufox-процесс на data_dir одновременно (lock профиля).
 * Скрипты должны закрывать context через try/finally (stop() убивает сервер).
 */
import { firefox, type Browser, type BrowserContext, type Page } from "playwright";
import { launchCamoufoxServer } from "./launcher";

export type CreateContextOptions = {
  /** Директория персистентного профиля браузера (ОБЯЗАТЕЛЬНО — у каждого источника свой). */
  profileDir: string;
  /** true → видимый браузер (для ручного логина). По умолчанию false (headless). */
  headed?: boolean;
  /** locale браузера (языковой интерфейс). Дефолт "ru-RU" (hh). Wellfound → "en-US". */
  locale?: string;
  /** Фиксированный размер окна [w, h]. Дефолт [1920, 1080] (см. launcher.ts). */
  window?: [number, number];
  /** Путь к JSON-файлу storageState (куки+localStorage).
   * Если задан и файл существует — context создаётся с этими куками
   * (newContext({storageState})). Используется для переиспользования сессии
   * между запусками: login сохраняет storageState, collect/apply — подгружает. */
  storageStatePath?: string;
  /** Путь к JSON-файлу с зафиксированным BrowserForge fingerprint.
   * Если задан — пробрасывается в serve.py --fingerprint → launch_server(fingerprint=...).
   * КРИТИЧНО для hh: между запусками fingerprint должен совпадать, иначе hh
   * инвалидирует сессию (см. python-bridge/fingerprint.py). null — отключить. */
  fingerprintPath?: string | null;
};

/** Внутренний тип: context + ссылка на stop() для cleanup. */
type CamoufoxBrowserContext = BrowserContext & {
  /** Остановить Python-Camoufox-server (kill процесса). Вызывается в finally. */
  __stopServer?: () => Promise<void>;
};

/**
 * Создать Camoufox browser context: запустить Python-server, подключиться по WS.
 *
 * @throws если profileDir пуст, uv не найден, или сервер не стартовал за 60s.
 */
export async function createContext(
  opts: CreateContextOptions,
): Promise<BrowserContext> {
  if (!opts.profileDir) {
    throw new Error(
      "createContext: profileDir обязателен (у каждого источника свой)",
    );
  }

  // 1. Запустить Python-Camoufox-server, получить wsEndpoint.
  const { wsEndpoint, stop } = await launchCamoufoxServer({
    profileDir: opts.profileDir,
    headed: opts.headed,
    locale: opts.locale ?? "ru-RU",
    window: opts.window,
    fingerprintPath: opts.fingerprintPath,
  });

  // 2. Подключиться к серверу через Playwright-server protocol (firefox.connect).
  let browser: Browser;
  try {
    browser = await firefox.connect(wsEndpoint);
  } catch (e) {
    await stop();
    throw new Error(
      `createContext: firefox.connect failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 3. Получить/создать context.
  //    Если просят storageState (переиспользование сессии) — ВСЕГДА создавать
  //    новый context через newContext({storageState}): default-context сервера
  //    уже создан без кук, и storageState к нему не применить. Иначе можно
  //    переиспользовать default-context сервера (если есть).
  let context: BrowserContext;
  const hasStorageState =
    opts.storageStatePath &&
    (await import("node:fs")).existsSync(opts.storageStatePath);

  if (hasStorageState) {
    context = await browser.newContext({
      storageState: opts.storageStatePath,
    });
  } else {
    const contexts = browser.contexts();
    if (contexts.length > 0) {
      context = contexts[0]!;
    } else {
      context = await browser.newContext();
    }
  }

  // 4. Обернуть context.close(): убить Python-сервер после закрытия.
  const originalClose = context.close.bind(context);
  const wrappedContext = context as CamoufoxBrowserContext;
  wrappedContext.__stopServer = stop;
  wrappedContext.close = async () => {
    try {
      await originalClose();
    } finally {
      await stop();
    }
  };

  return wrappedContext;
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
