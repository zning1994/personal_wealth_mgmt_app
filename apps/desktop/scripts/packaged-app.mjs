import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export function packagedExecutableCandidates(desktopRoot, platform, architecture) {
  if (platform === "darwin") {
    const executable = ["Personal Wealth.app", "Contents", "MacOS", "Personal Wealth"];
    return [
      path.join(desktopRoot, "release", `mac-${architecture}`, ...executable),
      path.join(desktopRoot, "release", "mac", ...executable),
    ];
  }
  if (platform === "win32") {
    return [path.win32.join(desktopRoot, "release", "win-unpacked", "Personal Wealth.exe")];
  }
  throw new Error("Packaged smoke supports macOS and Windows");
}

export async function resolvePackagedExecutable(desktopRoot, platform = process.platform, architecture = process.arch) {
  const candidates = packagedExecutableCandidates(desktopRoot, platform, architecture);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next documented electron-builder directory layout.
    }
  }
  throw new Error(`Packaged executable was not found for ${platform}/${architecture}`);
}
