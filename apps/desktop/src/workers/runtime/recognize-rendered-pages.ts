import { basename, resolve, sep } from "node:path";
import type { OcrStartRequest } from "@pwm/contracts";

export interface PageRecognitionResult { readonly text: string; readonly confidence: number; }
export interface PageRecognizer {
  recognize(path: string, languages: readonly string[], signal?: AbortSignal): Promise<PageRecognitionResult>;
  terminate(): Promise<void>;
}
export type RecognizerFactory = (languages: readonly string[]) => Promise<PageRecognizer>;

export async function* recognizeRenderedPages(
  request: OcrStartRequest,
  taskDirectory: string,
  createRecognizer: RecognizerFactory,
  signal = new AbortController().signal,
): AsyncGenerator<{ page: number; text: string; confidence: number }> {
  const root = resolve(taskDirectory);
  const recognizer = await createRecognizer(request.languages);
  try {
    for (const page of request.pageNumbers) {
      signal.throwIfAborted();
      // LocalPdfPageRenderer writes the page prefix as `page-<n>.png`.
      // Keep the worker bound to that exact task directory naming contract.
      const path = resolve(root, `page-${page}.png`);
      if (path !== `${root}${sep}${basename(path)}`) throw new Error("OCR_PATH_SCOPE_MISMATCH");
      const result = await recognizer.recognize(path, request.languages, signal);
      signal.throwIfAborted();
      yield {
        page,
        text: result.text.normalize("NFKC").trim(),
        confidence: Math.max(0, Math.min(1, result.confidence)),
      };
    }
  } finally {
    await recognizer.terminate();
  }
}
