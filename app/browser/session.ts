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
 * курсора. Профиль персистентен в `data_dir` (Python-side): куки/localStorage
 * переживают перезапуски, повторный логин не нужен.
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
    locale: opts.locale,
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

  // 3. Получить/создать context. Сервер Camoufox может держать default context
  //    (с persistent data_dir) или нет — обработать оба случая.
  let context: BrowserContext;
  const contexts = browser.contexts();
  if (contexts.length > 0) {
    context = contexts[0]!;
  } else {
    // Remote browser без default context — создать новый. Куки всё равно
    // персистятся в data_dir (управляется Camoufox-side).
    context = await browser.newContext();
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
