import { describe, expect, it } from "vitest";
import { cancelImportBatch, resumeImportBatch, transitionImportBatch } from "./import-state-machine.js";
import type { ImportBatchId, ImportDraft, WorkspaceId } from "@pwm/contracts";

const draft: ImportDraft = { batchId: "018f8f19-2d6a-7b00-8000-000000000010" as ImportBatchId, workspaceId: "018f8f19-2d6a-7b00-8000-000000000099" as WorkspaceId, status: "draft", revision: 0, updatedAt: "2026-08-04T00:00:00.000Z", candidateCount: 0, skippedCount: 0 };

describe("import state machine", () => {
  it("persists a legal transition and rejects an illegal jump", async () => {
    let current = draft;
    const repository = { load: async () => current, save: async (next: ImportDraft, expected: number) => { expect(expected).toBe(current.revision); current = next; } };
    await expect(transitionImportBatch(repository, draft.batchId, "extracting")).resolves.toMatchObject({ status: "extracting", revision: 1 });
    await expect(transitionImportBatch(repository, draft.batchId, "committed")).rejects.toThrow("INVALID_IMPORT_TRANSITION");
  });

  it("resumes a persisted draft and cancels an eligible batch", async () => {
    let current: ImportDraft = { ...draft, status: "needs_review" };
    const repository = { load: async () => current, save: async (next: ImportDraft) => { current = next; } };
    await expect(resumeImportBatch(repository, draft.batchId)).resolves.toMatchObject({ status: "needs_review" });
    await expect(cancelImportBatch(repository, draft.batchId, "user_cancelled")).resolves.toMatchObject({ status: "cancelled", cancelReason: "user_cancelled" });
  });
});
