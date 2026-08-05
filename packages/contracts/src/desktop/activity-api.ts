import { z } from "zod";
import { type ActivityOperation } from "../activity";
import { ActivityOperationIdSchema } from "../ids";

export const ActivityListInputSchema = z.object({ limit: z.number().int().min(1).max(100).optional().default(30) }).strict();
export const UndoActivityInputSchema = z.object({ operationId: ActivityOperationIdSchema.optional() }).strict();

export interface ActivityApi {
  latest(): Promise<ActivityOperation | null>;
  list(input?: z.input<typeof ActivityListInputSchema>): Promise<readonly ActivityOperation[]>;
  undo(input: z.input<typeof UndoActivityInputSchema>): Promise<ActivityOperation>;
}
