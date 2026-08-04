import { createRequire } from "node:module";
import process from "node:process";

export function packagedPlaywrightCommand(platform, nodeExecutable, playwrightCli) {
  if (platform !== "darwin" && platform !== "win32") {
    throw new Error("Packaged smoke supports macOS and Windows");
  }
  return {
    command: nodeExecutable,
    args: [playwrightCli, "test", "--config=playwright.packaged.config.ts"],
  };
}

export function resolvePackagedPlaywrightCommand(
  platform = process.platform,
  nodeExecutable = process.execPath,
) {
  const require = createRequire(import.meta.url);
  return packagedPlaywrightCommand(
    platform,
    nodeExecutable,
    require.resolve("@playwright/test/cli"),
  );
}
