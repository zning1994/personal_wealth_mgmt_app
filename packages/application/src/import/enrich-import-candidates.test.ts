import { describe, expect, it, vi } from "vitest";
import { enrichImportCandidates } from "./enrich-import-candidates";
import type { ImportCandidateV1 } from "@pwm/contracts";

describe("enrichImportCandidates", () => {
  it("attaches suggestions without mutating or auto-merging a candidate", async () => {
    const candidate = { schemaVersion: 1, rawRecordId: crypto.randomUUID() } as unknown as ImportCandidateV1;
    const duplicateDetector = { find: vi.fn(async () => [{ journalId: crypto.randomUUID(), score: 1, basis: "source_hash_locator" as const }]) };
    const transferMatcher = { find: vi.fn(async () => [{ journalId: crypto.randomUUID(), score: 0.91, basis: ["opposite_amount", "date_window"] as const }]) };
    const result = await enrichImportCandidates([candidate], { duplicateDetector, transferMatcher }, { workspaceId: crypto.randomUUID(), accountId: crypto.randomUUID(), sourceSha256: "a".repeat(64) });
    expect(result[0]?.candidate).toBe(candidate); expect(result[0]?.duplicateMatches).toHaveLength(1); expect(result[0]?.transferMatches).toHaveLength(1);
  });
});
