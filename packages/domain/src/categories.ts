import type { AccountId, WorkspaceId } from "@pwm/contracts";
import type { Account } from "./accounts";
import type { Money } from "./money";

export type CategoryAccount = Account & { readonly kind: "income" | "expense" };

export function asCategoryAccount(account: Account): CategoryAccount {
  if (account.kind !== "income" && account.kind !== "expense") throw new Error("Category account must be income or expense");
  return account as CategoryAccount;
}

export interface CategoryRule {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly categoryAccountId: AccountId;
  readonly priority: number;
  readonly matcher: { readonly descriptionIncludes?: string; readonly accountId?: AccountId; readonly minMinor?: bigint; readonly maxMinor?: bigint };
}

export interface CategoryMatchInput { readonly accountId: AccountId; readonly description: string; readonly amount: Money }

export function rankCategoryRules(rules: readonly CategoryRule[]): readonly CategoryRule[] {
  return [...rules].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}

export function matchCategoryRule(input: CategoryMatchInput, rules: readonly CategoryRule[]): CategoryRule | null {
  return rankCategoryRules(rules).find((rule) => {
    const matcher = rule.matcher;
    return (matcher.accountId === undefined || matcher.accountId === input.accountId)
      && (matcher.descriptionIncludes === undefined || input.description.toLocaleLowerCase().includes(matcher.descriptionIncludes.toLocaleLowerCase()))
      && (matcher.minMinor === undefined || input.amount.minor >= matcher.minMinor)
      && (matcher.maxMinor === undefined || input.amount.minor <= matcher.maxMinor);
  }) ?? null;
}
