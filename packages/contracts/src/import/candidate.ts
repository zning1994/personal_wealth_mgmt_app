import { z } from "zod";
import { RawRecordIdSchema } from "../ids";
import { CurrencySchema, MinorUnitStringSchema } from "../money";

export const FieldProvenanceSchema = z.object({
  source: z.enum(["row", "page", "ocr", "parser", "llm"]),
  locator: z.string().min(1),
  producerId: z.string().min(1),
  producerVersion: z.string().min(1),
  evidence: z.string().max(256).optional(),
}).strict();

const field = <Value extends z.ZodTypeAny>(value: Value) => z.object({
  value,
  provenance: FieldProvenanceSchema,
  confidence: z.number().min(0).max(1),
}).strict();

export const ImportCandidateV1Schema = z.object({
  schemaVersion: z.literal(1),
  rawRecordId: RawRecordIdSchema,
  transactionDate: field(z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)),
  postingDate: field(z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)).optional(),
  description: field(z.string().min(1)),
  normalizedDescription: field(z.string().min(1)).optional(),
  amountMinor: field(MinorUnitStringSchema),
  currency: field(CurrencySchema),
  direction: field(z.enum(["debit", "credit"])),
  balanceMinor: field(MinorUnitStringSchema).optional(),
  accountCandidateId: field(z.string().uuid()).optional(),
  categoryCandidateId: field(z.string().uuid()).optional(),
}).strict();

export const SkipDecisionSchema = z.object({
  rawRecordId: RawRecordIdSchema,
  reasonCode: z.enum(["header", "footer", "duplicate", "unparseable", "user_excluded"]),
  explanation: z.string().min(1).max(500),
  confirmedAt: z.string().datetime({ offset: true }),
}).strict();

export type FieldProvenance = z.infer<typeof FieldProvenanceSchema>;
export type CandidateField<Value> = { value: Value; provenance: FieldProvenance; confidence: number };
export type ImportCandidateV1 = z.infer<typeof ImportCandidateV1Schema>;
export type SkipReasonCode = z.infer<typeof SkipDecisionSchema>["reasonCode"];
export type SkipDecision = z.infer<typeof SkipDecisionSchema>;

export function parseImportCandidate(input: unknown): ImportCandidateV1 {
  return ImportCandidateV1Schema.parse(input);
}
