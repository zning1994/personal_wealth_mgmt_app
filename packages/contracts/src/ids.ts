import { z } from "zod";

export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export const uuid = <Name extends string>() =>
  z
    .string()
    .uuid()
    .transform((value) => value as Brand<string, Name>);

export const WorkspaceIdSchema = uuid<"WorkspaceId">();
export const TaskIdSchema = uuid<"TaskId">();
export const ProfileIdSchema = uuid<"ProfileId">();
export const AccountIdSchema = uuid<"AccountId">();
export const JournalEntryIdSchema = uuid<"JournalEntryId">();
export const PostingIdSchema = uuid<"PostingId">();
export const ImportBatchIdSchema = uuid<"ImportBatchId">();
export const RawRecordIdSchema = uuid<"RawRecordId">();
export const ActivityOperationIdSchema = uuid<"ActivityOperationId">();

export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;
export type ProfileId = z.infer<typeof ProfileIdSchema>;
export type AccountId = z.infer<typeof AccountIdSchema>;
export type JournalEntryId = z.infer<typeof JournalEntryIdSchema>;
export type PostingId = z.infer<typeof PostingIdSchema>;
export type ImportBatchId = z.infer<typeof ImportBatchIdSchema>;
export type RawRecordId = z.infer<typeof RawRecordIdSchema>;
export type ActivityOperationId = z.infer<typeof ActivityOperationIdSchema>;

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const EntityMetaSchema = z
  .object({
    workspaceId: WorkspaceIdSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    version: z.number().int().nonnegative(),
    deletedAt: IsoDateTimeSchema.nullable(),
  })
  .strict();

export type EntityMeta = z.infer<typeof EntityMetaSchema>;
