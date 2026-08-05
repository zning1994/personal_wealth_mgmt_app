import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LlmSecretStore } from "@pwm/ai";
import { randomUUID } from "node:crypto";

export interface SecretCipher { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }

type SecretFile = { version: 1; values: Record<string, string> };

export class EncryptedLlmSecretStore implements LlmSecretStore {
  constructor(private readonly path: string, private readonly cipher: SecretCipher) {}
  async get(secretRef: string): Promise<string | null> { const file = await this.read(); const encrypted = file.values[secretRef]; if (!encrypted) return null; if (!this.cipher.isEncryptionAvailable()) throw new Error("LLM_SECRET_PROTECTION_UNAVAILABLE"); return this.cipher.decryptString(Buffer.from(encrypted, "base64")); }
  async set(secretRef: string, value: string): Promise<void> { if (!this.cipher.isEncryptionAvailable()) throw new Error("LLM_SECRET_PROTECTION_UNAVAILABLE"); const file = await this.read(); file.values[secretRef] = this.cipher.encryptString(value).toString("base64"); await this.write(file); }
  async delete(secretRef: string): Promise<void> { const file = await this.read(); delete file.values[secretRef]; await this.write(file); }
  private async read(): Promise<SecretFile> { try { const parsed = JSON.parse(await readFile(this.path, "utf8")) as SecretFile; if (parsed.version !== 1 || !parsed.values || typeof parsed.values !== "object") throw new Error("LLM_SECRET_FILE_INVALID"); return { version: 1, values: { ...parsed.values } }; } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, values: {} }; throw error; } }
  private async write(file: SecretFile): Promise<void> { await mkdir(dirname(this.path), { recursive: true, mode: 0o700 }); const temporary = `${this.path}.partial`; await writeFile(temporary, JSON.stringify(file), { encoding: "utf8", mode: 0o600 }); await rename(temporary, this.path); await chmod(this.path, 0o600); }
}

export interface MutableLlmSecretStore extends LlmSecretStore {
  set(secretRef: string, value: string): Promise<void>;
  delete(secretRef: string): Promise<void>;
}

/**
 * Electron safeStorage is backed by Keychain on macOS and Credential Manager
 * (or the platform equivalent) on Windows. The settings file therefore only
 * contains ciphertext and opaque random references; plaintext keys never
 * cross the renderer boundary or reach the JSON settings metadata.
 */
export class SafeStorageLlmSecretStore implements MutableLlmSecretStore {
  private readonly encrypted: EncryptedLlmSecretStore;

  constructor(path: string, cipher: SecretCipher) {
    this.encrypted = new EncryptedLlmSecretStore(path, cipher);
  }

  get(secretRef: string): Promise<string | null> { return this.encrypted.get(secretRef); }

  set(secretRef: string, value: string): Promise<void> {
    if (!secretRef || secretRef.length > 200) throw new Error("LLM_SECRET_REF_INVALID");
    if (!value) throw new Error("LLM_SECRET_VALUE_INVALID");
    return this.encrypted.set(secretRef, value);
  }

  delete(secretRef: string): Promise<void> { return this.encrypted.delete(secretRef); }

  static createRef(): string { return randomUUID(); }
}
