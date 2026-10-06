import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  esbuild: { jsx: "automatic" },
  test: { environment: "jsdom", include: ["tests/**/*.test.{ts,tsx}"], testTimeout: 10000 },
});
