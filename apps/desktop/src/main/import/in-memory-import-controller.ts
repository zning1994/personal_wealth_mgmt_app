import { app, dialog } from "electron";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import type { AccountDto, ActivityOperation, CreateAccountInput, ImportCandidateV1, ImportDraftView, ImportDraftSummary, SelectedSource, WorkspaceId, ActivityOperationId, LlmFallbackSource, PrepareLlmFallbackInput, ImportBatchId as ContractImportBatchId } from "@pwm/contracts";
import { parseImportCandidate } from "@pwm/contracts";
import { CanonicalCsvParser, decimalToMinor, extractPdfText, parseSavedValueWorkbook, type ParserInput } from "@pwm/importer";
import { activityInverseTargetIds, DEFAULT_INVERSE_RETENTION, CommitImportBatchCommand, type ActivityInverse, type ActivityLogPort, type ActivityRecord, type ImportCommitResult, type ImportCommitTransaction, type ImportCommitUnitOfWork } from "@pwm/application";
import type { ImportBatchId, SkipCandidateInput, UpdateCandidateInput } from "@pwm/contracts";
import { createSqlAccountRepository, createSqlLedgerUnitOfWork, SqlActivityLog, SqlImportDraftStore, SqlImportUnitOfWork } from "@pwm/storage";
import { DesktopImportController, type ImportController, type ImportReviewService, type SelectedSourcePayload, type SourceSelectionPort } from "./import-controller";
import { openLocalWorkspace, type LocalWorkspace } from "../workspace/local-workspace";
import { createDesktopLedgerService, createInMemoryLedgerService, type DesktopLedgerService } from "../ledger/ledger-service";
import { createInMemoryLedgerUnitOfWork } from "../ledger/ledger-service";
import { createDesktopActivityService, type DesktopActivityService } from "../activity/activity-service";
import { createInMemoryFinanceService, createSqlFinanceService, type DesktopFinanceService } from "../finance/finance-service";
import type { PdfOcrPipeline } from "./ocr-pipeline";
import type { PdfPageRenderer } from "@pwm/importer";
import type { ImportLlmAttachments } from "@pwm/application";

type Capability = { path: string; size: number; mtimeMs: number; expiresAt: number; source: SelectedSource };
export interface DraftPersistence {
  create(draft: ImportDraftView, displayName: string): Promise<void>;
  get(batchId: ImportBatchId): Promise<ImportDraftView | null>;
  list(): Promise<readonly ImportDraftSummary[]>;
  save(draft: ImportDraftView, expectedRevision: number): Promise<void>;
}

export type ResolvedLlmFallback = { readonly batchId: ContractImportBatchId; readonly mode: "original_pdf" | "page_images"; readonly pages: readonly number[]; readonly attachments: ImportLlmAttachments };
export interface ImportLlmFallbackService {
  prepare(input: PrepareLlmFallbackInput): Promise<LlmFallbackSource>;
  resolve(token: string, batchId: ContractImportBatchId): Promise<ResolvedLlmFallback>;
  consume(token: string): void;
}

export interface AccountService { list(): Promise<readonly AccountDto[]>; create(input: Omit<CreateAccountInput, "workspaceId">): Promise<AccountDto> }

class MemoryAccountService implements AccountService {
  private readonly values: AccountDto[] = [];
  constructor(private readonly workspaceId: WorkspaceId) {}
  async list(): Promise<readonly AccountDto[]> { return [...this.values]; }
  async create(input: Omit<CreateAccountInput, "workspaceId">): Promise<AccountDto> { const now = new Date().toISOString(); const value: AccountDto = { id: randomUUID() as never, workspaceId: this.workspaceId, name: input.name.trim(), kind: input.kind, currency: input.currency, version: 0, deletedAt: null, createdAt: now, updatedAt: now }; this.values.push(value); return value; }
}

class MemoryActivityLog implements ActivityLogPort {
  private readonly records: ActivityRecord[] = [];
  async append(operation: ActivityOperation, inverse: ActivityInverse | null = null): Promise<void> { this.records.unshift({ operation, inverse }); }
  async latest(workspaceId: WorkspaceId): Promise<ActivityOperation | null> { return this.records.find((record) => record.operation.workspaceId === workspaceId)?.operation ?? null; }
  async list(workspaceId: WorkspaceId, limit = 30): Promise<readonly ActivityOperation[]> { return this.records.filter((record) => record.operation.workspaceId === workspaceId).slice(0, limit).map((record) => record.operation); }
  async findForUndo(workspaceId: WorkspaceId, operationId: ActivityOperationId): Promise<ActivityRecord | null> { const candidate = this.records.find((record) => record.operation.workspaceId === workspaceId && record.operation.id === operationId) ?? null; if (!candidate?.inverse) return candidate; const targets = new Set(activityInverseTargetIds(candidate.inverse)); const later = this.records.filter((record) => record.operation.createdAt > candidate.operation.createdAt && record.operation.undoneAt === null); return later.some((record) => targets.has(record.operation.entityId) || activityInverseTargetIds(record.inverse).some((id) => targets.has(id))) ? null : candidate; }
  async latestForUndo(workspaceId: WorkspaceId): Promise<ActivityRecord | null> { const cutoff = Date.now() - DEFAULT_INVERSE_RETENTION.days * 86_400_000; return this.records.filter((record) => record.operation.workspaceId === workspaceId && record.operation.undoable && !record.operation.undoneAt && record.inverse !== null && Date.parse(record.operation.createdAt) >= cutoff).slice(0, DEFAULT_INVERSE_RETENTION.maxOperations)[0] ?? null; }
  async markUndone(operationId: ActivityOperation["id"], undoneAt: string): Promise<void> { const index = this.records.findIndex((candidate) => candidate.operation.id === operationId); if (index >= 0) { const record = this.records[index]!; this.records[index] = { ...record, operation: { ...record.operation, undoneAt, updatedAt: undoneAt } }; } }
}
export class DialogSourceSelection implements SourceSelectionPort {
  private readonly capabilities = new Map<string, Capability>();
  async select(): Promise<SelectedSource | null> {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Statements", extensions: ["csv", "xlsx", "pdf"] }] }); if (result.canceled || result.filePaths[0] === undefined) return null;
    const path = result.filePaths[0]; const info = await stat(path); const extension = extname(path).toLowerCase(); const mimeType = extension === ".csv" ? "text/csv" : extension === ".xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf"; const token = randomBytes(32).toString("hex"); const source: SelectedSource = { token, displayName: basename(path), mimeType, byteLength: info.size }; this.capabilities.set(token, { path, size: info.size, mtimeMs: info.mtimeMs, expiresAt: Date.now() + 10 * 60_000, source }); return source;
  }
  async consume(token: string): Promise<SelectedSourcePayload> {
    const capability = this.capabilities.get(token); this.capabilities.delete(token); if (!capability || capability.expiresAt < Date.now()) throw new Error("SOURCE_TOKEN_EXPIRED"); const info = await stat(capability.path); if (info.size !== capability.size || info.mtimeMs !== capability.mtimeMs) throw new Error("SOURCE_CHANGED"); const bytes = new Uint8Array(await readFile(capability.path)); return { ...capability.source, bytes, extension: extname(capability.path).toLowerCase() };
  }
}

export class MemoryReviewService implements ImportReviewService {
  private readonly drafts = new Map<ImportBatchId, ImportDraftView>();
  private readonly sourceBytes = new Map<ImportBatchId, Uint8Array>();
  private readonly fallbackCapabilities = new Map<string, { readonly batchId: ContractImportBatchId; readonly expiresAt: number; readonly resolved: ResolvedLlmFallback; readonly view: LlmFallbackSource }>();
  constructor(private readonly workspaceId: WorkspaceId, private readonly persistence?: DraftPersistence, private readonly sourceDocuments?: import("@pwm/application").SourceDocumentStore, private readonly pdfOcr?: PdfOcrPipeline, private readonly pdfRenderer?: PdfPageRenderer, private readonly pdfRenderRoot?: string) {}
  async start(source: SelectedSourcePayload): Promise<ImportDraftView> {
    const sourceDocumentId = randomUUID();
    const sourceSha256 = createHash("sha256").update(source.bytes).digest("hex");
    const input: ParserInput = { sourceDocumentId, mimeType: source.mimeType, extension: source.extension, prefix: source.bytes.subarray(0, 64), bytes: source.bytes, signal: new AbortController().signal };
    const sourceMetadata = await this.sourceDocuments?.put({ workspaceId: this.workspaceId, bytes: source.bytes, mimeType: source.mimeType, extension: source.extension, retention: "encrypted_copy" });
    let candidates: ImportCandidateV1[] = []; const warnings: string[] = []; let ocrPending = false; let pageCount: number | undefined;
    if (source.extension === ".csv") candidates = (await new CanonicalCsvParser().parse(input)).candidates;
    else if (source.extension === ".xlsx") candidates = (await parseSavedValueWorkbook(input, { id: randomUUID(), workspaceId: this.workspaceId, name: "Default spreadsheet", sourceFingerprint: createHash("sha256").update(source.bytes).digest("hex"), columns: { date: "date", description: "description", amount: "amount", currency: "currency" }, dateFormat: "yyyy-MM-dd", decimalSeparator: "." })).candidates;
    else {
      const extracted = await extractPdfText({ bytes: source.bytes, signal: input.signal, limits: { maxBytes: 25 * 1024 * 1024, maxPages: 100, timeoutMs: 30_000 } });
      pageCount = extracted.pageCount;
      candidates = this.pdfCandidates(extracted.pages, "page");
      if (extracted.needsOcr) {
        if (!this.pdfOcr) {
          warnings.push("PDF_OCR_UNAVAILABLE");
          ocrPending = true;
        } else {
          try {
            const ocr = await this.pdfOcr.run({ sourceDocumentId, bytes: source.bytes, pageCount: extracted.pageCount, signal: input.signal });
            candidates = [...candidates, ...this.pdfCandidates(ocr.pages, "ocr")];
            if (ocr.pages.every((page) => page.text.trim().length === 0)) { warnings.push("PDF_OCR_EMPTY"); ocrPending = true; }
          } catch (error: unknown) {
            const code = error instanceof Error ? error.message : "PDF_OCR_FAILED";
            warnings.push(code === "PDF_RENDERER_UNAVAILABLE" ? "PDF_OCR_RENDERER_UNAVAILABLE" : code === "OCR_TIMEOUT" ? "PDF_OCR_TIMEOUT" : "PDF_OCR_FAILED");
            ocrPending = true;
          }
        }
      }
    }
    const batchId = randomUUID() as ImportBatchId;
    const view: ImportDraftView = { batchId, sourceSha256, sourceDocument: { displayName: source.displayName, mimeType: source.mimeType, extension: source.extension, ...(pageCount === undefined ? {} : { pageCount }), ...(sourceMetadata?.objectKey === undefined ? {} : { objectKey: sourceMetadata.objectKey }) }, status: ocrPending ? "needs_ocr" : "needs_review", revision: 0, candidates, skippedRawRecordIds: [], warnings }; this.drafts.set(view.batchId, view); this.sourceBytes.set(view.batchId, new Uint8Array(source.bytes)); await this.persistence?.create(view, source.displayName); return view;
  }
  async get(batchId: ImportBatchId) { const value = this.drafts.get(batchId) ?? await this.persistence?.get(batchId) ?? null; if (!value) throw new Error("IMPORT_BATCH_NOT_FOUND"); this.drafts.set(batchId, value); return value; }
  async list(): Promise<readonly ImportDraftSummary[]> { const persisted = await this.persistence?.list(); if (persisted) return persisted; return [...this.drafts.values()].map((draft) => ({ batchId: draft.batchId, status: draft.status, revision: draft.revision, displayName: "Imported statement", updatedAt: new Date().toISOString() })); }
  async update(input: UpdateCandidateInput) { const draft = await this.get(input.batchId); this.assertRevision(draft, input.expectedRevision); const index = draft.candidates.findIndex((candidate) => candidate.rawRecordId === input.rawRecordId); if (index < 0) throw new Error("RAW_RECORD_NOT_FOUND"); const candidates = [...draft.candidates]; candidates[index] = input.candidate; return this.save({ ...draft, candidates, revision: draft.revision + 1 }, input.expectedRevision); }
  async skip(input: SkipCandidateInput) { const draft = await this.get(input.batchId); this.assertRevision(draft, input.expectedRevision); const candidates = draft.candidates.filter((candidate) => candidate.rawRecordId !== input.rawRecordId); if (candidates.length === draft.candidates.length) throw new Error("RAW_RECORD_NOT_FOUND"); return this.save({ ...draft, candidates, skippedRawRecordIds: [...draft.skippedRawRecordIds, input.rawRecordId], revision: draft.revision + 1 }, input.expectedRevision); }
  async cancel(batchId: ImportBatchId) { const draft = await this.get(batchId); await this.save({ ...draft, status: "cancelled", revision: draft.revision + 1 }, draft.revision); }
  async prepareLlmFallback(input: PrepareLlmFallbackInput): Promise<LlmFallbackSource> {
    const draft = await this.get(input.batchId as ImportBatchId);
    const source = draft.sourceDocument;
    if (!source || source.extension !== ".pdf" || source.mimeType !== "application/pdf") throw new Error("LLM_FALLBACK_PDF_REQUIRED");
    const bytes = await this.readSourceBytes(draft);
    const pageCount = source.pageCount ?? 1;
    const pages = input.mode === "original_pdf" ? Array.from({ length: pageCount }, (_value, index) => index + 1) : (input.pages ?? Array.from({ length: pageCount }, (_value, index) => index + 1));
    this.assertPageSelection(pages, pageCount);
    let resolved: ResolvedLlmFallback;
    let byteLength = bytes.byteLength;
    if (input.mode === "original_pdf") {
      resolved = { batchId: draft.batchId, mode: input.mode, pages, attachments: { file: { filename: source.displayName, mimeType: "application/pdf", bytes } } };
    } else {
      if (!this.pdfRenderer) throw new Error("PDF_RENDERER_UNAVAILABLE");
      const root = this.pdfRenderRoot ?? tmpdir();
      await mkdir(root, { recursive: true, mode: 0o700 });
      const taskDirectory = await mkdtemp(join(root, "llm-fallback-"));
      try {
        const rendered = await this.pdfRenderer.render({ bytes, pageCount, pageNumbers: pages, outputDirectory: taskDirectory, signal: new AbortController().signal, limits: { maxBytes: 25 * 1024 * 1024, maxPages: 100, maxPixelsPerPage: 20_000_000, timeoutMs: 60_000, dpi: 150, maxOutputBytesPerPage: 8 * 1024 * 1024 } });
        const images = await Promise.all(rendered.map(async (page) => ({ mimeType: "image/png" as const, bytes: new Uint8Array(await readFile(page.path)) })));
        byteLength = images.reduce((total, image) => total + image.bytes.byteLength, 0);
        resolved = { batchId: draft.batchId, mode: input.mode, pages, attachments: { images } };
      } finally {
        await rm(taskDirectory, { recursive: true, force: true });
      }
    }
    const token = randomBytes(32).toString("hex");
    const view = { token, batchId: draft.batchId, mode: input.mode, pages, pageCount, byteLength, imageCount: resolved.attachments.images?.length ?? 0, fileCount: resolved.attachments.file ? 1 : 0, mimeType: input.mode === "original_pdf" ? "application/pdf" : "image/png", displayName: source.displayName } satisfies LlmFallbackSource;
    this.fallbackCapabilities.set(token, { batchId: draft.batchId, expiresAt: Date.now() + 10 * 60_000, resolved, view });
    return view;
  }
  prepare(input: PrepareLlmFallbackInput): Promise<LlmFallbackSource> { return this.prepareLlmFallback(input); }
  async resolveLlmFallback(token: string, batchId: ContractImportBatchId): Promise<ResolvedLlmFallback> {
    const capability = this.fallbackCapabilities.get(token);
    if (!capability || capability.expiresAt < Date.now()) { this.fallbackCapabilities.delete(token); throw new Error("LLM_FALLBACK_TOKEN_EXPIRED"); }
    if (capability.batchId !== batchId) throw new Error("LLM_FALLBACK_BATCH_MISMATCH");
    return capability.resolved;
  }
  resolve(token: string, batchId: ContractImportBatchId): Promise<ResolvedLlmFallback> { return this.resolveLlmFallback(token, batchId); }
  consumeLlmFallback(token: string): void { this.fallbackCapabilities.delete(token); }
  consume(token: string): void { this.consumeLlmFallback(token); }
  private assertRevision(draft: ImportDraftView, revision: number) { if (draft.revision !== revision) throw new Error("IMPORT_DRAFT_REVISION_CONFLICT"); }
  private async save(draft: ImportDraftView, expectedRevision?: number) { this.drafts.set(draft.batchId, draft); if (this.persistence && expectedRevision !== undefined) await this.persistence.save(draft, expectedRevision); return draft; }
  private async readSourceBytes(draft: ImportDraftView): Promise<Uint8Array> {
    const memory = this.sourceBytes.get(draft.batchId);
    const bytes = memory ?? (draft.sourceDocument?.objectKey && this.sourceDocuments ? await this.sourceDocuments.read(this.workspaceId, draft.sourceDocument.objectKey) : undefined);
    if (!bytes) throw new Error("LLM_FALLBACK_SOURCE_UNAVAILABLE");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== draft.sourceSha256) throw new Error("LLM_FALLBACK_SOURCE_CHANGED");
    return new Uint8Array(bytes);
  }
  private assertPageSelection(pages: readonly number[], pageCount: number): void {
    if (pages.length < 1 || pages.length > 100 || pages.some((page, index) => page !== index + 1 || page < 1 || page > pageCount)) throw new Error("LLM_FALLBACK_PAGE_SELECTION_INVALID");
  }
  private pdfCandidates(pages: readonly { readonly page: number; readonly text: string }[], source: "page" | "ocr"): ImportCandidateV1[] { return pages.flatMap((page) => page.text.split(/\r?\n/u).flatMap((line, index) => { const match = line.match(/(\d{4}-\d{2}-\d{2}).*?([+-]?\d+(?:\.\d{1,2})?)\s*([A-Z]{3})\b/u); if (!match) return []; const provenance = { source, locator: `page:${page.page}#line:${index + 1}`, producerId: source === "ocr" ? "local-ocr" : "safe-pdf-text", producerVersion: "1.0.0" }; const minor = decimalToMinor(match[2] ?? "0"); const signed = minor > 0n ? -minor : minor; return [parseImportCandidate({ schemaVersion: 1, rawRecordId: randomUUID(), transactionDate: { value: match[1]!, confidence: source === "ocr" ? 0.6 : 0.7, provenance }, description: { value: line.replace(match[0], "").trim() || "PDF transaction", confidence: source === "ocr" ? 0.4 : 0.5, provenance }, amountMinor: { value: signed.toString(), confidence: source === "ocr" ? 0.6 : 0.7, provenance }, currency: { value: match[3]!, confidence: 1, provenance }, direction: { value: signed < 0n ? "debit" : "credit", confidence: source === "ocr" ? 0.6 : 0.7, provenance } })]; })); }
}

class MemoryCommitUnitOfWork implements ImportCommitUnitOfWork {
  private readonly commits = new Map<string, ImportCommitResult>();
  private readonly sources = new Map<string, ImportCommitResult>();
  constructor(private readonly ledgerUnitOfWork: ReturnType<typeof createInMemoryLedgerUnitOfWork>) {}
  async run<T>(work: (transaction: ImportCommitTransaction) => Promise<T>): Promise<T> { return this.ledgerUnitOfWork.run(async ({ ledger }) => work({ ledger, imports: { findCommit: async (_workspace, key) => this.commits.get(key) ?? null, findSourceCommit: async (_workspace, sourceSha256) => this.sources.get(sourceSha256) ?? null, linkRawRecord: async () => undefined, markCommitted: async (_batch, result, key, sourceSha256) => { this.commits.set(key, result); if (sourceSha256) this.sources.set(sourceSha256, result); } } })); }
}
export type LocalImportComposition = { controller: ImportController; accounts: AccountService; ledger: DesktopLedgerService; finance: DesktopFinanceService; activity: ActivityLogPort; activityService: DesktopActivityService; llmFallback: ImportLlmFallbackService; workspace?: LocalWorkspace; close: () => Promise<void> };

export function createInMemoryImportController(options: { readonly pdfOcr?: PdfOcrPipeline; readonly pdfRenderer?: PdfPageRenderer; readonly pdfRenderRoot?: string } = {}): LocalImportComposition { const workspaceId = randomUUID() as WorkspaceId; const reviews = new MemoryReviewService(workspaceId, undefined, undefined, options.pdfOcr, options.pdfRenderer, options.pdfRenderRoot); const ledgerUnitOfWork = createInMemoryLedgerUnitOfWork(); const commits = new CommitImportBatchCommand(new MemoryCommitUnitOfWork(ledgerUnitOfWork), { journal: () => randomUUID() as never, posting: () => randomUUID() as never }); const activity = new MemoryActivityLog(); const activityService = createDesktopActivityService({ workspaceId, log: activity, unitOfWork: ledgerUnitOfWork }); return { controller: new DesktopImportController(new DialogSourceSelection(), reviews, commits, workspaceId, activity), accounts: new MemoryAccountService(workspaceId), ledger: createInMemoryLedgerService(workspaceId, activity, ledgerUnitOfWork), finance: createInMemoryFinanceService(workspaceId), activity, activityService, llmFallback: reviews, close: async () => undefined }; }

export type LocalImportControllerOptions = { readonly pdfOcr?: PdfOcrPipeline; readonly pdfRenderer?: PdfPageRenderer; readonly pdfRenderRoot?: string; readonly workspacePassword?: string };

export async function createLocalImportController(options: LocalImportControllerOptions = {}): Promise<LocalImportComposition> {
  if (typeof app.getPath !== "function") return createInMemoryImportController(options);
  const workspace = await openLocalWorkspace(options.workspacePassword === undefined ? {} : { password: options.workspacePassword });
  const reviews = new MemoryReviewService(workspace.workspaceId as WorkspaceId, new SqlImportDraftStore(workspace.connection, workspace.workspaceId as WorkspaceId), workspace.sourceDocuments, options.pdfOcr, options.pdfRenderer, options.pdfRenderRoot);
  const commits = new CommitImportBatchCommand(new SqlImportUnitOfWork(workspace.connection), { journal: () => randomUUID() as never, posting: () => randomUUID() as never });
  const activity = new SqlActivityLog(workspace.connection);
  const ledgerUnitOfWork = createSqlLedgerUnitOfWork(workspace.connection);
  const ledger = createDesktopLedgerService({ workspaceId: workspace.workspaceId as WorkspaceId, unitOfWork: ledgerUnitOfWork, activity });
  const activityService = createDesktopActivityService({ workspaceId: workspace.workspaceId as WorkspaceId, log: activity, unitOfWork: ledgerUnitOfWork });
  const sqlAccounts = createSqlAccountRepository(workspace.connection, { account: () => randomUUID() as never });
  const accounts: AccountService = { list: () => sqlAccounts.list(workspace.workspaceId), create: (input) => sqlAccounts.create({ ...input, workspaceId: workspace.workspaceId as never }) };
  if ((await accounts.list()).length === 0) { await accounts.create({ name: "Cash", kind: "asset", currency: "AED" as never }); await accounts.create({ name: "Uncategorized", kind: "expense", currency: "AED" as never }); }
  const finance = createSqlFinanceService({ workspaceId: workspace.workspaceId as WorkspaceId, connection: workspace.connection });
  return { controller: new DesktopImportController(new DialogSourceSelection(), reviews, commits, workspace.workspaceId as WorkspaceId, activity), accounts, ledger, finance, activity, activityService, llmFallback: reviews, workspace, close: workspace.close };
}
