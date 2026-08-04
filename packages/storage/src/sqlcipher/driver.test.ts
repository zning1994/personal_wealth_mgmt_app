import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSqlCipher } from "./driver";
import { findPlaintext } from "./plaintext-probe";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("SQLCipher hard gate", () => {
  it("rejects the wrong key and leaves no UTF-8 or UTF-16LE canary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pwm-sqlcipher-"));
    temporaryRoots.push(root);
    const filePath = path.join(root, "workspace.db");
    const secret = "MERCHANT_CANARY_¥_账户_884422";
    const key = randomBytes(32);
    const db = await openSqlCipher({ filePath, key, mode: "read-write" });

    await db.exec("CREATE TABLE probe (value TEXT NOT NULL)");
    await db.exec(`INSERT INTO probe(value) VALUES ('${secret}')`);
    expect(await db.get<{ value: string }>("SELECT value FROM probe")).toEqual({ value: secret });
    await db.close();

    await expect(
      openSqlCipher({ filePath, key: randomBytes(32), mode: "read-only" }),
    ).rejects.toThrow(/key|encrypted|not a database/i);
    await expect(
      findPlaintext(
        [root],
        [Buffer.from(secret, "utf8"), Buffer.from(secret, "utf16le")],
      ),
    ).resolves.toEqual([]);
  });

  it("rolls back a failed transaction and remains usable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pwm-sqlcipher-"));
    temporaryRoots.push(root);
    const db = await openSqlCipher({
      filePath: path.join(root, "workspace.db"),
      key: randomBytes(32),
      mode: "read-write",
    });
    await db.exec("CREATE TABLE probe (value TEXT NOT NULL)");

    await expect(
      db.transaction(async () => {
        await db.exec("INSERT INTO probe(value) VALUES ('rolled-back')");
        throw new Error("synthetic-failure");
      }),
    ).rejects.toThrow("synthetic-failure");

    expect(await db.all<{ value: string }>("SELECT value FROM probe")).toEqual([]);
    await db.close();
  });

  it("shares one native close operation across concurrent callers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pwm-sqlcipher-"));
    temporaryRoots.push(root);
    const db = await openSqlCipher({
      filePath: path.join(root, "workspace.db"),
      key: randomBytes(32),
      mode: "read-write",
    });

    const firstClose = db.close();
    const secondClose = db.close();

    expect(secondClose).toBe(firstClose);
    await expect(Promise.all([firstClose, secondClose])).resolves.toEqual([undefined, undefined]);
  });
});
