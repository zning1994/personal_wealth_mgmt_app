import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  PdfPageRendererError,
  readPngDimensions,
  type PdfPageRenderInput,
  type PdfPageRenderer,
  type RenderedPdfPage,
} from "@pwm/importer";

export type PdfRenderCommand = (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
    readonly maxOutputBytes: number;
  },
) => Promise<void>;

export type LocalPdfPageRendererOptions = {
  readonly rootDirectory: string;
  readonly binaryPath?: string;
  readonly runCommand?: PdfRenderCommand;
};

function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath.length > 0 && !relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath);
}

function assertTaskDirectory(rootDirectory: string, outputDirectory: string): string {
  const root = resolve(rootDirectory);
  const output = resolve(outputDirectory);
  if (!isWithin(root, output)) throw new PdfPageRendererError("PDF_RENDERER_PATH_SCOPE_MISMATCH");
  return output;
}

function assertContiguousPages(pageNumbers: readonly number[], pageCount: number, maxPages: number): void {
  if (pageNumbers.length < 1 || pageNumbers.length > maxPages || pageCount > maxPages) {
    throw new PdfPageRendererError("PDF_RENDERER_LIMIT_EXCEEDED");
  }
  for (let index = 0; index < pageNumbers.length; index += 1) {
    const page = pageNumbers[index];
    if (page === undefined || page < 1 || page > pageCount || page !== index + 1) {
      throw new PdfPageRendererError("PDF_RENDERER_PAGE_SELECTION_INVALID");
    }
  }
}

function assertRenderLimits(input: PdfPageRenderInput): void {
  const limits = input.limits;
  if (
    !Number.isInteger(limits.maxBytes) || limits.maxBytes < 1 ||
    !Number.isInteger(limits.maxPages) || limits.maxPages < 1 ||
    !Number.isInteger(limits.maxPixelsPerPage) || limits.maxPixelsPerPage < 1 ||
    !Number.isInteger(limits.timeoutMs) || limits.timeoutMs < 1 ||
    !Number.isInteger(limits.dpi) || limits.dpi < 36 || limits.dpi > 600 ||
    !Number.isInteger(limits.maxOutputBytesPerPage) || limits.maxOutputBytesPerPage < 1
  ) {
    throw new PdfPageRendererError("PDF_RENDERER_LIMIT_EXCEEDED", "PDF_RENDERER_LIMITS_INVALID");
  }
}

function mapAbort(signal: AbortSignal): PdfPageRendererError {
  return new PdfPageRendererError(
    signal.reason instanceof Error && signal.reason.message === "PDF_RENDERER_TIMEOUT"
      ? "PDF_RENDERER_TIMEOUT"
      : "PDF_RENDERER_CANCELLED",
  );
}

/**
 * Minimal command runner used by the desktop adapter.  The command receives
 * only a private input/output directory and is killed on cancellation or
 * timeout; no shell is involved, so PDF contents never become shell syntax.
 */
export const runPdfRenderCommand: PdfRenderCommand = async (
  command,
  args,
  options,
) => {
  if (options.signal.aborted) throw mapAbort(options.signal);
  await new Promise<void>((resolvePromise, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, [...args], {
        cwd: options.cwd,
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch {
      reject(new PdfPageRendererError("PDF_RENDERER_UNAVAILABLE"));
      return;
    }

    let settled = false;
    let outputBytes = 0;
    function finish(error?: PdfPageRendererError): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolvePromise();
    }
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(mapAbort(options.signal));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new PdfPageRendererError("PDF_RENDERER_TIMEOUT"));
    }, options.timeoutMs);
    options.signal.addEventListener("abort", onAbort, { once: true });
    if (options.signal.aborted) onAbort();
    child.stderr?.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        child.kill("SIGKILL");
        finish(new PdfPageRendererError("PDF_RENDERER_FAILED"));
      }
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      finish(new PdfPageRendererError(error.code === "ENOENT" ? "PDF_RENDERER_UNAVAILABLE" : "PDF_RENDERER_FAILED"));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      if (code === 0) finish();
      else if (signal === "SIGKILL" && options.signal.aborted) finish(mapAbort(options.signal));
      else finish(new PdfPageRendererError("PDF_RENDERER_FAILED"));
    });
  });
};

export class LocalPdfPageRenderer implements PdfPageRenderer {
  private readonly rootDirectory: string;
  private readonly binaryPath: string;
  private readonly runCommand: PdfRenderCommand;

  constructor(options: LocalPdfPageRendererOptions) {
    this.rootDirectory = resolve(options.rootDirectory);
    this.binaryPath = options.binaryPath?.trim() || process.env.PWM_PDF_RENDERER_PATH?.trim() || "pdftoppm";
    this.runCommand = options.runCommand ?? runPdfRenderCommand;
  }

  async render(input: PdfPageRenderInput): Promise<readonly RenderedPdfPage[]> {
    assertRenderLimits(input);
    if (input.bytes.byteLength > input.limits.maxBytes) {
      throw new PdfPageRendererError("PDF_RENDERER_LIMIT_EXCEEDED");
    }
    input.signal.throwIfAborted();
    assertContiguousPages(input.pageNumbers, input.pageCount, input.limits.maxPages);
    const outputDirectory = assertTaskDirectory(this.rootDirectory, input.outputDirectory);
    await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    const sourcePath = resolve(outputDirectory, "source.pdf");
    const prefix = resolve(outputDirectory, "page");
    if (!isWithin(this.rootDirectory, sourcePath) || !isWithin(this.rootDirectory, prefix)) {
      throw new PdfPageRendererError("PDF_RENDERER_PATH_SCOPE_MISMATCH");
    }
    try {
      await writeFile(sourcePath, input.bytes, { mode: 0o600, flag: "wx" });
      await this.runCommand(
        this.binaryPath,
        [
          "-png",
          "-r",
          String(input.limits.dpi),
          "-f",
          String(input.pageNumbers[0]),
          "-l",
          String(input.pageNumbers[input.pageNumbers.length - 1]),
          sourcePath,
          prefix,
        ],
        {
          cwd: outputDirectory,
          signal: input.signal,
          timeoutMs: input.limits.timeoutMs,
          maxOutputBytes: 256 * 1024,
        },
      );
      input.signal.throwIfAborted();
      const pages: RenderedPdfPage[] = [];
      for (const page of input.pageNumbers) {
        const path = resolve(outputDirectory, `page-${page}.png`);
        if (!isWithin(this.rootDirectory, path)) {
          throw new PdfPageRendererError("PDF_RENDERER_PATH_SCOPE_MISMATCH");
        }
        const image = await readFile(path).catch(() => {
          throw new PdfPageRendererError("PDF_RENDERER_PAGE_MISSING");
        });
        if (image.byteLength > input.limits.maxOutputBytesPerPage) {
          throw new PdfPageRendererError("PDF_RENDERER_LIMIT_EXCEEDED");
        }
        const dimensions = readPngDimensions(image);
        if (dimensions.pixels > input.limits.maxPixelsPerPage) {
          throw new PdfPageRendererError("PDF_RENDERER_LIMIT_EXCEEDED");
        }
        pages.push({ page, path, ...dimensions });
      }
      return pages;
    } catch (error) {
      if (error instanceof PdfPageRendererError) throw error;
      if (input.signal.aborted) throw mapAbort(input.signal);
      throw new PdfPageRendererError("PDF_RENDERER_FAILED");
    } finally {
      await unlink(sourcePath).catch(() => undefined);
    }
  }
}

export async function hasPdfRenderer(binaryPath = process.env.PWM_PDF_RENDERER_PATH?.trim() || "pdftoppm"): Promise<boolean> {
  if (isAbsolute(binaryPath)) {
    return access(binaryPath, fsConstants.X_OK).then(() => true, () => false);
  }
  // Do not invoke a shell.  A no-op version probe is sufficient to distinguish
  // a missing command from an installed renderer and does not parse PDF data.
  try {
    await runPdfRenderCommand(binaryPath, ["-v"], {
      cwd: process.cwd(),
      signal: AbortSignal.timeout(2_000),
      timeoutMs: 2_000,
      maxOutputBytes: 64 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

export async function assertPdfRendererOutput(path: string): Promise<void> {
  const information = await stat(path);
  if (!information.isFile()) throw new PdfPageRendererError("PDF_RENDERER_INVALID_PAGE");
}
