import { z } from "zod";
import { AccountIdSchema, EntityMetaSchema, WorkspaceIdSchema } from "../ids";
import { CurrencySchema } from "../money";

export const AccountKindSchema = z.enum(["asset", "liability", "income", "expense", "equity"]);
export type AccountKind = z.infer<typeof AccountKindSchema>;
export const AccountDtoSchema = EntityMetaSchema.extend({ id: AccountIdSchema, name: z.string().trim().min(1).max(200), kind: AccountKindSchema, currency: CurrencySchema }).strict();
export const CreateAccountInputSchema = z.object({ workspaceId: WorkspaceIdSchema, name: z.string().trim().min(1).max(200), kind: AccountKindSchema, currency: CurrencySchema }).strict();
export type AccountDto = z.infer<typeof AccountDtoSchema>;
export type CreateAccountInput = z.infer<typeof CreateAccountInputSchema>;
export interface AccountsApi { list(): Promise<readonly AccountDto[]>; create(input: Omit<CreateAccountInput, "workspaceId">): Promise<AccountDto> }
