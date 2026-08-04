import { describe, expect, it } from "vitest";
import {
  CancelTaskInputSchema,
  StartUtilityTaskInputSchema,
  TaskProgressSchema,
  UtilityReadySchema,
  WorkerRequestSchema,
  WorkerResponseSchema,
} from "./task";

const taskId = "018f4f7e-8ead-7c0d-8000-000000000001";

describe("task schemas", () => {
  it("accepts only the strict utility ready message", () => {
    expect(UtilityReadySchema.parse({ type: "pwm:utility-ready" })).toEqual({ type: "pwm:utility-ready" });
    expect(() => UtilityReadySchema.parse({ type: "pwm:utility-ready", extra: true })).toThrow();
  });
  it("rejects echo values longer than 128 characters", () => {
    expect(() =>
      StartUtilityTaskInputSchema.parse({
        kind: "health-check",
        payload: { echo: "x".repeat(129) },
      }),
    ).toThrow();
  });

  it("rejects cancellation payloads with unknown fields", () => {
    expect(() => CancelTaskInputSchema.parse({ taskId, unexpected: true })).toThrow();
  });

  it("rejects progress whose completed count exceeds its total", () => {
    expect(() =>
      TaskProgressSchema.parse({ taskId, phase: "running", completed: 2, total: 1 }),
    ).toThrow();
  });

  it("rejects malformed utility worker requests before task data is read", () => {
    expect(() =>
      WorkerRequestSchema.parse({
        type: "start",
        taskId,
        task: { kind: "health-check", payload: { echo: "ok" }, extra: true },
      }),
    ).toThrow();
  });

  it("parses a serializable utility worker start request", () => {
    const request = {
      type: "start" as const,
      taskId,
      task: { kind: "health-check" as const, payload: { echo: "ok" } },
    };

    expect(WorkerRequestSchema.parse(request)).toEqual(request);
  });

  it("accepts only declared worker terminal error codes", () => {
    expect(() =>
      WorkerResponseSchema.parse({ type: "error", taskId, code: "unexpected" }),
    ).toThrow();
  });

  it("parses a serializable utility worker response", () => {
    const response = { type: "error" as const, taskId, code: "cancelled" as const };

    expect(WorkerResponseSchema.parse(response)).toEqual(response);
  });
});
