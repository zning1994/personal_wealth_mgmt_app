import type { JournalEntry } from "./ledger";

export interface TransferCandidate { readonly accountId: string; readonly date: string; readonly currency: string; readonly minor: bigint; readonly description: string; readonly reference: string | null; readonly principalValuation: { readonly currency: string; readonly minor: bigint } | null; readonly feeMinor: bigint }
export interface TransferScorePolicy { readonly dateWindowDays: number }
export interface TransferScore { readonly score: number; readonly reasons: readonly string[] }

const dayDistance = (left: string, right: string): number => Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;

export function scoreInternalTransferPair(left: TransferCandidate, right: TransferCandidate, policy: TransferScorePolicy = { dateWindowDays: 3 }): TransferScore {
  const reasons: string[] = [];
  let score = 0;
  if (left.accountId !== right.accountId) { score += 15; reasons.push("different-account"); }
  if (left.minor === -right.minor) { score += 35; reasons.push("opposite-amount"); }
  if (left.currency === right.currency) { score += 15; reasons.push("same-currency"); }
  if (left.currency !== right.currency && left.principalValuation && right.principalValuation && left.principalValuation.currency === right.principalValuation.currency && left.principalValuation.minor === -right.principalValuation.minor) { score += 30; reasons.push("fx-value-match"); }
  if (dayDistance(left.date, right.date) <= policy.dateWindowDays) { score += 10; reasons.push("date-window"); }
  if (left.reference !== null && left.reference === right.reference) { score += 15; reasons.push("reference-match"); }
  const tokens = new Set(left.description.toLocaleLowerCase().split(/\W+/u).filter(Boolean));
  if (right.description.toLocaleLowerCase().split(/\W+/u).some((token) => tokens.has(token))) { score += 5; reasons.push("description-overlap"); }
  if (left.feeMinor !== 0n || right.feeMinor !== 0n) { score += 5; reasons.push("fee-evidence"); }
  return { score, reasons };
}

export function linkTransfer(left: JournalEntry, right: JournalEntry, linkId: string): readonly [JournalEntry, JournalEntry] {
  if (!linkId || left.workspaceId !== right.workspaceId || left.id === right.id || left.transferLinkId || right.transferLinkId) throw new Error("Journals cannot be linked");
  return [{ ...left, transferLinkId: linkId, version: left.version + 1 }, { ...right, transferLinkId: linkId, version: right.version + 1 }];
}

export function unlinkTransfer(entry: JournalEntry): JournalEntry {
  if (!entry.transferLinkId) throw new Error("Journal is not linked");
  return { ...entry, transferLinkId: null, version: entry.version + 1 };
}
