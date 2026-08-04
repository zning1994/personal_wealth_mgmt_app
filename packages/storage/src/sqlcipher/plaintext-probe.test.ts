import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findPlaintext } from "./plaintext-probe";

const CHUNK_SIZE = 64 * 1024;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("findPlaintext", () => {
  it("finds a CJK byte canary crossing a 64 KiB chunk boundary at the exact offset", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pwm-probe-"));
    temporaryRoots.push(root);
    const filePath = path.join(root, "artifact.bin");
    const needle = Buffer.from("账户_CANARY_¥_884422", "utf8");
    const offset = CHUNK_SIZE - 4;
    const bytes = Buffer.concat([Buffer.alloc(offset, 0xa5), needle, Buffer.alloc(23, 0x5a)]);
    await writeFile(filePath, bytes);

    await expect(findPlaintext([root], [needle])).resolves.toEqual([
      { path: filePath, needleIndex: 0, offset },
    ]);
  });

  it("reports every occurrence without decoding binary bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pwm-probe-"));
    temporaryRoots.push(root);
    const filePath = path.join(root, "artifact.bin");
    const needle = Uint8Array.from([0, 255, 0, 254]);
    await writeFile(filePath, Buffer.from([0, 255, 0, 254, 1, 0, 255, 0, 254]));

    await expect(findPlaintext([filePath], [needle])).resolves.toEqual([
      { path: filePath, needleIndex: 0, offset: 0 },
      { path: filePath, needleIndex: 0, offset: 5 },
    ]);
  });

  it("rejects empty needles", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pwm-probe-"));
    temporaryRoots.push(root);

    await expect(findPlaintext([root], [new Uint8Array()])).rejects.toThrow("empty-plaintext-needle");
  });

  it("rejects a symlink that escapes its supplied root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pwm-probe-root-"));
    const outside = await mkdtemp(path.join(tmpdir(), "pwm-probe-outside-"));
    temporaryRoots.push(root, outside);
    const outsideFile = path.join(outside, "secret.bin");
    await writeFile(outsideFile, "secret");
    await symlink(outsideFile, path.join(root, "escape.bin"));

    await expect(findPlaintext([root], [Buffer.from("secret")])).rejects.toThrow(
      "plaintext-probe-symlink-escape",
    );
  });
});
