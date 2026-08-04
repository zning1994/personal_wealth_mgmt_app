import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "original-fs": "node:fs" },
  },
  test: {
    exclude: ["e2e/**", "node_modules/**", "out/**", "release/**"],
  },
});
