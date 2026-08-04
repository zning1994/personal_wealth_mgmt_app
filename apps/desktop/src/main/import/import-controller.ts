import type { ActivityLogPort, CommitImportBatchCommand } from "@pwm/application";
import type { CommitImportInput, CommittedBatchView, CreateImportDraftInput, ImportBatchId, ImportDraftSummary, ImportDraftView, SelectedSource, SkipCandidateInput, UpdateCandidateInput, WorkspaceId } from "@pwm/contracts";
import type { ImportCommitRequest } from "@pwm/application";

export type SelectedSourcePayload = SelectedSource & { bytes: Uint8Array; extension: string };
export interface SourceSelectionPort { select(): Promise<SelectedSource | null>; consume(token: string): Promise<SelectedSourcePayload> }
export interface ImportReviewService { start(source: SelectedSourcePayload): Promise<ImportDraftView>; get(batchId: ImportBatchId): Promise<ImportDraftView>; list(): Promise<readonly ImportDraftSummary[]>; update(input: UpdateCandidateInput): Promise<ImportDraftView>; skip(input: SkipCandidateInput): Promise<ImportDraftView>; cancel(batchId: ImportBatchId): Promise<void> }
export interface ImportController { getWorkspaceId(): Promise<WorkspaceId>; selectSource(): Promise<SelectedSource | null>; createDraft(input: CreateImportDraftInput): Promise<ImportDraftView>; getDraft(batchId: ImportBatchId): Promise<ImportDraftView>; listDrafts(): Promise<readonly ImportDraftSummary[]>; updateCandidate(input: UpdateCandidateInput): Promise<ImportDraftView>; skipCandidate(input: SkipCandidateInput): Promise<ImportDraftView>; cancel(batchId: ImportBatchId): Promise<void>; commit(input: CommitImportInput): Promise<CommittedBatchView> }
export class DesktopImportController implements ImportController {
  constructor(private readonly sources: SourceSelectionPort, private readonly reviews: ImportReviewService, private readonly commits: CommitImportBatchCommand, private readonly workspace?: WorkspaceId, private readonly activity?: ActivityLogPort) {}
  getWorkspaceId() { if (!this.workspace) return Promise.reject(new Error("WORKSPACE_CONTEXT_UNAVAILABLE")); return Promise.resolve(this.workspace); }
  selectSource() { return this.sources.select(); }
  async createDraft(input: CreateImportDraftInput) { return this.reviews.start(await this.sources.consume(input.sourceToken)); }
  getDraft(batchId: ImportBatchId) { return this.reviews.get(batchId); }
  listDrafts() { return this.reviews.list(); }
  updateCandidate(input: UpdateCandidateInput) { return this.reviews.update(input); }
  skipCandidate(input: SkipCandidateInput) { return this.reviews.skip(input); }
  cancel(batchId: ImportBatchId) { return this.reviews.cancel(batchId); }
  async commit(input: CommitImportInput) { const request: ImportCommitRequest = { ...input, entries: input.entries.map((entry) => ({ ...entry, postings: entry.postings.map((posting) => ({ ...posting, amountMinor: BigInt(posting.amountMinor), currency: posting.currency as never })) })) }; const result = await this.commits.execute(request); if (this.activity?.append) { const timestamp = new Date().toISOString(); await this.activity.append({ id: crypto.randomUUID() as never, workspaceId: input.workspaceId as WorkspaceId, kind: "bulk-import", entityType: "import-batch", entityId: input.batchId, summary: `Committed ${result.journalIds.length} journal entr${result.journalIds.length === 1 ? "y" : "ies"}`, createdAt: timestamp, updatedAt: timestamp, version: 0, deletedAt: null, undoable: false, undoneAt: null, dependsOn: [] }); } return result as CommittedBatchView; }
}
