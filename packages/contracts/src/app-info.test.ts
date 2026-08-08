import { describe, expect, it } from "vitest";
import { parseAppInfo } from "./app-info";

describe("parseAppInfo", () => {
  it("accepts the serializable desktop identity", () => {
    expect(parseAppInfo({ name: "Personal Wealth", version: "0.1.1", platform: "darwin" })).toEqual({
      name: "Personal Wealth",
      version: "0.1.1",
      platform: "darwin",
    });
  });

  it("rejects unsupported platforms", () => {
    expect(() => parseAppInfo({ name: "Personal Wealth", version: "0.1.1", platform: "linux" })).toThrow();
  });

  it("rejects unexpected app names", () => {
    expect(() => parseAppInfo({ name: "Other Wealth", version: "0.1.1", platform: "darwin" })).toThrow();
  });

  it("rejects non-semver versions", () => {
    expect(() => parseAppInfo({ name: "Personal Wealth", version: "0.1", platform: "darwin" })).toThrow();
  });
});
