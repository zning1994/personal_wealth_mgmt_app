import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BinaryObjectBackend } from "./encrypted-source-object-store";

export class FileBinaryObjectBackend implements BinaryObjectBackend {
  constructor(private readonly objectsDirectory: string) {}
  private pathFor(key: string): string {
    const parts = key.split("/");
    if (parts.length !== 2 || !/^[0-9a-f-]{36}$/iu.test(parts[0]!) || !/^[0-9a-f-]{36}$/iu.test(parts[1]!)) throw new Error("SOURCE_OBJECT_PATH_INVALID");
    return join(this.objectsDirectory, `${parts[1]}.pwo`);
  }
  async put(key: string, value: Uint8Array): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(this.objectsDirectory, { recursive: true, mode: 0o700 });
    const temporary = `${target}.part`;
    await writeFile(temporary, value, { mode: 0o600 });
    await rename(temporary, target);
  }
  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(key)));
  }
  async delete(key: string): Promise<void> {
    await unlink(this.pathFor(key)).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
  }
}
