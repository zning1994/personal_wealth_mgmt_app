import { describe, expect, it } from "vitest";
import { packagedPlaywrightCommand } from "./packaged-playwright-command.mjs";

describe("packaged Playwright command", () => {
  it.each(["darwin", "win32"])("uses Node directly on %s", (platform) => {
    expect(packagedPlaywrightCommand(platform, "/runtime/node", "/deps/playwright/cli.js")).toEqual({
      command: "/runtime/node",
      args: ["/deps/playwright/cli.js", "test", "--config=playwright.packaged.config.ts"],
    });
  });
});
