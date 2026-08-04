import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CanonicalCsvParser } from "./canonical-csv-parser.js";
import { selectParser } from "../plugins/parser-plugin.js";

describe("CanonicalCsvParser", () => {
  it("parses integer minor units and bilingual descriptions", async () => {
    const bytes = await readFile(new URL("../../test/fixtures/golden/canonical-zh-en.csv", import.meta.url));
    const parser = new CanonicalCsvParser();
    const result = await parser.parse({ sourceDocumentId: crypto.randomUUID(), mimeType: "text/csv", extension: ".csv", prefix: bytes.subarray(0, 64), bytes, signal: new AbortController().signal });
    expect(result.candidates.map((item) => item.amountMinor.value)).toEqual(["-1299", "10000"]);
    expect(result.candidates[0]?.description.value).toContain("合成超市");
    expect(selectParser([parser], { mimeType: "text/csv", extension: ".csv", prefix: bytes.subarray(0, 64) })?.id).toBe("canonical-csv");
  });
});
