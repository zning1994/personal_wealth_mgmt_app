import { copyFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const argon2Entry = require.resolve("@node-rs/argon2", { paths: [desktopRoot] });
const packageRoot = path.dirname(argon2Entry);

const target = {
  "darwin-arm64": { packageName: "@node-rs/argon2-darwin-arm64", fileName: "argon2.darwin-arm64.node" },
  "darwin-x64": { packageName: "@node-rs/argon2-darwin-x64", fileName: "argon2.darwin-x64.node" },
  "win32-x64": { packageName: "@node-rs/argon2-win32-x64-msvc", fileName: "argon2.win32-x64-msvc.node" },
  "win32-arm64": { packageName: "@node-rs/argon2-win32-arm64-msvc", fileName: "argon2.win32-arm64-msvc.node" },
  "win32-ia32": { packageName: "@node-rs/argon2-win32-ia32-msvc", fileName: "argon2.win32-ia32-msvc.node" },
}[`${process.platform}-${process.arch}`];

if (!target) throw new Error(`Unsupported Argon2 packaging target: ${process.platform}-${process.arch}`);

const packageBinary = require.resolve(target.packageName, { paths: [argon2Entry] });
const destination = path.join(packageRoot, target.fileName);

for (const entry of await readdir(packageRoot)) {
  if (entry.startsWith("argon2.") && entry.endsWith(".node")) await unlink(path.join(packageRoot, entry));
}
await copyFile(packageBinary, destination);
process.stdout.write(`${JSON.stringify({ platform: process.platform, architecture: process.arch, source: packageBinary, destination })}\n`);
