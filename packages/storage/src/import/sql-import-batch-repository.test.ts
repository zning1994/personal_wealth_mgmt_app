import { describe, expect, it } from "vitest";
import { SqlImportBatchRepository } from "./sql-import-batch-repository.js";
import type { ImportDraft } from "@pwm/contracts";

const draft = { batchId: "018f8f19-2d6a-7b00-8000-000000000010", workspaceId: "018f8f19-2d6a-7b00-8000-000000000099", status: "draft", revision: 0, updatedAt: "2026-08-04T00:00:00.000Z", candidateCount: 0, skippedCount: 0 } as unknown as ImportDraft;

describe("SqlImportBatchRepository", () => {
  it("loads a persisted encrypted-database snapshot and enforces revision CAS", async () => {
    let stored: unknown = null;
    const repository = new SqlImportBatchRepository({
      getImportDraft: async () => stored,
      compareAndSwapImportDraft: async (_id, expected, next) => {
        if (stored !== null && (stored as ImportDraft).revision !== expected) return false;
        stored = next; return true;
      },
    });
    await repository.save(draft, 0);
    await expect(repository.load(draft.batchId)).resolves.toEqual(draft);
    await expect(repository.save({ ...draft, revision: 1 }, 7)).rejects.toThrow("IMPORT_DRAFT_REVISION_CONFLICT");
  });
});
