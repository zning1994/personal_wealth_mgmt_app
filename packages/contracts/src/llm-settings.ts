import { z } from "zod";

export const LlmProviderDtoSchema = z.enum(["openai", "anthropic", "openai-compatible", "deepseek-responses", "ollama"]);
export const LlmProviderSettingSchema = z.object({ provider: LlmProviderDtoSchema, model: z.string().min(1).max(200), endpoint: z.string().url().optional(), enabled: z.boolean(), secretConfigured: z.boolean() }).strict();
export const LlmSettingsViewSchema = z.object({ providers: z.array(LlmProviderSettingSchema) }).strict();
export const SetLlmProviderInputSchema = z.object({ provider: LlmProviderDtoSchema, model: z.string().min(1).max(200), endpoint: z.string().url().optional(), enabled: z.boolean(), apiKey: z.string().min(8).max(10_000).optional(), clearApiKey: z.boolean().optional() }).strict();
export type LlmProviderDto = z.infer<typeof LlmProviderDtoSchema>;
export type LlmProviderSetting = z.infer<typeof LlmProviderSettingSchema>;
export type LlmSettingsView = z.infer<typeof LlmSettingsViewSchema>;
export type SetLlmProviderInput = z.infer<typeof SetLlmProviderInputSchema>;
import type { LlmImportAnalysisResult, LlmImportAnalyzeInput, LlmImportPreviewInput, TransmissionApproval, TransmissionPreview } from "./llm-consent";
export interface LlmSettingsApi { getSettings(): Promise<LlmSettingsView>; setProvider(input: SetLlmProviderInput): Promise<LlmSettingsView>; deleteProvider(provider: LlmProviderDto): Promise<LlmSettingsView>; previewImport(input: LlmImportPreviewInput): Promise<TransmissionPreview>; approveImport(preview: TransmissionPreview): Promise<TransmissionApproval>; analyzeImport(input: LlmImportAnalyzeInput): Promise<LlmImportAnalysisResult> }
