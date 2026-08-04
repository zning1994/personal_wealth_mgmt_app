import type { Currency, WorkspaceId } from "@pwm/contracts";
import type { RationalRate } from "@pwm/fx";

export interface ManualFxOverrideRecord {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly rate: RationalRate;
  readonly deletedAt: string | null;
  readonly version: number;
}

export interface FxOverrideRepository {
  saveManualOverride(
    override: ManualFxOverrideRecord,
    expectedVersion: number | null,
  ): Promise<void>;
  deleteManualOverride(
    input: {
      readonly workspaceId: WorkspaceId;
      readonly id: string;
      readonly deletedAt: string;
    },
    expectedVersion: number,
  ): Promise<void>;
  findManualOverride(input: {
    readonly workspaceId: WorkspaceId;
    readonly from: Currency;
    readonly to: Currency;
    readonly asOf: string;
  }): Promise<ManualFxOverrideRecord | null>;
}
