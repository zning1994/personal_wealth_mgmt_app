import { approveTransmission, buildTransmissionPreview } from "@pwm/ai";
import { LlmImportAnalysisResultSchema, LlmImportAnalyzeInputSchema, LlmImportPreviewInputSchema, TransmissionApprovalSchema, TransmissionPreviewSchema } from "@pwm/contracts";
import type { LlmSettingsService } from "./llm-settings-service";
import { previewImportTransmission, suggestCandidateCategoriesWithConsent } from "@pwm/application";

export interface LlmAnalysisIpcRegistrar { handle(channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>): void; removeHandler?(channel: string): void }

export function registerLlmAnalysisIpc(ipc: LlmAnalysisIpcRegistrar, service: LlmSettingsService): () => void {
  ipc.handle("llm:preview-import", async (_event, payload) => {
    const input = LlmImportPreviewInputSchema.parse(payload);
    const configured = await service.client(input.provider);
    return TransmissionPreviewSchema.parse(previewImportTransmission({ providerId: input.provider, providerName: configured.providerName, baseUrl: configured.baseUrl, model: configured.model, candidates: input.candidates }));
  });
  ipc.handle("llm:approve-import", async (_event, payload) => TransmissionApprovalSchema.parse(approveTransmission(TransmissionPreviewSchema.parse(payload))));
  ipc.handle("llm:analyze-import", async (_event, payload) => {
    const input = LlmImportAnalyzeInputSchema.parse(payload);
    const configured = await service.client(input.provider);
    const expected = buildTransmissionPreview({ providerId: input.provider, providerName: configured.providerName, baseUrl: configured.baseUrl, model: configured.model, dataTypes: ["text"], text: input.preview.draft.text ?? "", imageSha256: [] });
    if (expected.payloadSha256 !== input.preview.payloadSha256) throw new Error("TRANSMISSION_PREVIEW_STALE");
    const suggestions = await suggestCandidateCategoriesWithConsent(configured.client, input.candidates, input.preview, input.approval);
    return LlmImportAnalysisResultSchema.parse({ suggestions });
  });
  return () => { for (const channel of ["llm:preview-import", "llm:approve-import", "llm:analyze-import"]) ipc.removeHandler?.(channel); };
}
