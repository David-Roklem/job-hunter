import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "app");

export default defineConfig({
  plugins: [reactRouter()],
  resolve: {
    alias: {
      "~": appDir,
    },
  },
});
