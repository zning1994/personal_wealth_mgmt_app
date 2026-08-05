import { describe, expect, it } from "vitest";
import { recognizeRenderedPages } from "./recognize-rendered-pages";

describe("recognizeRenderedPages", () => {
  it("passes the renderer's page-prefixed paths to the recognizer", async () => {
    const paths: string[] = [];
    const pages = recognizeRenderedPages(
      {
        taskId: crypto.randomUUID(),
        sourceDocumentId: crypto.randomUUID(),
        pageNumbers: [1, 2],
        pagePixels: [1, 1],
        languages: ["eng"],
        limits: { maxPages: 2, maxPixelsPerPage: 1, timeoutMs: 1_000, maxConcurrency: 1 },
      },
      "/tmp/pwm-ocr-task",
      async () => ({
        recognize: async (path: string) => {
          paths.push(path);
          return { text: `page ${paths.length}`, confidence: 0.8 };
        },
        terminate: async () => undefined,
      }),
    );

    const result: Array<{ page: number; text: string; confidence: number }> = [];
    for await (const page of pages) result.push(page);
    expect(result).toHaveLength(2);
    expect(paths).toEqual(["/tmp/pwm-ocr-task/page-1.png", "/tmp/pwm-ocr-task/page-2.png"]);
  });
});
