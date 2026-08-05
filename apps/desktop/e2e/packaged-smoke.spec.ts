import { _electron as electron, expect, test } from "@playwright/test";
import { assertDesktopAcceptance } from "./desktop-acceptance";

test("launches the packaged current-host desktop application", async () => {
  const executablePath = process.env.PWM_PACKAGED_EXECUTABLE;
  if (!executablePath) throw new Error("PWM_PACKAGED_EXECUTABLE is required");
  const desktop = await electron.launch({ executablePath });
  try {
    const page = await desktop.firstWindow();
    await assertDesktopAcceptance(page);
    expect(await page.evaluate(() => window.wealth.getAppInfo())).toMatchObject({ version: "0.1.0" });
  } finally {
    await desktop.close();
  }
});
