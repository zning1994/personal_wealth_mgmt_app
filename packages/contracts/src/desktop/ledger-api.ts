import { z } from "zod";
import { AccountIdSchema, JournalEntryIdSchema, PostingIdSchema, IsoDateSchema, WorkspaceIdSchema } from "../ids";
import { CurrencySchema, MinorUnitStringSchema } from "../money";
import { PostingRoleSchema } from "../ledger";

export const LedgerPostingViewSchema = z.object({
  id: z.string().uuid(),
  accountId: AccountIdSchema,
  amountMinor: MinorUnitStringSchema,
  currency: CurrencySchema,
  role: PostingRoleSchema,
}).strict();

export const LedgerJournalViewSchema = z.object({
  id: JournalEntryIdSchema,
  workspaceId: WorkspaceIdSchema,
  occurredOn: IsoDateSchema,
  description: z.string().min(1),
  postings: z.array(LedgerPostingViewSchema).min(2),
  version: z.number().int().nonnegative(),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
  transferLinkId: z.string().uuid().nullable(),
}).strict();

export const ListLedgerInputSchema = z.object({
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  includeDeleted: z.boolean().optional().default(false),
}).strict().refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, "Invalid ledger date range");

export const DeleteJournalInputSchema = z.object({ id: JournalEntryIdSchema, expectedVersion: z.number().int().nonnegative() }).strict();
export const LinkTransferInputSchema = z.object({ journalIds: z.tuple([JournalEntryIdSchema, JournalEntryIdSchema]), linkId: z.string().uuid() }).strict();
export const UnlinkTransferInputSchema = z.object({ journalIds: z.tuple([JournalEntryIdSchema, JournalEntryIdSchema]) }).strict();

const LedgerPostingInputSchema = z.object({
  id: PostingIdSchema.optional(),
  accountId: AccountIdSchema,
  amountMinor: MinorUnitStringSchema,
  currency: CurrencySchema,
  role: PostingRoleSchema,
}).strict();

export const UpdateJournalInputSchema = z.object({
  id: JournalEntryIdSchema,
  expectedVersion: z.number().int().nonnegative(),
  occurredOn: IsoDateSchema,
  description: z.string().trim().min(1),
  postings: z.array(LedgerPostingInputSchema).min(2),
}).strict();

export const ClassifyJournalInputSchema = z.object({
  id: JournalEntryIdSchema,
  expectedVersion: z.number().int().nonnegative(),
  categoryAccountId: AccountIdSchema,
}).strict();

export const MergeJournalInputSchema = z.object({
  survivorId: JournalEntryIdSchema,
  duplicateId: JournalEntryIdSchema,
  survivorExpectedVersion: z.number().int().nonnegative(),
  duplicateExpectedVersion: z.number().int().nonnegative(),
}).strict().refine((value) => value.survivorId !== value.duplicateId, "Cannot merge a journal with itself");

export const TransferSuggestionSchema = z.object({
  leftJournalId: JournalEntryIdSchema,
  rightJournalId: JournalEntryIdSchema,
  score: z.number().min(0).max(100),
  reasons: z.array(z.string().min(1)),
}).strict();

export type LedgerPostingView = z.infer<typeof LedgerPostingViewSchema>;
export type LedgerJournalView = z.infer<typeof LedgerJournalViewSchema>;
export type ListLedgerInput = z.input<typeof ListLedgerInputSchema>;
export type DeleteJournalInput = z.infer<typeof DeleteJournalInputSchema>;
export type LinkTransferInput = z.infer<typeof LinkTransferInputSchema>;
export type UnlinkTransferInput = z.infer<typeof UnlinkTransferInputSchema>;
export type UpdateJournalInput = z.infer<typeof UpdateJournalInputSchema>;
export type ClassifyJournalInput = z.infer<typeof ClassifyJournalInputSchema>;
export type MergeJournalInput = z.infer<typeof MergeJournalInputSchema>;
export type TransferSuggestion = z.infer<typeof TransferSuggestionSchema>;

export interface LedgerApi {
  list(input?: ListLedgerInput): Promise<readonly LedgerJournalView[]>;
  suggestions(): Promise<readonly TransferSuggestion[]>;
  delete(input: DeleteJournalInput): Promise<void>;
  update(input: UpdateJournalInput): Promise<void>;
  classify(input: ClassifyJournalInput): Promise<void>;
  merge(input: MergeJournalInput): Promise<void>;
  linkTransfer(input: LinkTransferInput): Promise<void>;
  unlinkTransfer(input: UnlinkTransferInput): Promise<void>;
}
