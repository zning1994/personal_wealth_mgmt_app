import { describe, expect, it } from "vitest";
import {
  CancelTaskInputSchema,
  StartUtilityTaskInputSchema,
  TaskProgressSchema,
} from "./task";

const taskId = "018f4f7e-8ead-7c0d-8000-000000000001";

describe("task schemas", () => {
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
});
