import type { ImportCandidateV1 } from "@pwm/contracts";

export type DuplicateContext = { workspaceId: string; accountId: string; sourceSha256: string };
export type DuplicateMatch = { journalId: string; score: number; basis: "source_hash_locator" | "stable_reference" | "account_fingerprint" | "similarity" };
export interface DuplicateDetector { find(candidate: ImportCandidateV1, context: DuplicateContext): Promise<DuplicateMatch[]> }
export type TransferContext = { workspaceId: string; accountId: string };
export type TransferMatch = { journalId: string; score: number; basis: readonly ("different_account" | "opposite_amount" | "currency" | "date_window" | "description" | "reference" | "fx_fee")[] };
export interface TransferMatcher { find(candidate: ImportCandidateV1, context: TransferContext): Promise<TransferMatch[]> }
