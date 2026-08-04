import { z } from "zod";

import {
  AccountIdSchema,
  EntityMetaSchema,
  IsoDateSchema,
  JournalEntryIdSchema,
  PostingIdSchema,
} from "./ids";
import { MoneyDtoSchema, ValuationDtoSchema } from "./money";

export const PostingRoleSchema = z.enum([
  "principal",
  "fee",
  "fx-clearing",
  "category",
]);

export type PostingRole = z.infer<typeof PostingRoleSchema>;

export const PostingDtoSchema = z
  .object({
    id: PostingIdSchema,
    accountId: AccountIdSchema,
    amount: MoneyDtoSchema,
    valuation: ValuationDtoSchema.optional(),
    role: PostingRoleSchema,
  })
  .strict()
  .readonly();

export type PostingDto = z.infer<typeof PostingDtoSchema>;

export const JournalEntryDtoSchema = EntityMetaSchema.extend({
  id: JournalEntryIdSchema,
  occurredOn: IsoDateSchema,
  description: z.string().trim().min(1),
  postings: z.array(PostingDtoSchema).min(2).readonly(),
})
  .strict()
  .superRefine((journal, context) => {
    const postingIds = new Set<string>();
    for (const [index, posting] of journal.postings.entries()) {
      if (postingIds.has(posting.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Journal posting IDs must be unique",
          path: ["postings", index, "id"],
        });
      }
      postingIds.add(posting.id);
    }
  })
  .readonly();

export type JournalEntryDto = z.infer<typeof JournalEntryDtoSchema>;
