/**
 * Обёртка над npm-пакетом `camoufox` — обходит ESM/CJS interop-баг.
 *
 * Пакет camoufox@0.1.19 (latest на 2026-07-13) публикует ESM-сборку
 * (dist/index.js) с dynamic-require guard (`Dynamic require of "events" is
 * not supported`) — bundler (esbuild) встроил CJS-зависимости (keyv и др.)
 * через `require()`, что валится в чистом ESM-контексте tsx/node.
 *
 * CJS-сборка (dist/index.cjs) этого guard'а не содержит и работает корректно,
 * но поле `exports` пакета не разрешает прямой subpath-импорт `camoufox/dist/index.cjs`
 * (ERR_PACKAGE_PATH_NOT_EXPORTED).
 *
 * Решение: `createRequire` загружает CJS-сборку из ESM. Хак инкапсулирован
 * в этом файле — остальной код импортирует `Camoufox`/`launchOptions` отсюда,
 * как будто пакет работает штатно. Когда автор починит ESM-сборку — убрать
 * отсюда createRequire и заменить на `import { Camoufox } from "camoufox"`.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Резолвим CJS-точку входа пакета через Node-резолвер. exports-поле пакета
// отдаёт require → dist/index.cjs (рабочая сборка без dynamic-require guard).
const camoufox = require("camoufox") as {
  Camoufox: (opts: Record<string, unknown>) => Promise<unknown>;
  launchOptions: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export const Camoufox = camoufox.Camoufox;
export const launchOptions = camoufox.launchOptions;
