import { CommitImportInputSchema, CreateImportDraftInputSchema, ImportBatchIdSchema, ImportDraftSummarySchema, ImportDraftViewSchema, SelectedSourceSchema, SkipCandidateInputSchema, UpdateCandidateInputSchema, CommittedBatchViewSchema, WorkspaceIdSchema, PrepareLlmFallbackInputSchema, LlmFallbackSourceSchema } from "@pwm/contracts";
import type { ImportController } from "./import-controller";
export interface IpcHandleRegistrar { handle(channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>): void; removeHandler?(channel: string): void }
export function registerImportIpc(ipc: IpcHandleRegistrar, controller: ImportController): () => void {
  ipc.handle("imports:get-workspace-id", async () => WorkspaceIdSchema.parse(await controller.getWorkspaceId()));
  ipc.handle("imports:select-source", async () => { const value = await controller.selectSource(); return value === null ? null : SelectedSourceSchema.parse(value); });
  ipc.handle("imports:create-draft", async (_event, payload) => ImportDraftViewSchema.parse(await controller.createDraft(CreateImportDraftInputSchema.parse(payload))));
  ipc.handle("imports:get-draft", async (_event, payload) => ImportDraftViewSchema.parse(await controller.getDraft(ImportBatchIdSchema.parse(payload))));
  ipc.handle("imports:list-drafts", async () => (await controller.listDrafts()).map((item) => ImportDraftSummarySchema.parse(item)));
  ipc.handle("imports:update-candidate", async (_event, payload) => ImportDraftViewSchema.parse(await controller.updateCandidate(UpdateCandidateInputSchema.parse(payload))));
  ipc.handle("imports:skip-candidate", async (_event, payload) => ImportDraftViewSchema.parse(await controller.skipCandidate(SkipCandidateInputSchema.parse(payload))));
  ipc.handle("imports:cancel", async (_event, payload) => { await controller.cancel(ImportBatchIdSchema.parse(payload)); return undefined; });
  ipc.handle("imports:commit", async (_event, payload) => CommittedBatchViewSchema.parse(await controller.commit(CommitImportInputSchema.parse(payload))));
  ipc.handle("imports:prepare-llm-fallback", async (_event, payload) => LlmFallbackSourceSchema.parse(await controller.prepareLlmFallback?.(PrepareLlmFallbackInputSchema.parse(payload))));
  return () => { for (const channel of ["imports:get-workspace-id", "imports:select-source", "imports:create-draft", "imports:get-draft", "imports:list-drafts", "imports:update-candidate", "imports:skip-candidate", "imports:cancel", "imports:commit", "imports:prepare-llm-fallback"]) ipc.removeHandler?.(channel); };
}
