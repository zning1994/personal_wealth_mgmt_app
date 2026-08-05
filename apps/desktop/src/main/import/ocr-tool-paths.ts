import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";
import { app } from "electron";

function resourceRoot(): string | null {
  if (typeof process.resourcesPath === "string" && process.resourcesPath.length > 0) return process.resourcesPath;
  if (typeof app.getAppPath === "function") return join(app.getAppPath(), "resources");
  return null;
}

function bundledPath(name: string): string | undefined {
  const root = resourceRoot();
  if (!root) return undefined;
  const candidate = join(root, "ocr", `${process.platform}-${process.arch}`, name);
  return existsSync(candidate) ? candidate : undefined;
}

function bundledDirectory(): string | undefined {
  const root = resourceRoot();
  if (!root) return undefined;
  const candidate = join(root, "ocr", `${process.platform}-${process.arch}`);
  return existsSync(candidate) ? candidate : undefined;
}

export function resolveBundledPdfRenderer(): string | undefined {
  const explicit = process.env.PWM_PDF_RENDERER_PATH?.trim();
  if (explicit) return explicit;
  return bundledPath(process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm");
}

export function resolveBundledTesseract(): string | undefined {
  const explicit = process.env.PWM_TESSERACT_PATH?.trim();
  if (explicit) return explicit;
  return bundledPath(process.platform === "win32" ? "tesseract.exe" : "tesseract");
}

export function resolveBundledTessdata(): string | undefined {
  const directory = bundledDirectory();
  if (!directory) return undefined;
  const candidate = join(directory, "tessdata");
  return existsSync(candidate) ? candidate : undefined;
}

/** Environment needed by bundled OCR binaries and their copied native libraries. */
export function resolveBundledOcrEnvironment(): Readonly<Record<string, string>> {
  const directory = bundledDirectory();
  if (!directory) return {};
  const pathEntries = [directory, process.env.PATH].filter((value): value is string => Boolean(value && value.length > 0));
  const environment: Record<string, string> = { PATH: pathEntries.join(delimiter) };
  if (process.platform === "darwin" && existsSync(join(directory, "lib"))) {
    environment.DYLD_LIBRARY_PATH = [join(directory, "lib"), process.env.DYLD_LIBRARY_PATH]
      .filter((value): value is string => Boolean(value && value.length > 0))
      .join(delimiter);
  }
  return environment;
}
