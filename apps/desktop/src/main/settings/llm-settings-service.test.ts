import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EncryptedLlmSecretStore, type SecretCipher } from "./llm-secret-store";
import { LlmSettingsService } from "./llm-settings-service";

class TestCipher implements SecretCipher { isEncryptionAvailable() { return true; } encryptString(value: string) { return Buffer.from(`enc:${value}`); } decryptString(value: Buffer) { return value.toString().replace(/^enc:/u, ""); } }

describe("LlmSettingsService", () => {
  it("persists provider metadata separately from encrypted BYOK secret material", async () => { const root = await mkdtemp(join(tmpdir(), "pwm-llm-")); try { const secrets = new EncryptedLlmSecretStore(join(root, "secrets.json"), new TestCipher()); const service = new LlmSettingsService(join(root, "settings.json"), secrets); await service.set({ provider: "openai", model: "gpt-test", enabled: true, apiKey: "sk-test-secret" }); await expect(service.get()).resolves.toMatchObject({ providers: [{ provider: "openai", model: "gpt-test", secretConfigured: true }] }); const raw = await readFile(join(root, "secrets.json"), "utf8"); expect(raw).toContain("ZW5jOnNrLXRlc3Qtc2VjcmV0"); expect(raw).not.toContain("sk-test-secret"); } finally { await rm(root, { recursive: true, force: true }); } });
});
