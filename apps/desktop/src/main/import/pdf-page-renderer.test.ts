import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalPdfPageRenderer } from "./pdf-page-renderer";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const limits = {
  maxBytes: 10_000,
  maxPages: 2,
  maxPixelsPerPage: 2_000_000,
  timeoutMs: 1_000,
  dpi: 150,
  maxOutputBytesPerPage: 10_000,
};

describe("LocalPdfPageRenderer", () => {
  it("renders through an injected non-shell command and validates page output", async () => {
    const root = await mkdtemp(join(tmpdir(), "pwm-renderer-"));
    try {
      const renderer = new LocalPdfPageRenderer({
        rootDirectory: root,
        binaryPath: "/synthetic/pdftoppm",
        runCommand: async (_command, args) => {
          const prefix = args.at(-1);
          if (!prefix) throw new Error("missing prefix");
          await mkdir(root, { recursive: true });
          await Promise.all([
            readFile(`${prefix}-1.png`).catch(async () => {
              const bytes = png(1_200, 800);
              await (await import("node:fs/promises")).writeFile(`${prefix}-1.png`, bytes);
              return bytes;
            }),
          ]);
        },
      });
      const output = await renderer.render({
        bytes: new TextEncoder().encode("%PDF-1.4"),
        pageCount: 1,
        pageNumbers: [1],
        outputDirectory: join(root, "task"),
        signal: new AbortController().signal,
        limits,
      });
      expect(output).toEqual([
        expect.objectContaining({ page: 1, width: 1_200, height: 800, pixels: 960_000 }),
      ]);
      await expect(readFile(join(root, "task", "source.pdf"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when a renderer emits no page", async () => {
    const root = await mkdtemp(join(tmpdir(), "pwm-renderer-"));
    try {
      const renderer = new LocalPdfPageRenderer({ rootDirectory: root, runCommand: async () => undefined });
      await expect(renderer.render({
        bytes: new TextEncoder().encode("%PDF-1.4"),
        pageCount: 1,
        pageNumbers: [1],
        outputDirectory: join(root, "task"),
        signal: new AbortController().signal,
        limits,
      })).rejects.toThrow("PDF_RENDERER_PAGE_MISSING");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
