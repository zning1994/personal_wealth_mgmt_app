import { describe, expect, it } from "vitest";
import { DeleteFxOverrideCommand, SaveFxOverrideCommand } from "../src";
import type { FxOverrideRepository, ManualFxOverrideRecord } from "../src/ports/fx-repository";

const workspace = "00000000-0000-4000-8000-000000000001" as never;

class MemoryOverrides implements FxOverrideRepository {
  value: ManualFxOverrideRecord | null = null;
  async saveManualOverride(override: ManualFxOverrideRecord, expectedVersion: number | null): Promise<void> {
    if ((this.value?.version ?? null) !== expectedVersion) throw new Error("VERSION_CONFLICT");
    this.value = override;
  }
  async deleteManualOverride(input: { workspaceId: never; id: string; deletedAt: string }, expectedVersion: number): Promise<void> {
    if (this.value === null || this.value.id !== input.id || this.value.version !== expectedVersion) throw new Error("VERSION_CONFLICT");
    this.value = { ...this.value, deletedAt: input.deletedAt, version: expectedVersion + 1 };
  }
  async findManualOverride(): Promise<ManualFxOverrideRecord | null> { return this.value; }
}

describe("manual FX override commands", () => {
  it("saves and tombstones an override without changing ledger data", async () => {
    const repository = new MemoryOverrides();
    const saved = await new SaveFxOverrideCommand(repository, () => "override-1").execute({ workspaceId: workspace, from: "USD" as never, to: "AED" as never, numerator: 367n, denominator: 100n, asOf: "2026-08-04" });
    expect(saved.rate.numerator).toBe(367n);
    await new DeleteFxOverrideCommand(repository).execute({ workspaceId: workspace, id: saved.id, from: "USD" as never, to: "AED" as never, asOf: "2026-08-04", deletedAt: "2026-08-05T00:00:00Z" });
    expect(repository.value?.deletedAt).toBe("2026-08-05T00:00:00Z");
  });
});
