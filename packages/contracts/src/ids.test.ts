import { describe, expect, it } from "vitest";
import { TaskIdSchema, WorkspaceIdSchema } from "./ids";

describe("branded UUID schemas", () => {
  it("accepts UUID strings", () => {
    expect(WorkspaceIdSchema.parse("018f4f7e-8ead-7c0d-8000-000000000001")).toBe(
      "018f4f7e-8ead-7c0d-8000-000000000001",
    );
    expect(TaskIdSchema.parse("018f4f7e-8ead-7c0d-8000-000000000002")).toBe(
      "018f4f7e-8ead-7c0d-8000-000000000002",
    );
  });

  it("rejects malformed UUIDs", () => {
    expect(() => WorkspaceIdSchema.parse("not-a-uuid")).toThrow();
    expect(() => TaskIdSchema.parse("018f4f7e-8ead-7c0d-8000-00000000000z")).toThrow();
  });
});
