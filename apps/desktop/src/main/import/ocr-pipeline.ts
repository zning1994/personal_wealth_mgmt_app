import { Worker } from "node:worker_threads";
import { lstat, mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { OcrWorkerEventSchema, type OcrCompleted, type OcrStartRequest, type OcrWorkerEvent } from "@pwm/contracts";
import { runOcrTask, type OcrWorkerPort, type TempPageStore } from "@pwm/importer";
import type { PdfPageRenderer, PdfPageRenderLimits } from "@pwm/importer";

export type PdfOcrPipelineInput = {
  readonly sourceDocumentId: string;
  readonly bytes: Uint8Array;
  readonly pageCount: number;
  readonly signal: AbortSignal;
};

export interface PdfOcrPipeline {
  run(input: PdfOcrPipelineInput): Promise<OcrCompleted>;
}

export type OcrPipelineOptions = {
  readonly tempRoot: string;
  readonly workerScript: string;
  readonly renderer: PdfPageRenderer;
  readonly worker?: OcrWorkerPort;
  readonly limits?: Partial<OcrPipelineLimits>;
};

export type OcrPipelineLimits = PdfPageRenderLimits & {
  readonly languages: readonly ("eng" | "chi_sim")[];
  readonly maxConcurrency: 1 | 2;
};

const DEFAULT_LIMITS: OcrPipelineLimits = {
  maxBytes: 25 * 1024 * 1024,
  maxPages: 100,
  maxPixelsPerPage: 20_000_000,
  timeoutMs: 60_000,
  dpi: 150,
  maxOutputBytesPerPage: 8 * 1024 * 1024,
  languages: ["eng", "chi_sim"],
  maxConcurrency: 1,
};

function within(rootDirectory: string, candidate: string): boolean {
  const relativePath = relative(resolve(rootDirectory), resolve(candidate));
  return relativePath.length > 0 && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

function requireTaskId(taskId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(taskId)) {
    throw new Error("OCR_TASK_ID_INVALID");
  }
}

class FileOcrTempPageStore implements TempPageStore {
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = resolve(rootDirectory);
  }

  path(taskId: string): string {
    requireTaskId(taskId);
    const directory = resolve(this.rootDirectory, taskId);
    if (!within(this.rootDirectory, directory)) throw new Error("OCR_PATH_SCOPE_MISMATCH");
    return directory;
  }

  async create(taskId: string): Promise<string> {
    const directory = this.path(taskId);
    const existing = await lstat(directory).catch(() => undefined);
    if (existing?.isSymbolicLink() || (existing && !existing.isDirectory())) throw new Error("OCR_PATH_SCOPE_MISMATCH");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const canonicalRoot = await realpath(this.rootDirectory);
    const canonicalDirectory = await realpath(directory);
    if (!within(canonicalRoot, canonicalDirectory)) throw new Error("OCR_PATH_SCOPE_MISMATCH");
    return directory;
  }

  async cleanup(taskId: string): Promise<void> {
    const directory = this.path(taskId);
    await rm(directory, { recursive: true, force: true });
  }

  async cleanupStale(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const cutoff = Date.now() - maxAgeMs;
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory() || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(entry.name)) return;
      const directory = this.path(entry.name);
      const information = await stat(directory).catch(() => undefined);
      if (information && information.mtimeMs < cutoff) await rm(directory, { recursive: true, force: true });
    }));
  }
}

type ActiveWorker = {
  readonly worker: Worker;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
};

/** Worker-thread adapter for the serialisable OCR contract. */
export class ThreadOcrWorkerPort implements OcrWorkerPort {
  private readonly active = new Map<string, ActiveWorker>();

  constructor(
    private readonly workerScript: string,
    private readonly taskDirectory: (taskId: string) => string,
    private readonly taskRoot?: string,
  ) {}

  start(request: OcrStartRequest, onEvent: (event: OcrWorkerEvent) => void): Promise<void> {
    if (this.active.has(request.taskId)) return Promise.reject(new Error("OCR_TASK_DUPLICATE"));
    const worker = new Worker(this.workerScript, {
      argv: [],
      execArgv: [],
      ...(this.taskRoot ? { env: { ...process.env, WEALTH_OCR_TASK_ROOT: resolve(this.taskRoot) } } : {}),
    });
    return new Promise<void>((resolvePromise, rejectPromise) => {
      let terminal = false;
      const finish = (error?: Error) => {
        if (terminal) return;
        terminal = true;
        if (error) rejectPromise(error);
        else resolvePromise();
      };
      const active: ActiveWorker = { worker, resolve: () => finish(), reject: (error) => finish(error) };
      this.active.set(request.taskId, active);
      worker.on("message", (unknownEvent: unknown) => {
        const parsed = OcrWorkerEventSchema.safeParse(unknownEvent);
        if (!parsed.success || parsed.data.taskId !== request.taskId) {
          finish(new Error("OCR_INVALID_WORKER_EVENT"));
          return;
        }
        const event = parsed.data;
        if (event.type === "page") {
          onEvent(event);
          return;
        }
        if (event.type === "failed") {
          onEvent(event);
          finish(new Error(event.code));
          return;
        }
        onEvent(event);
        finish();
      });
      worker.once("error", () => finish(new Error("OCR_ENGINE_FAILURE")));
      worker.once("exit", (code) => {
        if (!terminal) finish(new Error(code === 0 ? "OCR_WORKER_EXITED" : "OCR_ENGINE_FAILURE"));
      });
      try {
        worker.postMessage({
          type: "start",
          request,
          taskDirectory: this.taskDirectory(request.taskId),
        });
      } catch {
        finish(new Error("OCR_ENGINE_FAILURE"));
      }
    });
  }

  async terminate(taskId: string): Promise<void> {
    const active = this.active.get(taskId);
    if (!active) return;
    this.active.delete(taskId);
    active.reject(new Error("OCR_CANCELLED"));
    try {
      active.worker.postMessage({ type: "cancel", taskId });
    } catch {
      // A worker that already exited needs no cancellation message.
    }
    await active.worker.terminate();
  }
}

export class LocalPdfOcrPipeline implements PdfOcrPipeline {
  private readonly limits: OcrPipelineLimits;
  private readonly tempPages: FileOcrTempPageStore;
  private readonly worker: OcrWorkerPort;

  constructor(private readonly options: OcrPipelineOptions) {
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.tempPages = new FileOcrTempPageStore(options.tempRoot);
    this.worker = options.worker ?? new ThreadOcrWorkerPort(options.workerScript, (taskId) => this.tempPages.path(taskId), options.tempRoot);
  }

  async run(input: PdfOcrPipelineInput): Promise<OcrCompleted> {
    await this.tempPages.cleanupStale();
    const taskId = crypto.randomUUID();
    const outputDirectory = await this.tempPages.create(taskId);
    try {
      const pages = await this.options.renderer.render({
        bytes: input.bytes,
        pageCount: input.pageCount,
        pageNumbers: Array.from({ length: input.pageCount }, (_value, index) => index + 1),
        outputDirectory,
        signal: input.signal,
        limits: this.limits,
      });
      if (pages.length < 1 || pages.length > this.limits.maxPages) throw new Error("PDF_RENDERER_LIMIT_EXCEEDED");
      const request: OcrStartRequest = {
        taskId,
        sourceDocumentId: input.sourceDocumentId,
        pageNumbers: pages.map((page) => page.page),
        pagePixels: pages.map((page) => page.pixels),
        languages: [...this.limits.languages],
        limits: {
          maxPages: this.limits.maxPages,
          maxPixelsPerPage: this.limits.maxPixelsPerPage,
          timeoutMs: this.limits.timeoutMs,
          maxConcurrency: this.limits.maxConcurrency,
        },
      };
      return await runOcrTask(
        {
          worker: this.worker,
          // Pages have already been rendered, so create is intentionally
          // idempotent and returns the prepared task directory.
          tempPages: {
            create: async () => outputDirectory,
            cleanup: (cleanupTaskId) => this.tempPages.cleanup(cleanupTaskId),
          },
        },
        request,
        input.signal,
      );
    } finally {
      await this.worker.terminate(taskId);
      await this.tempPages.cleanup(taskId);
    }
  }
}

export function createLocalPdfOcrPipeline(options: Omit<OcrPipelineOptions, "renderer"> & { renderer: PdfPageRenderer }): PdfOcrPipeline {
  return new LocalPdfOcrPipeline(options);
}
