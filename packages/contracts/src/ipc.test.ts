import { describe, expect, it } from "vitest";
import {
  parseCommandInput,
  parseCommandOutput,
  parseTaskProgress,
  type DesktopCommand,
} from "./ipc";

function expectUnknownDesktopCommandError(parse: () => unknown): void {
  try {
    parse();
  } catch (error: unknown) {
    expect(error).toMatchObject({
      name: "UnknownDesktopCommandError",
      code: "UNKNOWN_DESKTOP_COMMAND",
      message: "Unknown desktop command: task:unknown",
    });
    return;
  }

  throw new Error("Expected an unknown desktop command error");
}

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

  it("rejects unknown fields in app info outputs", () => {
    expect(() =>
      parseCommandOutput("app:get-info", {
        name: "Personal Wealth",
        version: "0.1.1",
        platform: "darwin",
        unexpected: true,
      }),
    ).toThrow();
  });

  it("rejects unknown runtime channels with a stable domain error", () => {
    const channel = "task:unknown" as DesktopCommand;

    expectUnknownDesktopCommandError(() => parseCommandInput(channel, {}));
    expectUnknownDesktopCommandError(() => parseCommandOutput(channel, {}));
  });
});
