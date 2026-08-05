import { LlmProviderDtoSchema, LlmSettingsViewSchema, SetLlmProviderInputSchema } from "@pwm/contracts";
import type { LlmSettingsService } from "./llm-settings-service";

export interface LlmSettingsIpcRegistrar { handle(channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>): void; removeHandler?(channel: string): void }
export function registerLlmSettingsIpc(ipc: LlmSettingsIpcRegistrar, service: LlmSettingsService): () => void { ipc.handle("llm:get-settings", async () => LlmSettingsViewSchema.parse(await service.get())); ipc.handle("llm:set-provider", async (_event, payload) => LlmSettingsViewSchema.parse(await service.set(SetLlmProviderInputSchema.parse(payload)))); ipc.handle("llm:delete-provider", async (_event, payload) => LlmSettingsViewSchema.parse(await service.delete(LlmProviderDtoSchema.parse(payload)))); return () => { for (const channel of ["llm:get-settings", "llm:set-provider", "llm:delete-provider"]) ipc.removeHandler?.(channel); }; }
