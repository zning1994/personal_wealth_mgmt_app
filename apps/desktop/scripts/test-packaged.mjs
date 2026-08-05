import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolvePackagedExecutable } from "./packaged-app.mjs";
import { resolvePackagedPlaywrightCommand } from "./packaged-playwright-command.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = await resolvePackagedExecutable(desktopRoot);
const playwright = resolvePackagedPlaywrightCommand();
const child = spawn(
  playwright.command,
  playwright.args,
  {
    cwd: desktopRoot,
    stdio: "inherit",
    env: { ...process.env, PWM_PACKAGED_EXECUTABLE: executable },
  },
);

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) reject(new Error(`Packaged smoke was terminated by ${signal}`));
    else resolve(code ?? 1);
  });
});
if (exitCode !== 0) process.exitCode = exitCode;
