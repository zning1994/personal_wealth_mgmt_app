import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";

test("boots a sandboxed bilingual desktop shell", async () => {
  const desktop = await electron.launch({
    args: [path.resolve("out/main/index.js")],
  });

  try {
    const page = await desktop.firstWindow();
    await expect(page.getByRole("heading", { name: "个人财富" })).toBeVisible();
    expect(await page.evaluate(() => typeof globalThis.process)).toBe(
      "undefined",
    );
    expect(
      await page.evaluate(() => Object.keys(window.wealth).sort()),
    ).toEqual(["cancelTask", "getAppInfo", "onTaskProgress", "startTask"]);
  } finally {
    await desktop.close();
  }
});
