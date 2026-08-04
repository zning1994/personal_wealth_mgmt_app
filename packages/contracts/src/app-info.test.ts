import { describe, expect, it } from "vitest";
import { parseAppInfo } from "./app-info";

describe("parseAppInfo", () => {
  it("accepts the serializable desktop identity", () => {
    expect(parseAppInfo({ name: "Personal Wealth", version: "0.1.0", platform: "darwin" })).toEqual({
      name: "Personal Wealth",
      version: "0.1.0",
      platform: "darwin",
    });
  });

  it("rejects unsupported platforms", () => {
    expect(() => parseAppInfo({ name: "Personal Wealth", version: "0.1.0", platform: "linux" })).toThrow();
  });
});
