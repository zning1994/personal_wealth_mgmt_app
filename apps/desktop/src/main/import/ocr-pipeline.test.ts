import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OcrStartRequest, OcrWorkerEvent } from "@pwm/contracts";
import type { PdfPageRenderInput, PdfPageRenderer } from "@pwm/importer";
import { LocalPdfOcrPipeline, ThreadOcrWorkerPort } from "./ocr-pipeline";

describe("LocalPdfOcrPipeline", () => {
  it("adapts a real worker-thread message boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "pwm-ocr-thread-"));
    const script = join(root, "worker.mjs");
    const taskId = crypto.randomUUID();
    await writeFile(script, `import { parentPort } from "node:worker_threads"; parentPort.on("message", (message) => { if (message.type === "start") { parentPort.postMessage({ type: "page", taskId: message.request.taskId, page: 1, text: "synthetic", confidence: 0.5 }); parentPort.postMessage({ type: "completed", taskId: message.request.taskId, pages: 1 }); } });`);
    const port = new ThreadOcrWorkerPort(script, () => root);
    const events: OcrWorkerEvent[] = [];
    try {
      await port.start({ taskId, sourceDocumentId: crypto.randomUUID(), pageNumbers: [1], pagePixels: [1], languages: ["eng"], limits: { maxPages: 1, maxPixelsPerPage: 1, timeoutMs: 1_000, maxConcurrency: 1 } }, (event) => events.push(event));
      expect(events.map((event) => event.type)).toEqual(["page", "completed"]);
      await port.terminate(taskId);
    } finally {
      await port.terminate(taskId);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renders every scanned page, runs the worker, and removes task files", async () => {
    const root = await mkdtemp(join(tmpdir(), "pwm-ocr-pipeline-"));
    const rendered: PdfPageRenderInput[] = [];
    const renderer: PdfPageRenderer = {
      async render(input) {
        rendered.push(input);
        return [
          { page: 1, path: join(input.outputDirectory, "page-1.png"), width: 1200, height: 800, pixels: 960_000 },
          { page: 2, path: join(input.outputDirectory, "page-2.png"), width: 1200, height: 800, pixels: 960_000 },
        ];
      },
    };
    const worker = {
      start: async (request: OcrStartRequest, onEvent: (event: OcrWorkerEvent) => void) => {
        onEvent({ type: "page", taskId: request.taskId, page: 1, text: "2026-08-01 Coffee -10.00 AED", confidence: 0.8 });
        onEvent({ type: "page", taskId: request.taskId, page: 2, text: "2026-08-02 Salary +100.00 AED", confidence: 0.9 });
        onEvent({ type: "completed", taskId: request.taskId, pages: 2 });
      },
      terminate: async () => undefined,
    };
    try {
      const result = await new LocalPdfOcrPipeline({
        tempRoot: root,
        workerScript: "unused-injected-worker",
        renderer,
        worker,
      }).run({
        sourceDocumentId: crypto.randomUUID(),
        bytes: new TextEncoder().encode("%PDF-1.4 scanned"),
        pageCount: 2,
        signal: new AbortController().signal,
      });
      expect(result.pages.map((page) => page.page)).toEqual([1, 2]);
      expect(rendered[0]?.pageNumbers).toEqual([1, 2]);
      expect(rendered[0]?.limits.maxPixelsPerPage).toBe(20_000_000);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cleans rendered pages when OCR is cancelled", async () => {
    const root = await mkdtemp(join(tmpdir(), "pwm-ocr-pipeline-"));
    const controller = new AbortController();
    const renderer: PdfPageRenderer = {
      async render(input) {
        controller.abort();
        return [{ page: 1, path: join(input.outputDirectory, "page-1.png"), width: 1, height: 1, pixels: 1 }];
      },
    };
    const worker = {
      start: async () => new Promise<void>(() => undefined),
      terminate: async () => undefined,
    };
    try {
      await expect(new LocalPdfOcrPipeline({ tempRoot: root, workerScript: "unused", renderer, worker }).run({
        sourceDocumentId: crypto.randomUUID(),
        bytes: new TextEncoder().encode("%PDF-1.4 scanned"),
        pageCount: 1,
        signal: controller.signal,
      })).rejects.toMatchObject({ name: "AbortError" });
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
