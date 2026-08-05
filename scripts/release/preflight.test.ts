import { describe, expect, it } from "vitest";
import { preflight } from "./preflight.mjs";

describe("release preflight", () => {
  it("reports every failed gate and never authorizes packaging early", async () => {
    const result = await preflight({
      run: async (gate, command) => ({
        gate,
        command,
        exitCode: gate === "test" || gate === "privacy" ? 1 : 0,
      }),
    });
    expect(result.failures.map((item) => item.gate)).toEqual(["test", "privacy"]);
    expect(result.packageAllowed).toBe(false);
    expect(result.commands).not.toContain("package:release");
  });
});
