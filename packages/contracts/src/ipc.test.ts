import { describe, expect, it } from "vitest";
import { parseCommandInput, parseCommandOutput, parseTaskProgress } from "./ipc";

describe("IPC schemas", () => {
  it("validates both sides of an allowlisted task command", () => {
    expect(parseCommandInput("task:start", { kind: "health-check", payload: { echo: "ok" } })).toEqual({
      kind: "health-check",
      payload: { echo: "ok" },
    });
    expect(parseCommandOutput("task:start", { taskId: "018f4f7e-8ead-7c0d-8000-000000000001" })).toEqual({
      taskId: "018f4f7e-8ead-7c0d-8000-000000000001",
    });
  });

  it("rejects untrusted progress payloads", () => {
    expect(() => parseTaskProgress({ taskId: "x", phase: "running", completed: 2, total: 1 })).toThrow();
  });

  it("rejects command payloads with unknown keys", () => {
    expect(() =>
      parseCommandInput("task:start", {
        kind: "health-check",
        payload: { echo: "ok", unexpected: true },
      }),
    ).toThrow();
  });
});
