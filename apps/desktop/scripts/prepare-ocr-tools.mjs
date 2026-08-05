import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resourcesRoot = path.join(desktopRoot, "resources", "ocr");
const platform = process.env.PWM_OCR_PLATFORM || process.platform;
const architecture = process.env.PWM_OCR_ARCH || process.arch;
const target = path.join(resourcesRoot, `${platform}-${architecture}`);
const required = process.env.PWM_OCR_REQUIRE_TOOLS === "1";

function command(command, args = []) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function findFiles(root, name) {
  if (!root || !existsSync(root)) return [];
  const pending = [root];
  const matches = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(candidate);
      } else if (entry.name.toLowerCase() === name.toLowerCase()) {
        matches.push(candidate);
      }
    }
  }
  return matches;
}

function findWindowsExecutable(name, candidates) {
  const where = command("where", [name]).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const chocolateyRoot = process.env.ChocolateyInstall || "C:\\ProgramData\\chocolatey";
  const packageName = name.toLowerCase().startsWith("pdf") ? "poppler" : "tesseract";
  const packageRoot = path.join(chocolateyRoot, "lib", packageName, "tools");
  return firstExisting([...candidates, ...findFiles(packageRoot, name), ...where]);
}

function findUnixExecutable(name) {
  const candidate = command("sh", ["-lc", `command -v ${name}`]);
  if (candidate && existsSync(candidate)) return candidate;
  return undefined;
}

function copyFile(source, destination) {
  mkdirSync(path.dirname(destination), { recursive: true });
  // Homebrew exposes many OCR libraries through absolute symlinks. A release
  // app must contain the actual library bytes; an external symlink makes the
  // bundle both non-portable and invalid under codesign --deep --strict.
  cpSync(realpathSync(source), destination);
}

function copyDirectory(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source)) {
    const from = path.join(source, entry);
    const to = path.join(destination, entry);
    cpSync(realpathSync(from), to, { recursive: true });
  }
}

function findSymbolicLinks(root) {
  const links = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        links.push(candidate);
      } else if (entry.isDirectory()) {
        pending.push(candidate);
      }
    }
  }
  return links;
}

function runOtool(binary) {
  return command("otool", ["-L", binary]).split(/\r?\n/).slice(1).map((line) => line.trim().split(" ")[0]).filter(Boolean);
}

function runRpaths(binary) {
  return [...command("otool", ["-l", binary]).matchAll(/\bpath\s+([^\s(]+)/gu)].map((match) => match[1]).filter(Boolean).map((value) => value.startsWith("@loader_path/") ? path.resolve(path.dirname(binary), value.slice("@loader_path/".length)) : value);
}

function resolveMacDependency(binary, dependency) {
  if (dependency.startsWith("@rpath/")) return firstExisting(runRpaths(binary).map((rpath) => path.join(rpath, dependency.slice("@rpath/".length))));
  if (dependency.startsWith("@loader_path/")) return path.resolve(path.dirname(binary), dependency.slice("@loader_path/".length));
  return dependency;
}

function patchMacBinary(binary, replacements) {
  if (replacements.length === 0) return;
  for (const [oldPath, newPath] of replacements) {
    try {
      execFileSync("install_name_tool", ["-change", oldPath, newPath, binary], { stdio: "ignore" });
    } catch {
      if (required) throw new Error(`Unable to rewrite OCR dependency ${oldPath} in ${binary}`);
    }
  }
}

function bundleMac() {
  const brew = findUnixExecutable("brew");
  const popplerPrefix = process.env.PWM_OCR_POPPLER_PREFIX || (brew ? command(brew, ["--prefix", "poppler"]) : "");
  const tesseractPrefix = process.env.PWM_OCR_TESSERACT_PREFIX || (brew ? command(brew, ["--prefix", "tesseract"]) : "");
  const pdftoppm = process.env.PWM_OCR_PDF_RENDERER_SOURCE || firstExisting([
    popplerPrefix && path.join(popplerPrefix, "bin", "pdftoppm"),
    findUnixExecutable("pdftoppm"),
  ]);
  const tesseract = process.env.PWM_OCR_TESSERACT_SOURCE || firstExisting([
    tesseractPrefix && path.join(tesseractPrefix, "bin", "tesseract"),
    findUnixExecutable("tesseract"),
  ]);
  const tessdata = process.env.PWM_OCR_TESSDATA_SOURCE || firstExisting([
    tesseractPrefix && path.join(tesseractPrefix, "share", "tessdata"),
    tesseract && path.join(path.dirname(path.dirname(tesseract)), "share", "tessdata"),
    "/usr/local/share/tessdata",
    "/opt/homebrew/share/tessdata",
  ]);
  if (!pdftoppm || !tesseract || !tessdata) {
    if (required) throw new Error("OCR tools not found. Install poppler and tesseract or set PWM_OCR_*_SOURCE.");
    return { platform, architecture, available: false, reason: "missing-host-tools" };
  }

  mkdirSync(path.join(target, "lib"), { recursive: true });
  const binaries = [
    [pdftoppm, path.join(target, "pdftoppm")],
    [tesseract, path.join(target, "tesseract")],
  ];
  const copiedLibraries = new Map();
  const queue = [...binaries.map(([source]) => source)];
  while (queue.length > 0) {
    const source = queue.shift();
    for (const original of runOtool(source)) {
      const dependency = resolveMacDependency(source, original);
      if (!dependency) continue;
      if (dependency.startsWith("/usr/lib/") || dependency.startsWith("/System/Library/")) continue;
      if (!existsSync(dependency) || copiedLibraries.has(dependency)) continue;
      const destination = path.join(target, "lib", path.basename(dependency));
      copyFile(dependency, destination);
      copiedLibraries.set(dependency, destination);
      queue.push(dependency);
    }
  }
  for (const [source, destination] of binaries) {
    copyFile(source, destination);
    patchMacBinary(destination, runOtool(source).map((original) => [original, resolveMacDependency(source, original)]).filter((entry) => entry[1] !== undefined && copiedLibraries.has(entry[1])).map(([original, dependency]) => [original, `@loader_path/lib/${path.basename(dependency)}`]));
  }
  for (const [source, destination] of copiedLibraries) {
    patchMacBinary(destination, runOtool(source).map((original) => [original, resolveMacDependency(source, original)]).filter((entry) => entry[1] !== undefined && copiedLibraries.has(entry[1])).map(([original, dependency]) => [original, `@loader_path/${path.basename(dependency)}`]));
    try { execFileSync("install_name_tool", ["-id", `@loader_path/${path.basename(destination)}`, destination], { stdio: "ignore" }); } catch { if (required) throw new Error(`Unable to rewrite OCR library id ${destination}`); }
  }
  copyDirectory(tessdata, path.join(target, "tessdata"));
  return { platform, architecture, available: true, binaries: ["pdftoppm", "tesseract"], tessdata: "tessdata" };
}

function bundleWindows() {
  const pdftoppm = process.env.PWM_OCR_PDF_RENDERER_SOURCE || findWindowsExecutable("pdftoppm.exe", [
    "C:\\ProgramData\\chocolatey\\bin\\pdftoppm.exe",
    "C:\\Program Files\\poppler\\Library\\bin\\pdftoppm.exe",
  ]);
  const tesseract = process.env.PWM_OCR_TESSERACT_SOURCE || findWindowsExecutable("tesseract.exe", [
    "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
    "C:\\ProgramData\\chocolatey\\bin\\tesseract.exe",
  ]);
  const tessdata = process.env.PWM_OCR_TESSDATA_SOURCE || firstExisting([
    tesseract && path.join(path.dirname(tesseract), "tessdata"),
    "C:\\Program Files\\Tesseract-OCR\\tessdata",
  ]);
  if (!pdftoppm || !tesseract || !tessdata) {
    if (required) throw new Error("OCR tools not found. Install Poppler and Tesseract or set PWM_OCR_*_SOURCE.");
    return { platform, architecture, available: false, reason: "missing-host-tools" };
  }
  for (const [source, name] of [[pdftoppm, "pdftoppm.exe"], [tesseract, "tesseract.exe"]]) copyFile(source, path.join(target, name));
  const toolDirectories = new Set([path.dirname(pdftoppm), path.dirname(tesseract)]);
  for (const directory of toolDirectories) {
    for (const entry of readdirSync(directory)) {
      if (/\.dll$/iu.test(entry)) copyFile(path.join(directory, entry), path.join(target, entry));
    }
  }
  copyDirectory(tessdata, path.join(target, "tessdata"));
  return { platform, architecture, available: true, binaries: ["pdftoppm.exe", "tesseract.exe"], tessdata: "tessdata" };
}

if (platform !== "darwin" && platform !== "win32") {
  if (required) throw new Error(`Unsupported OCR packaging platform: ${platform}`);
  process.stdout.write(`${JSON.stringify({ platform, architecture, available: false, reason: "unsupported-platform" })}\n`);
  process.exit(0);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const manifest = platform === "darwin" ? bundleMac() : bundleWindows();
const symbolicLinks = findSymbolicLinks(target);
if (symbolicLinks.length > 0) {
  throw new Error(`OCR bundle contains symbolic links: ${symbolicLinks.join(", ")}`);
}
writeFileSync(path.join(target, "ocr-manifest.json"), `${JSON.stringify({ version: 1, ...manifest }, null, 2)}\n`);
if (!manifest.available) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, "ocr-manifest.json"), `${JSON.stringify({ version: 1, ...manifest }, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify({ target, ...manifest }, null, 2)}\n`);
