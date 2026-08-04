import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("integration workspace boundary", () => {
  it("uses a unique temporary root per test and leaves no source fixture", async () => {
    const first = await mkdtemp(join(tmpdir(), "pwm-integration-"));
    const second = await mkdtemp(join(tmpdir(), "pwm-integration-"));
    expect(first).not.toBe(second);
    expect(await readdir(first)).toEqual([]);
    expect(await readdir(second)).toEqual([]);
  });
});
