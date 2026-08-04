import { parentPort } from "node:worker_threads";
import { resolve, sep } from "node:path";
import { OcrStartRequestSchema, OcrWorkerEventSchema, type OcrStartRequest } from "@pwm/contracts";
import { recognizeRenderedPages } from "./runtime/recognize-rendered-pages";
import { createTesseractRecognizer, resolveTesseractBinary } from "./runtime/tesseract-recognizer";

type OcrMessage =
  | { type: "start"; request: OcrStartRequest; taskDirectory: string }
  | { type: "cancel"; taskId: string };
const active = new Map<string, AbortController>();
if (parentPort) {
  parentPort.on("message", async (message: OcrMessage) => {
    if (message.type === "cancel") {
      active.get(message.taskId)?.abort(new DOMException("The OCR task was cancelled", "AbortError"));
      return;
    }
    try {
      const request = OcrStartRequestSchema.parse(message.request);
      if (active.has(request.taskId)) throw new Error("OCR_TASK_DUPLICATE");
      const controller = new AbortController();
      active.set(request.taskId, controller);
      const taskRoot = process.env.WEALTH_OCR_TASK_ROOT;
      const taskDirectory = resolve(message.taskDirectory);
      if (taskDirectory.includes("\0") || (taskRoot && !taskDirectory.startsWith(`${resolve(taskRoot)}${sep}`))) throw new Error("OCR_PATH_SCOPE_MISMATCH");
      if (request.pageNumbers.length > request.limits.maxPages || request.pagePixels.some((pixels) => pixels > request.limits.maxPixelsPerPage)) throw new Error("OCR_RESOURCE_LIMIT");
      const recognizerFactory = createTesseractRecognizer({ binaryPath: resolveTesseractBinary(process.env.PWM_TESSERACT_PATH), timeoutMs: request.limits.timeoutMs });
      let pages = 0;
      for await (const page of recognizeRenderedPages(request, taskDirectory, recognizerFactory, controller.signal)) {
        OcrWorkerEventSchema.parse({ type: "page", taskId: request.taskId, page: page.page, text: page.text, confidence: page.confidence });
        parentPort?.postMessage({ type: "page", taskId: request.taskId, page: page.page, text: page.text, confidence: page.confidence });
        pages += 1;
      }
      controller.signal.throwIfAborted();
      const completed = { type: "completed" as const, taskId: request.taskId, pages };
      OcrWorkerEventSchema.parse(completed);
      parentPort?.postMessage(completed);
    } catch (error: unknown) {
      const taskId = typeof message?.request?.taskId === "string" ? message.request.taskId : "00000000-0000-0000-0000-000000000000";
      const messageText = error instanceof Error ? error.message : "";
      const code = messageText === "OCR_RESOURCE_LIMIT" ? "OCR_RESOURCE_LIMIT" : messageText === "OCR_TIMEOUT" ? "OCR_TIMEOUT" : "OCR_ENGINE_FAILURE";
      const failed = { type: "failed" as const, taskId, code };
      OcrWorkerEventSchema.parse(failed);
      parentPort?.postMessage(failed);
    } finally {
      const taskId = typeof message?.request?.taskId === "string" ? message.request.taskId : undefined;
      if (taskId) active.delete(taskId);
    }
  });
}
