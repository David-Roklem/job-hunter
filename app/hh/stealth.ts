/**
 * Анти-детект уровень 2: ручные evasion init-scripts.
 *
 * Применяются через context.addInitScript — патчат отпечаток браузера ДО
 * загрузки любой страницы. Ядро любого stealth-плагина, реализовано вручную
 * (без устаревших playwright-extra/puppeteer-extra-plugin-stealth, последние
 * обновления которых — 2023, несовместимы с Playwright 1.61).
 *
 * Техники (актуальные best practices):
 *   1. navigator.webdriver = undefined (главный флаг автоматизации).
 *   2. window.chrome runtime (headless Chromium его не имеет → детект).
 *   3. navigator.languages / plugins (согласованный fingerprint).
 *   4. WebGL vendor/renderer (headless имеет характерный SwiftShader).
 *   5. Permissions API (headless отдаёт некорректные запросы).
 *
 * НЕ защищает от продвинутых детекторов (TLS/JA3, глубокий behavioural-анализ).
 * Достаточно для hh.ru и single-user объёма (~100/день). Эскалация — Camoufox.
 */
import type { BrowserContext } from "playwright";

/**
 * Применить все evasion-патчи к context.
 * Вызывается ОДИН раз на context после создания (createContext).
 */
export async function applyStealth(context: BrowserContext): Promise<void> {
  // addInitScript выполняется на каждой странице/фрейме до load.
  await context.addInitScript(maskWebDriver);
  await context.addInitScript(maskChromeRuntime);
  await context.addInitScript(maskNavigatorProps);
  await context.addInitScript(maskWebGL);
  await context.addInitScript(maskPermissions);
}

// --- init-scripts (строки, исполняются в контексте страницы) ---------------

/** 1. navigator.webdriver = undefined (Playwright выставляет true). */
const maskWebDriver = `
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });
`;

/** 2. window.chrome runtime — есть у настоящего Chrome, нет у headless. */
const maskChromeRuntime = `
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', UPDATE: 'update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
      RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
      connect: () => {},
      sendMessage: () => {},
    };
  }
`;

/**
 * 3. navigator.languages / plugins — правдоподобный набор.
 *    headless отдаёт пустой plugins и 0-length languages.
 */
const maskNavigatorProps = `
  Object.defineProperty(navigator, 'languages', {
    get: () => ['ru-RU', 'ru', 'en-US', 'en'],
    configurable: true,
  });
  // 5 правдоподобных плагинов (Chrome имеет PDF + Native Client).
  const fakePlugins = [
    { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  ];
  Object.defineProperty(navigator, 'plugins', {
    get: () => fakePlugins,
    configurable: true,
  });
`;

/**
 * 4. WebGL: НЕ маскируем vendor/renderer.
 *
 * Реальный GPU-отпечаток (напр. "Google Inc. (NVIDIA)" через ANGLE) — это
 * правдоподобный десктопный отпечаток, а НЕ headless-маркер (последний —
 * "SwiftShader" / "Google Inc. (Google)"). Подмена на Intel создаёт
 * несоответствие с остальным fingerprint'ом и УХУДШАЕТ скрытность.
 * Если на headless-окружении отпечаток будет SwiftShader — добавить маску тут.
 */
const maskWebGL = ``;

/** 5. Permissions API — headless отдаёт некорректный Notification.query. */
const maskPermissions = `
  if (navigator.permissions && navigator.permissions.query) {
    const originalQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (parameters) =>
      parameters && parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission, onchange: null })
        : originalQuery(parameters);
  }
`;
