import { app, dialog } from "electron";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { AccountDto, ActivityOperation, CreateAccountInput, ImportCandidateV1, ImportDraftView, ImportDraftSummary, SelectedSource, WorkspaceId } from "@pwm/contracts";
import { parseImportCandidate } from "@pwm/contracts";
import { CanonicalCsvParser, decimalToMinor, extractPdfText, parseSavedValueWorkbook, type ParserInput } from "@pwm/importer";
import { CommitImportBatchCommand, type ActivityLogPort, type ImportCommitResult, type ImportCommitTransaction, type ImportCommitUnitOfWork } from "@pwm/application";
import type { ImportBatchId, SkipCandidateInput, UpdateCandidateInput } from "@pwm/contracts";
import { createSqlAccountRepository, createSqlLedgerUnitOfWork, SqlActivityLog, SqlImportDraftStore, SqlImportUnitOfWork } from "@pwm/storage";
import { DesktopImportController, type ImportController, type ImportReviewService, type SelectedSourcePayload, type SourceSelectionPort } from "./import-controller";
import { openLocalWorkspace } from "../workspace/local-workspace";
import { createDesktopLedgerService, createInMemoryLedgerService, type DesktopLedgerService } from "../ledger/ledger-service";
import { createInMemoryFinanceService, createSqlFinanceService, type DesktopFinanceService } from "../finance/finance-service";
import type { PdfOcrPipeline } from "./ocr-pipeline";

type Capability = { path: string; size: number; mtimeMs: number; expiresAt: number; source: SelectedSource };
export interface DraftPersistence {
  create(draft: ImportDraftView, displayName: string): Promise<void>;
  get(batchId: ImportBatchId): Promise<ImportDraftView | null>;
  list(): Promise<readonly ImportDraftSummary[]>;
  save(draft: ImportDraftView, expectedRevision: number): Promise<void>;
}

export interface AccountService { list(): Promise<readonly AccountDto[]>; create(input: Omit<CreateAccountInput, "workspaceId">): Promise<AccountDto> }

class MemoryAccountService implements AccountService {
  private readonly values: AccountDto[] = [];
  constructor(private readonly workspaceId: WorkspaceId) {}
  async list(): Promise<readonly AccountDto[]> { return [...this.values]; }
  async create(input: Omit<CreateAccountInput, "workspaceId">): Promise<AccountDto> { const now = new Date().toISOString(); const value: AccountDto = { id: randomUUID() as never, workspaceId: this.workspaceId, name: input.name.trim(), kind: input.kind, currency: input.currency, version: 0, deletedAt: null, createdAt: now, updatedAt: now }; this.values.push(value); return value; }
}

class MemoryActivityLog implements ActivityLogPort {
  private latestOperation: ActivityOperation | null = null;
  async append(operation: ActivityOperation): Promise<void> { this.latestOperation = operation; }
  async latest(workspaceId: WorkspaceId): Promise<ActivityOperation | null> { return this.latestOperation?.workspaceId === workspaceId ? this.latestOperation : null; }
  async markUndone(operationId: ActivityOperation["id"], undoneAt: string): Promise<void> { if (this.latestOperation?.id === operationId) this.latestOperation = { ...this.latestOperation, undoneAt, updatedAt: undoneAt }; }
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
  constructor(private readonly workspaceId: WorkspaceId, private readonly persistence?: DraftPersistence, private readonly sourceDocuments?: import("@pwm/application").SourceDocumentStore, private readonly pdfOcr?: PdfOcrPipeline) {}
  async start(source: SelectedSourcePayload): Promise<ImportDraftView> {
    const sourceDocumentId = randomUUID();
    const input: ParserInput = { sourceDocumentId, mimeType: source.mimeType, extension: source.extension, prefix: source.bytes.subarray(0, 64), bytes: source.bytes, signal: new AbortController().signal };
    await this.sourceDocuments?.put({ workspaceId: this.workspaceId, bytes: source.bytes, mimeType: source.mimeType, extension: source.extension, retention: "encrypted_copy" });
    let candidates: ImportCandidateV1[] = []; const warnings: string[] = []; let ocrPending = false;
    if (source.extension === ".csv") candidates = (await new CanonicalCsvParser().parse(input)).candidates;
    else if (source.extension === ".xlsx") candidates = (await parseSavedValueWorkbook(input, { id: randomUUID(), workspaceId: this.workspaceId, name: "Default spreadsheet", sourceFingerprint: createHash("sha256").update(source.bytes).digest("hex"), columns: { date: "date", description: "description", amount: "amount", currency: "currency" }, dateFormat: "yyyy-MM-dd", decimalSeparator: "." })).candidates;
    else {
      const extracted = await extractPdfText({ bytes: source.bytes, signal: input.signal, limits: { maxBytes: 25 * 1024 * 1024, maxPages: 100, timeoutMs: 30_000 } });
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
    const view: ImportDraftView = { batchId: randomUUID() as ImportBatchId, status: ocrPending ? "needs_ocr" : "needs_review", revision: 0, candidates, skippedRawRecordIds: [], warnings }; this.drafts.set(view.batchId, view); await this.persistence?.create(view, source.displayName); return view;
  }
  async get(batchId: ImportBatchId) { const value = this.drafts.get(batchId) ?? await this.persistence?.get(batchId) ?? null; if (!value) throw new Error("IMPORT_BATCH_NOT_FOUND"); this.drafts.set(batchId, value); return value; }
  async list(): Promise<readonly ImportDraftSummary[]> { const persisted = await this.persistence?.list(); if (persisted) return persisted; return [...this.drafts.values()].map((draft) => ({ batchId: draft.batchId, status: draft.status, revision: draft.revision, displayName: "Imported statement", updatedAt: new Date().toISOString() })); }
  async update(input: UpdateCandidateInput) { const draft = await this.get(input.batchId); this.assertRevision(draft, input.expectedRevision); const index = draft.candidates.findIndex((candidate) => candidate.rawRecordId === input.rawRecordId); if (index < 0) throw new Error("RAW_RECORD_NOT_FOUND"); const candidates = [...draft.candidates]; candidates[index] = input.candidate; return this.save({ ...draft, candidates, revision: draft.revision + 1 }, input.expectedRevision); }
  async skip(input: SkipCandidateInput) { const draft = await this.get(input.batchId); this.assertRevision(draft, input.expectedRevision); const candidates = draft.candidates.filter((candidate) => candidate.rawRecordId !== input.rawRecordId); if (candidates.length === draft.candidates.length) throw new Error("RAW_RECORD_NOT_FOUND"); return this.save({ ...draft, candidates, skippedRawRecordIds: [...draft.skippedRawRecordIds, input.rawRecordId], revision: draft.revision + 1 }, input.expectedRevision); }
  async cancel(batchId: ImportBatchId) { const draft = await this.get(batchId); await this.save({ ...draft, status: "cancelled", revision: draft.revision + 1 }, draft.revision); }
  private assertRevision(draft: ImportDraftView, revision: number) { if (draft.revision !== revision) throw new Error("IMPORT_DRAFT_REVISION_CONFLICT"); }
  private async save(draft: ImportDraftView, expectedRevision?: number) { this.drafts.set(draft.batchId, draft); if (this.persistence && expectedRevision !== undefined) await this.persistence.save(draft, expectedRevision); return draft; }
  private pdfCandidates(pages: readonly { readonly page: number; readonly text: string }[], source: "page" | "ocr"): ImportCandidateV1[] { return pages.flatMap((page) => page.text.split(/\r?\n/u).flatMap((line, index) => { const match = line.match(/(\d{4}-\d{2}-\d{2}).*?([+-]?\d+(?:\.\d{1,2})?)\s*([A-Z]{3})\b/u); if (!match) return []; const provenance = { source, locator: `page:${page.page}#line:${index + 1}`, producerId: source === "ocr" ? "local-ocr" : "safe-pdf-text", producerVersion: "1.0.0" }; const minor = decimalToMinor(match[2] ?? "0"); const signed = minor > 0n ? -minor : minor; return [parseImportCandidate({ schemaVersion: 1, rawRecordId: randomUUID(), transactionDate: { value: match[1]!, confidence: source === "ocr" ? 0.6 : 0.7, provenance }, description: { value: line.replace(match[0], "").trim() || "PDF transaction", confidence: source === "ocr" ? 0.4 : 0.5, provenance }, amountMinor: { value: signed.toString(), confidence: source === "ocr" ? 0.6 : 0.7, provenance }, currency: { value: match[3]!, confidence: 1, provenance }, direction: { value: signed < 0n ? "debit" : "credit", confidence: source === "ocr" ? 0.6 : 0.7, provenance } })]; })); }
}

class MemoryCommitUnitOfWork implements ImportCommitUnitOfWork {
  private readonly commits = new Map<string, ImportCommitResult>(); private readonly journals: unknown[] = [];
  async run<T>(work: (transaction: ImportCommitTransaction) => Promise<T>): Promise<T> { return work({ ledger: { saveJournal: async (journal) => { this.journals.push(journal); } }, imports: { findCommit: async (_workspace, key) => this.commits.get(key) ?? null, linkRawRecord: async () => undefined, markCommitted: async (_batch, result, key) => { this.commits.set(key, result); } } }); }
}
export type LocalImportComposition = { controller: ImportController; accounts: AccountService; ledger: DesktopLedgerService; finance: DesktopFinanceService; activity: ActivityLogPort; close: () => Promise<void> };

export function createInMemoryImportController(options: { readonly pdfOcr?: PdfOcrPipeline } = {}): LocalImportComposition { const workspaceId = randomUUID() as WorkspaceId; const reviews = new MemoryReviewService(workspaceId, undefined, undefined, options.pdfOcr); const commits = new CommitImportBatchCommand(new MemoryCommitUnitOfWork(), { journal: () => randomUUID() as never, posting: () => randomUUID() as never }); const activity = new MemoryActivityLog(); return { controller: new DesktopImportController(new DialogSourceSelection(), reviews, commits, workspaceId, activity), accounts: new MemoryAccountService(workspaceId), ledger: createInMemoryLedgerService(workspaceId, activity), finance: createInMemoryFinanceService(workspaceId), activity, close: async () => undefined }; }

export type LocalImportControllerOptions = { readonly pdfOcr?: PdfOcrPipeline };

export async function createLocalImportController(options: LocalImportControllerOptions = {}): Promise<LocalImportComposition> {
  if (typeof app.getPath !== "function") return createInMemoryImportController(options);
  const workspace = await openLocalWorkspace();
  const reviews = new MemoryReviewService(workspace.workspaceId as WorkspaceId, new SqlImportDraftStore(workspace.connection, workspace.workspaceId as WorkspaceId), workspace.sourceDocuments, options.pdfOcr);
  const commits = new CommitImportBatchCommand(new SqlImportUnitOfWork(workspace.connection), { journal: () => randomUUID() as never, posting: () => randomUUID() as never });
  const activity = new SqlActivityLog(workspace.connection);
  const ledger = createDesktopLedgerService({ workspaceId: workspace.workspaceId as WorkspaceId, unitOfWork: createSqlLedgerUnitOfWork(workspace.connection), activity });
  const sqlAccounts = createSqlAccountRepository(workspace.connection, { account: () => randomUUID() as never });
  const accounts: AccountService = { list: () => sqlAccounts.list(workspace.workspaceId), create: (input) => sqlAccounts.create({ ...input, workspaceId: workspace.workspaceId as never }) };
  if ((await accounts.list()).length === 0) { await accounts.create({ name: "Cash", kind: "asset", currency: "AED" as never }); await accounts.create({ name: "Uncategorized", kind: "expense", currency: "AED" as never }); }
  const finance = createSqlFinanceService({ workspaceId: workspace.workspaceId as WorkspaceId, connection: workspace.connection });
  return { controller: new DesktopImportController(new DialogSourceSelection(), reviews, commits, workspace.workspaceId as WorkspaceId, activity), accounts, ledger, finance, activity, close: workspace.close };
}
