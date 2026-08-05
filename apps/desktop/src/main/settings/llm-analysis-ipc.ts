import { approveTransmission, buildTransmissionPreview } from "@pwm/ai";
import { LlmImportAnalysisResultSchema, LlmImportAnalyzeInputSchema, LlmImportPreviewInputSchema, TransmissionApprovalSchema, TransmissionPreviewSchema } from "@pwm/contracts";
import type { LlmSettingsService } from "./llm-settings-service";
import { buildImportTransmissionDraft, previewImportTransmission, suggestCandidateCategoriesWithConsent } from "@pwm/application";
import type { ImportLlmFallbackService, ResolvedLlmFallback } from "../import/in-memory-import-controller";

export interface LlmAnalysisIpcRegistrar { handle(channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>): void; removeHandler?(channel: string): void }

function assertFallbackProvider(provider: string, fallback: ResolvedLlmFallback): void {
  if (fallback.mode === "original_pdf" && provider !== "openai") throw new Error("LLM_ORIGINAL_PDF_UNSUPPORTED");
  if (fallback.mode === "page_images" && provider === "deepseek-responses") throw new Error("LLM_PAGE_IMAGES_UNSUPPORTED");
}

async function resolveFallback(input: { batchId?: string | undefined; fallbackToken?: string | undefined }, fallbackService?: ImportLlmFallbackService): Promise<ResolvedLlmFallback | undefined> {
  if (!input.fallbackToken) return undefined;
  if (!input.batchId || !fallbackService) throw new Error("LLM_FALLBACK_UNAVAILABLE");
  return fallbackService.resolve(input.fallbackToken, input.batchId as never);
}

export function registerLlmAnalysisIpc(ipc: LlmAnalysisIpcRegistrar, service: LlmSettingsService, fallbackService?: ImportLlmFallbackService): () => void {
  ipc.handle("llm:preview-import", async (_event, payload) => {
    const input = LlmImportPreviewInputSchema.parse(payload);
    const configured = await service.client(input.provider);
    const fallback = await resolveFallback(input, fallbackService);
    if (fallback) assertFallbackProvider(input.provider, fallback);
    return TransmissionPreviewSchema.parse(previewImportTransmission({ providerId: input.provider, providerName: configured.providerName, baseUrl: configured.baseUrl, model: configured.model, candidates: input.candidates, ...(fallback ? { attachments: fallback.attachments } : {}) }));
  });
  ipc.handle("llm:approve-import", async (_event, payload) => TransmissionApprovalSchema.parse(approveTransmission(TransmissionPreviewSchema.parse(payload))));
  ipc.handle("llm:analyze-import", async (_event, payload) => {
    const input = LlmImportAnalyzeInputSchema.parse(payload);
    const configured = await service.client(input.provider);
    const fallback = await resolveFallback(input, fallbackService);
    if (fallback) assertFallbackProvider(input.provider, fallback);
    const expected = buildTransmissionPreview(buildImportTransmissionDraft({ providerId: input.provider, providerName: configured.providerName, baseUrl: configured.baseUrl, model: configured.model, candidates: input.candidates, ...(fallback ? { attachments: fallback.attachments } : {}) }));
    if (expected.payloadSha256 !== input.preview.payloadSha256) throw new Error("TRANSMISSION_PREVIEW_STALE");
    const suggestions = await suggestCandidateCategoriesWithConsent(configured.client, input.candidates, input.preview, input.approval, undefined, fallback?.attachments);
    if (input.fallbackToken) fallbackService?.consume(input.fallbackToken);
    return LlmImportAnalysisResultSchema.parse({ suggestions });
  });
  return () => { for (const channel of ["llm:preview-import", "llm:approve-import", "llm:analyze-import"]) ipc.removeHandler?.(channel); };
}
