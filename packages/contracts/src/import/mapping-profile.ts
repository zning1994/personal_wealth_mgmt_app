import { z } from "zod";
import { WorkspaceIdSchema } from "../ids";

export const MappingProfileSchema = z.object({
  id: z.string().uuid(),
  workspaceId: WorkspaceIdSchema,
  name: z.string().min(1),
  sourceFingerprint: z.string().min(1),
  columns: z.object({
    date: z.string().min(1), description: z.string().min(1), amount: z.string().min(1).optional(),
    debit: z.string().min(1).optional(), credit: z.string().min(1).optional(), currency: z.string().min(1), balance: z.string().min(1).optional(),
  }).strict().refine((columns) => Boolean(columns.amount) !== Boolean(columns.debit || columns.credit), "Use amount or debit/credit columns"),
  dateFormat: z.enum(["yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy"]),
  decimalSeparator: z.enum([".", ","]),
}).strict();

export type MappingProfile = z.infer<typeof MappingProfileSchema>;
