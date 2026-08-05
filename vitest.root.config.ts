import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/release/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/release/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/release/**"],
  },
});
