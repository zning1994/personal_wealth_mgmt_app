import type { ActivityOperationId, AccountId, Currency, JournalEntryId, PostingId, WorkspaceId } from "@pwm/contracts";
import type { PostingRole } from "@pwm/domain";

export const DEFAULT_INVERSE_RETENTION = Object.freeze({ days: 30, maxOperations: 100 });

/**
 * Serializable journal state retained for a bounded undo window.
 * Amounts are strings so the inverse can safely cross the IPC/storage boundary.
 */
export interface ActivityJournalSnapshot {
  readonly id: JournalEntryId;
  readonly workspaceId: WorkspaceId;
  readonly occurredOn: string;
  readonly description: string;
  readonly postings: readonly ActivityPostingSnapshot[];
  readonly version: number;
  readonly deletedAt: string | null;
  readonly transferLinkId: string | null;
}

export interface ActivityPostingSnapshot {
  readonly id: PostingId;
  readonly accountId: AccountId;
  readonly amountMinor: string;
  readonly currency: Currency;
  readonly role: PostingRole;
}

export type ActivityInverse =
  | {
      readonly kind: "replace-journals";
      readonly snapshots: readonly ActivityJournalSnapshot[];
      readonly expectedVersions: readonly number[];
    }
  | {
      readonly kind: "restore-journals";
      readonly snapshots: readonly ActivityJournalSnapshot[];
      readonly expectedVersions: readonly number[];
    }
  | {
      readonly kind: "soft-delete-journals";
      readonly journalIds: readonly JournalEntryId[];
      readonly expectedVersions: readonly number[];
    }
  | {
      readonly kind: "set-transfer-link";
      readonly journalIds: readonly [JournalEntryId, JournalEntryId];
      readonly linkId: string | null;
      readonly expectedVersions: readonly [number, number];
    };

export interface ActivityRecord {
  readonly operation: import("@pwm/contracts").ActivityOperation;
  readonly inverse: ActivityInverse | null;
}

export function activityInverseTargetIds(inverse: ActivityInverse | null): readonly string[] {
  if (!inverse) return [];
  if (inverse.kind === "set-transfer-link") return [...inverse.journalIds];
  if (inverse.kind === "soft-delete-journals") return [...inverse.journalIds];
  return inverse.snapshots.map((snapshot) => snapshot.id);
}

export function activityOperationId(value: string): ActivityOperationId {
  return value as ActivityOperationId;
}
