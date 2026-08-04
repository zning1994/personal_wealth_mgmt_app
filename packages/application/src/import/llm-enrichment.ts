import { z } from "zod";
import type { ImportCandidateV1 } from "@pwm/contracts";
import type { LlmClient } from "@pwm/ai";
import { assertRemoteTransmissionApproved, buildTransmissionPreview } from "@pwm/ai";
import type { TransmissionApproval, TransmissionDraft, TransmissionPreview } from "@pwm/contracts";

const AnalysisSchema = z.object({
  categoryAccountId: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
  explanation: z.string().max(500),
}).strict();

export type LlmCandidateSuggestion = z.infer<typeof AnalysisSchema> & { rawRecordId: string };

export function buildImportTransmissionDraft(input: { providerId: string; providerName: string; baseUrl: string; model: string; candidates: readonly ImportCandidateV1[] }): TransmissionDraft {
  return { providerId: input.providerId, providerName: input.providerName, baseUrl: input.baseUrl, model: input.model, dataTypes: ["text"], text: input.candidates.map((candidate) => `${candidate.rawRecordId} | ${candidate.transactionDate.value} | ${candidate.description.value} | ${candidate.amountMinor.value} ${candidate.currency.value}`).join("\n"), imageSha256: [] };
}

export function previewImportTransmission(input: Parameters<typeof buildImportTransmissionDraft>[0]): TransmissionPreview {
  return buildTransmissionPreview(buildImportTransmissionDraft(input));
}

export async function suggestCandidateCategoriesWithConsent(client: LlmClient, candidates: readonly ImportCandidateV1[], preview: TransmissionPreview, approval: TransmissionApproval, signal?: AbortSignal): Promise<readonly LlmCandidateSuggestion[]> {
  assertRemoteTransmissionApproved(preview, approval);
  const response = await client.analyze({ task: "categorize-import", instruction: "For each rawRecordId, suggest a category account only when the description is sufficient. Use null when uncertain. Never invent IDs.", parts: [{ field: "transactions", text: preview.redactedText }], responseSchema: { suggestions: [{ rawRecordId: "uuid", categoryAccountId: "uuid|null", confidence: "number", explanation: "string" }] }, maxOutputTokens: Math.min(16_384, Math.max(500, candidates.length * 120)) }, signal);
  const parsed = z.object({ suggestions: z.array(AnalysisSchema.extend({ rawRecordId: z.string().uuid() })).max(candidates.length) }).strict().parse(response);
  const known = new Set(candidates.map((candidate) => String(candidate.rawRecordId)));
  if (parsed.suggestions.some((suggestion) => !known.has(suggestion.rawRecordId))) throw new Error("LLM_UNKNOWN_RAW_RECORD");
  return parsed.suggestions;
}

export async function suggestCandidateCategories(client: LlmClient, candidates: readonly ImportCandidateV1[], signal?: AbortSignal): Promise<readonly LlmCandidateSuggestion[]> {
  const results: LlmCandidateSuggestion[] = [];
  for (const candidate of candidates) {
    const response = await client.analyze({ task: "categorize-import", instruction: "Suggest a category account only when the description is sufficient. Use null when uncertain.", parts: [{ field: "date", text: candidate.transactionDate.value }, { field: "description", text: candidate.description.value }, { field: "amount", text: `${candidate.amountMinor.value} ${candidate.currency.value}` }], responseSchema: { categoryAccountId: "uuid|null", confidence: "number", explanation: "string" }, maxOutputTokens: 500 }, signal);
    const parsed = AnalysisSchema.parse(response);
    results.push({ ...parsed, rawRecordId: candidate.rawRecordId });
  }
  return results;
}
