import type { Currency, WorkspaceId } from "@pwm/contracts";
import type { RationalRate } from "@pwm/fx";
import type { FxOverrideRepository, ManualFxOverrideRecord } from "../ports/fx-repository";

export class SaveFxOverrideCommand {
  constructor(
    private readonly repository: FxOverrideRepository,
    private readonly createId: () => string,
  ) {}

  async execute(input: {
    readonly id?: string;
    readonly workspaceId: WorkspaceId;
    readonly from: Currency;
    readonly to: Currency;
    readonly numerator: bigint;
    readonly denominator: bigint;
    readonly asOf: string;
  }): Promise<ManualFxOverrideRecord> {
    if (input.from === input.to || input.numerator <= 0n || input.denominator <= 0n) {
      throw new Error("INVALID_FX_OVERRIDE");
    }
    const existing = await this.repository.findManualOverride({
      workspaceId: input.workspaceId,
      from: input.from,
      to: input.to,
      asOf: input.asOf,
    });
    if (input.id !== undefined && (existing === null || existing.id !== input.id)) {
      throw new Error("FX_OVERRIDE_NOT_FOUND");
    }
    const override: ManualFxOverrideRecord = {
      id: existing?.id ?? input.id ?? this.createId(),
      workspaceId: input.workspaceId,
      rate: {
        from: input.from,
        to: input.to,
        numerator: input.numerator,
        denominator: input.denominator,
        quoteIds: [],
        asOf: input.asOf,
      } satisfies RationalRate,
      deletedAt: null,
      version: (existing?.version ?? -1) + 1,
    };
    await this.repository.saveManualOverride(override, existing?.version ?? null);
    return override;
  }
}

export class DeleteFxOverrideCommand {
  constructor(private readonly repository: FxOverrideRepository) {}

  async execute(input: {
    readonly workspaceId: WorkspaceId;
    readonly id: string;
    readonly from: Currency;
    readonly to: Currency;
    readonly asOf: string;
    readonly deletedAt: string;
  }): Promise<void> {
    const existing = await this.repository.findManualOverride(input);
    if (existing === null || existing.id !== input.id || existing.deletedAt !== null) {
      throw new Error("FX_OVERRIDE_NOT_FOUND");
    }
    await this.repository.deleteManualOverride(
      { workspaceId: input.workspaceId, id: input.id, deletedAt: input.deletedAt },
      existing.version,
    );
  }
}
