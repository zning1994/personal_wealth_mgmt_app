import type { OcrCompleted, OcrStartRequest, OcrWorkerEvent } from "@pwm/contracts";
export interface OcrWorkerPort { start(request: OcrStartRequest, onEvent: (event: OcrWorkerEvent) => void): Promise<void>; terminate(taskId: string): Promise<void> }
export interface TempPageStore { create(taskId: string): Promise<string>; cleanup(taskId: string): Promise<void> }

function timeoutError(): Error {
  return new Error("OCR_TIMEOUT");
}

function abortReason(signal: AbortSignal, timeout: AbortSignal): Error {
  if (timeout.aborted) return timeoutError();
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("The OCR task was cancelled", "AbortError");
}

async function cleanup(
  deps: { worker: OcrWorkerPort; tempPages: TempPageStore },
  taskId: string,
): Promise<void> {
  // Stop the reader before deleting its page files.  Cleanup remains
  // best-effort, but never races a live OCR process against the directory
  // removal.
  await deps.worker.terminate(taskId).catch(() => undefined);
  await deps.tempPages.cleanup(taskId).catch(() => undefined);
}

export async function runOcrTask(
  deps: { worker: OcrWorkerPort; tempPages: TempPageStore },
  request: OcrStartRequest,
  signal: AbortSignal,
): Promise<OcrCompleted> {
  if (
    request.pageNumbers.length > request.limits.maxPages ||
    request.pagePixels.some((pixels) => pixels > request.limits.maxPixelsPerPage)
  ) {
    throw new Error("OCR_RESOURCE_LIMIT");
  }
  signal.throwIfAborted();
  await deps.tempPages.create(request.taskId);
  const pages: OcrCompleted["pages"] = [];
  const seen = new Set<number>();
  const timeout = AbortSignal.timeout(request.limits.timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  let onCombinedAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    if (combined.aborted) {
      reject(abortReason(signal, timeout));
      return;
    }
    onCombinedAbort = () => reject(abortReason(signal, timeout));
    combined.addEventListener(
      "abort",
      onCombinedAbort,
      { once: true },
    );
    if (combined.aborted) onCombinedAbort();
  });
  let eventError: Error | undefined;
  let rejectEventError: ((error: Error) => void) | undefined;
  const eventFailure = new Promise<never>((_, reject) => {
    rejectEventError = reject;
  });
  try {
    const started = deps.worker.start(request, (event) => {
      if (event.type === "failed") {
        eventError = new Error(event.code);
        rejectEventError?.(eventError);
        return;
      }
      if (event.type !== "page") return;
      if (!request.pageNumbers.includes(event.page) || seen.has(event.page)) {
        eventError = new Error("OCR_INVALID_PAGE_EVENT");
        rejectEventError?.(eventError);
        return;
      }
      seen.add(event.page);
      pages.push({ page: event.page, text: event.text, confidence: event.confidence });
    });
    await Promise.race([
      started,
      aborted,
      eventFailure,
    ]);
    if (eventError) throw eventError;
    if (seen.size !== request.pageNumbers.length) throw new Error("OCR_INCOMPLETE");
    pages.sort((left, right) => left.page - right.page);
    return { taskId: request.taskId, pages };
  } finally {
    if (onCombinedAbort) combined.removeEventListener("abort", onCombinedAbort);
    await cleanup(deps, request.taskId);
  }
}
