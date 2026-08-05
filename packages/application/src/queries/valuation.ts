import type { Currency, WorkspaceId } from "@pwm/contracts";
import type { Money } from "@pwm/domain";
import { convertMinor, type FxResolver } from "@pwm/fx";
import type { FinanceRepository } from "../ports/finance-repository";

export type ValuedMoney =
  | {
      readonly status: "fresh" | "stale";
      readonly original: Money;
      readonly valued: Money;
      readonly quoteIds: readonly string[];
      readonly asOf: string;
      readonly provider: "boc" | "manual" | null;
    }
  | {
      readonly status: "missing";
      readonly original: Money;
      readonly valued: null;
      readonly quoteIds: readonly [];
      readonly asOf: null;
      readonly provider: null;
    };

export class ValuationService {
  constructor(
    private readonly repository: FinanceRepository,
    private readonly fx: Pick<FxResolver, "resolve">,
  ) {}

  async value(input: {
    readonly workspaceId: WorkspaceId;
    readonly money: Money;
    readonly onDate: string;
    readonly offline: boolean;
    readonly now: string;
  }): Promise<ValuedMoney> {
    const settings = await this.repository.getSettings(input.workspaceId);
    if (input.money.currency === settings.baseCurrency) {
      return {
        status: "fresh",
        original: input.money,
        valued: input.money,
        quoteIds: [],
        asOf: input.onDate,
        provider: null,
      };
    }

    const resolution = await this.fx.resolve({
      workspaceId: input.workspaceId,
      from: input.money.currency,
      to: settings.baseCurrency,
      onDate: input.onDate,
      amount: input.money,
      offline: input.offline,
      staleAfterDays: settings.staleAfterDays,
      now: input.now,
    });
    if (resolution.status === "missing") {
      return {
        status: "missing",
        original: input.money,
        valued: null,
        quoteIds: [],
        asOf: null,
        provider: null,
      };
    }

    return {
      status: resolution.status,
      original: input.money,
      valued: convertMinor(input.money, resolution.rate),
      quoteIds: [...resolution.rate.quoteIds],
      asOf: resolution.rate.asOf,
      provider: resolution.source === "manual" ? "manual" : "boc",
    };
  }
}

export class ChangeBaseCurrencyCommand {
  constructor(private readonly repository: FinanceRepository) {}

  execute(input: {
    readonly workspaceId: WorkspaceId;
    readonly baseCurrency: Currency;
    readonly expectedVersion: number;
  }): Promise<void> {
    return this.repository.updateBaseCurrency(
      input.workspaceId,
      input.baseCurrency,
      input.expectedVersion,
    );
  }
}
