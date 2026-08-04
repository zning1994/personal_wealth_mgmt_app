import { z } from "zod";
import { ActivityOperationIdSchema, EntityMetaSchema, WorkspaceIdSchema } from "./ids";

export const ActivityKindSchema = z.enum(["edit", "classification", "merge", "delete", "bulk-import", "migration", "key-operation"]);
export const ActivityOperationSchema = EntityMetaSchema.extend({
  id: ActivityOperationIdSchema,
  workspaceId: WorkspaceIdSchema,
  kind: ActivityKindSchema,
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  summary: z.string().min(1),
  undoable: z.boolean(),
  undoneAt: z.string().datetime().nullable(),
  dependsOn: z.array(ActivityOperationIdSchema),
}).strict();
export type ActivityKind = z.infer<typeof ActivityKindSchema>;
export type ActivityOperation = z.infer<typeof ActivityOperationSchema>;
