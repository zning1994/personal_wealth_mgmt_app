import type { WorkspaceId } from "@pwm/contracts";
import type { AccountKind } from "@pwm/domain";
import type { Money } from "@pwm/domain";
import type { FinanceRepository, AccountBalance } from "../ports/finance-repository";
import type { ValuationService, ValuedMoney } from "./valuation";

export type { AccountBalance } from "../ports/finance-repository";

export type ValuedAccountBalance = AccountBalance & { readonly valuation: ValuedMoney };

export interface BalanceSheetProjection {
  readonly assets: readonly ValuedAccountBalance[];
  readonly liabilities: readonly ValuedAccountBalance[];
  readonly assetTotal: Money | null;
  readonly liabilityTotal: Money | null;
  readonly netWorth: Money | null;
  readonly fxStatus: "fresh" | "stale" | "missing";
  readonly fxProvider: "boc" | "manual" | "mixed" | null;
  readonly fxAsOf: string | null;
}

const providerOf = (
  rows: readonly ValuedAccountBalance[],
): "boc" | "manual" | "mixed" | null => {
  const providers = new Set(
    rows
      .map((row) => row.valuation.provider)
      .filter((value): value is "boc" | "manual" => value !== null),
  );
  if (providers.size === 0) return null;
  if (providers.size === 1) return [...providers][0]!;
  return "mixed";
};

export class BalanceSheetQuery {
  constructor(
    private readonly repository: FinanceRepository,
    private readonly valuation: Pick<ValuationService, "value">,
  ) {}

  async execute(input: {
    readonly workspaceId: WorkspaceId;
    readonly asOf: string;
    readonly offline: boolean;
    readonly now: string;
  }): Promise<BalanceSheetProjection> {
    const settings = await this.repository.getSettings(input.workspaceId);
    const rows = await this.repository.listAccountBalances({
      workspaceId: input.workspaceId,
      asOf: input.asOf,
      kinds: ["asset", "liability"] as readonly AccountKind[],
    });
    const valued = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        valuation: await this.valuation.value({
          workspaceId: input.workspaceId,
          money: row.balance,
          onDate: input.asOf,
          offline: input.offline,
          now: input.now,
        }),
      })),
    );
    const assets = valued.filter((row) => row.kind === "asset");
    const liabilities = valued.filter((row) => row.kind === "liability");
    const missing = valued.some((row) => row.valuation.valued === null);
    const stale = valued.some((row) => row.valuation.status === "stale");
    const sum = (items: readonly ValuedAccountBalance[]): Money | null => {
      if (missing) return null;
      return {
        currency: settings.baseCurrency,
        minor: items.reduce(
          (total, row) => total + (row.valuation.valued as Money).minor,
          0n,
        ),
      };
    };
    const assetTotal = sum(assets);
    const liabilityTotal = sum(liabilities);
    const dates = valued
      .map((row) => row.valuation.asOf)
      .filter((value): value is string => value !== null)
      .sort();
    return {
      assets,
      liabilities,
      assetTotal,
      liabilityTotal,
      netWorth:
        assetTotal === null || liabilityTotal === null
          ? null
          : {
              currency: assetTotal.currency,
              minor: assetTotal.minor - liabilityTotal.minor,
            },
      fxStatus: missing ? "missing" : stale ? "stale" : "fresh",
      fxProvider: providerOf(valued),
      fxAsOf: dates[0] ?? null,
    };
  }
}
