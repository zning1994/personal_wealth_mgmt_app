import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "packaged-smoke.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: "line",
  use: {
    screenshot: "off",
    trace: "off",
    video: "off",
  },
});
