/**
 * Diagnostic-скрипт: проверить анти-детект fingerprint на реальном браузере.
 *
 * Запуск: npm run hh:stealth-check
 *
 * Открывает https://bot.sannysoft.com/ (стандартный тест бот-детекта),
 * снимает отпечатки (navigator.webdriver, plugins, webgl vendor). Цель:
 *   - navigator.webdriver === undefined
 *   - navigator.plugins.length > 0
 *   - WebGL vendor !== "Google Inc. (Google)" (SwiftShader)
 *
 * С фазы camoufox-stealth: createContext использует Camoufox (модифицированный
 * Firefox, FingerprintForge на уровне движка). Этот скрипт проверяет его отпечаток.
 *
 * НЕ автотест — ручная проверка перед реальным сбором.
 */
import { createContext } from "../app/hh/session";

async function main(): Promise<void> {
  console.log("=== stealth check ===\n");

  const context = await createContext({ headed: true });
  const page = await context.newPage();

  try {
    // bot.sannysoft.com — стандартная панель детекта.
    await page.goto("https://bot.sannysoft.com/", { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 3000)); // дать выполниться JS-тестам.

    const fingerprint = await page.evaluate(() => ({
      webdriver: (navigator as Navigator & { webdriver?: boolean }).webdriver,
      languages: navigator.languages,
      pluginsLength: navigator.plugins.length,
      chromeRuntime: typeof (window as unknown as { chrome?: { runtime?: unknown } }).chrome?.runtime,
      webglVendor: (() => {
        try {
          const canvas = document.createElement("canvas");
          const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
          if (!gl) return null;
          const dbg = gl.getExtension("WEBGL_debug_renderer_info");
          return dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null;
        } catch {
          return null;
        }
      })(),
    }));

    console.log("Отпечаток (цель: webdriver=undefined, plugins>0, webgl=Intel):");
    console.log(`  navigator.webdriver: ${JSON.stringify(fingerprint.webdriver)}`);
    console.log(`  navigator.languages:  ${JSON.stringify(fingerprint.languages)}`);
    console.log(`  navigator.plugins:    ${fingerprint.pluginsLength}`);
    console.log(`  window.chrome.runtime: ${fingerprint.chromeRuntime}`);
    console.log(`  WebGL vendor:         ${JSON.stringify(fingerprint.webglVendor)}`);

    console.log("\nПроверка таблицы bot.sannysoft.com — убедитесь, что строки зелёные (в окне браузера).");
    console.log("Закрываю браузер через 15с (или нажмите Ctrl+C раньше)...\n");
    await new Promise((resolve) => setTimeout(resolve, 15000));
  } finally {
    await context.close().catch(() => {});
  }
}

main();
