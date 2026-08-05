import type { ImportCandidateV1 } from "@pwm/contracts";
import type { DuplicateContext, DuplicateDetector, DuplicateMatch, TransferMatch, TransferMatcher } from "../ports/import-integration";

export type EnrichedImportCandidate = { candidate: ImportCandidateV1; duplicateMatches: readonly DuplicateMatch[]; transferMatches: readonly TransferMatch[] };
export async function enrichImportCandidates(candidates: readonly ImportCandidateV1[], ports: { duplicateDetector: DuplicateDetector; transferMatcher: TransferMatcher }, context: DuplicateContext): Promise<readonly EnrichedImportCandidate[]> {
  return Promise.all(candidates.map(async (candidate) => ({ candidate, duplicateMatches: await ports.duplicateDetector.find(candidate, context), transferMatches: await ports.transferMatcher.find(candidate, { workspaceId: context.workspaceId, accountId: context.accountId }) })));
}
