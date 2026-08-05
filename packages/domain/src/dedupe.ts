export type DedupeStrength = "exact-source" | "stable-reference" | "fingerprint" | "similar" | "none";
export interface DedupeRecord { readonly accountId: string; readonly sourceHash: string; readonly sourceLocator: string; readonly stableReference: string | null; readonly date: string; readonly minor: bigint; readonly currency: string; readonly normalizedDescription: string; readonly balanceMinor: bigint | null }

export function detectDuplicate(left: DedupeRecord, right: DedupeRecord): DedupeStrength {
  if (left.sourceHash === right.sourceHash && left.sourceLocator === right.sourceLocator) return "exact-source";
  if (left.accountId === right.accountId && left.stableReference !== null && left.stableReference === right.stableReference) return "stable-reference";
  const fingerprint = left.accountId === right.accountId && left.date === right.date && left.minor === right.minor && left.currency === right.currency && left.normalizedDescription === right.normalizedDescription && left.balanceMinor === right.balanceMinor;
  if (fingerprint) return "fingerprint";
  if (left.accountId === right.accountId && left.minor === right.minor && left.currency === right.currency && left.normalizedDescription === right.normalizedDescription) return "similar";
  return "none";
}
