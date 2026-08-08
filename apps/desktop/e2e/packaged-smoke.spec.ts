import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertDesktopAcceptance } from "./desktop-acceptance";

test("launches the packaged current-host desktop application", async () => {
  const executablePath = process.env.PWM_PACKAGED_EXECUTABLE;
  if (!executablePath) throw new Error("PWM_PACKAGED_EXECUTABLE is required");
  const userDataDir = await mkdtemp(path.join(tmpdir(), "pwm-packaged-smoke-"));
  const desktop = await electron.launch({ executablePath, args: [`--user-data-dir=${userDataDir}`] });
  try {
    const page = await desktop.firstWindow();
    await assertDesktopAcceptance(page);
    expect(await page.evaluate(() => window.wealth.getAppInfo())).toMatchObject({ version: "0.1.1" });
  } finally {
    await desktop.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
