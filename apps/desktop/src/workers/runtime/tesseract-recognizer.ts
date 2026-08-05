import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { PageRecognitionResult, PageRecognizer, RecognizerFactory } from "./recognize-rendered-pages";

export type TesseractSpawn = typeof spawn;

export function createTesseractRecognizer(options: {
  readonly binaryPath?: string;
  readonly timeoutMs: number;
  readonly spawnProcess?: TesseractSpawn;
  readonly maxOutputBytes?: number;
}): RecognizerFactory {
  const binary = options.binaryPath?.trim() || "tesseract";
  const spawnProcess = options.spawnProcess ?? spawn;
  const maxOutputBytes = options.maxOutputBytes ?? 2 * 1024 * 1024;
  return async (languages: readonly string[]): Promise<PageRecognizer> => {
    void languages;
    const children = new Set<ChildProcess>();
    let terminated = false;
    return {
      async recognize(path: string, requestedLanguages: readonly string[], signal?: AbortSignal): Promise<PageRecognitionResult> {
        if (terminated) throw new Error("OCR_ENGINE_FAILURE");
        signal?.throwIfAborted();
        const languageArgument = requestedLanguages.join("+");
        return new Promise<PageRecognitionResult>((resolve, reject) => {
          const child = spawnProcess(binary, [path, "stdout", "-l", languageArgument, "--psm", "6"], { stdio: ["ignore", "pipe", "pipe"] });
          children.add(child);
          const chunks: Buffer[] = [];
          let outputBytes = 0;
          let diagnosticBytes = 0;
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            child.kill("SIGKILL");
            finish(new Error("OCR_TIMEOUT"));
          }, options.timeoutMs);
          const onAbort = () => {
            child.kill("SIGKILL");
            finish(signal?.reason instanceof Error ? signal.reason : new DOMException("The OCR task was cancelled", "AbortError"));
          };
          function finish(error?: Error): void {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            children.delete(child);
            if (error) reject(error);
            else resolve({ text: Buffer.concat(chunks).toString("utf8").normalize("NFKC").trim(), confidence: 0.5 });
          }
          if (!child.stdout || !child.stderr) {
            child.kill("SIGKILL");
            finish(new Error("OCR_ENGINE_FAILURE"));
            return;
          }
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) onAbort();
          child.stdout.on("data", (chunk: Buffer) => {
            outputBytes += chunk.byteLength;
            if (outputBytes > maxOutputBytes) {
              child.kill("SIGKILL");
              finish(new Error("OCR_ENGINE_FAILURE"));
              return;
            }
            chunks.push(chunk);
          });
          child.stderr.on("data", (chunk: Buffer) => {
            diagnosticBytes += chunk.byteLength;
            if (diagnosticBytes > 256 * 1024) {
              child.kill("SIGKILL");
              finish(new Error("OCR_ENGINE_FAILURE"));
            }
          });
          child.once("error", () => finish(new Error("OCR_ENGINE_FAILURE")));
          child.once("close", (code) => {
            if (code === 0) finish();
            else finish(new Error("OCR_ENGINE_FAILURE"));
          });
        });
      },
      async terminate(): Promise<void> {
        terminated = true;
        for (const child of children) {
          child.kill("SIGKILL");
        }
        children.clear();
      },
    };
  };
}

export function resolveTesseractBinary(path: string | undefined): string {
  const candidate = path?.trim();
  if (!candidate) return "tesseract";
  if (!existsSync(candidate)) throw new Error("OCR_ENGINE_NOT_FOUND");
  return candidate;
}
