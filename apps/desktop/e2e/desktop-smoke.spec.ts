import { _electron as electron, test } from "@playwright/test";
import path from "node:path";
import { assertDesktopAcceptance } from "./desktop-acceptance";

test("boots a sandboxed bilingual desktop shell", async () => {
  const desktop = await electron.launch({
    args: [path.resolve("out/main/index.js")],
  });

  try {
    const page = await desktop.firstWindow();
    await assertDesktopAcceptance(page);
  } finally {
    await desktop.close();
  }
});
