import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "app");
export default defineConfig({
  resolve: { alias: { "~": appDir } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
});
