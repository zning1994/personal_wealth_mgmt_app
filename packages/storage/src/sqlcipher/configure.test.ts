import { describe, expect, it } from "vitest";
import { configureSqlCipher4 } from "./configure";

describe("SQLCipher 4 configuration", () => {
  it("selects SQLCipher and legacy 4 before applying the raw key", () => {
    const calls: string[] = [];
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const database = {
      pragma(source: string): void {
        calls.push(`pragma:${source}`);
      },
      prepare(source: string) {
        calls.push(`prepare:${source}`);
        return {
          get(): void {
            calls.push("get");
          },
        };
      },
    };

    configureSqlCipher4(database, key);

    expect(calls).toEqual([
      "pragma:cipher='sqlcipher'",
      "pragma:legacy=4",
      'pragma:key="x\'000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f\'"',
      "pragma:foreign_keys=ON",
      "prepare:SELECT count(*) AS count FROM sqlite_master",
      "get",
    ]);
  });
});
