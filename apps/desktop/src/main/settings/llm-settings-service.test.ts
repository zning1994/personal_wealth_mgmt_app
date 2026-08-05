import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EncryptedLlmSecretStore, SafeStorageLlmSecretStore, type SecretCipher } from "./llm-secret-store";
import { LlmSettingsService } from "./llm-settings-service";

class TestCipher implements SecretCipher { isEncryptionAvailable() { return true; } encryptString(value: string) { return Buffer.from(`enc:${value}`); } decryptString(value: Buffer) { return value.toString().replace(/^enc:/u, ""); } }

describe("LlmSettingsService", () => {
  it("persists provider metadata separately from encrypted BYOK secret material", async () => { const root = await mkdtemp(join(tmpdir(), "pwm-llm-")); try { const secrets = new EncryptedLlmSecretStore(join(root, "secrets.json"), new TestCipher()); const service = new LlmSettingsService(join(root, "settings.json"), secrets); await service.set({ provider: "openai", model: "gpt-test", enabled: true, apiKey: "sk-test-secret" }); await expect(service.get()).resolves.toMatchObject({ providers: [{ provider: "openai", model: "gpt-test", secretConfigured: true }] }); const raw = await readFile(join(root, "secrets.json"), "utf8"); expect(raw).toContain("ZW5jOnNrLXRlc3Qtc2VjcmV0"); expect(raw).not.toContain("sk-test-secret"); } finally { await rm(root, { recursive: true, force: true }); } });

  it("uses a random opaque reference with the OS-backed safeStorage adapter", async () => { const root = await mkdtemp(join(tmpdir(), "pwm-llm-safe-")); try { const secrets = new SafeStorageLlmSecretStore(join(root, "secrets.json"), new TestCipher()); const service = new LlmSettingsService(join(root, "settings.json"), secrets); await service.set({ provider: "anthropic", model: "synthetic", enabled: true, apiKey: "synthetic-secret" }); const settings = JSON.parse(await readFile(join(root, "settings.json"), "utf8")) as { providers: Array<{ secretRef?: string }> }; expect(settings.providers[0]?.secretRef).toMatch(/^[0-9a-f-]{36}$/u); expect(settings.providers[0]?.secretRef).not.toContain("anthropic"); expect(await readFile(join(root, "secrets.json"), "utf8")).not.toContain("synthetic-secret"); } finally { await rm(root, { recursive: true, force: true }); } });
});
