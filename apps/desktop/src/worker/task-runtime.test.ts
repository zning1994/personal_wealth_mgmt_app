import { describe, expect, it, vi } from "vitest";
import { createTaskRuntime } from "./task-runtime";

describe("task runtime", () => {
  it("cancels an active task without publishing completion", async () => {
    const send = vi.fn();
    const runtime = createTaskRuntime(send);
    const taskId = "018f4f7e-8ead-7c0d-8000-000000000001";

    const running = runtime.receive({
      type: "start",
      taskId,
      task: { kind: "health-check", payload: { echo: "ok" } },
    });
    await runtime.receive({ type: "cancel", taskId });
    await running;

    expect(send).toHaveBeenCalledWith({ type: "error", taskId, code: "cancelled" });
    expect(send).not.toHaveBeenCalledWith({
      type: "progress",
      progress: { taskId, phase: "completed", completed: 1, total: 1 },
    });
    expect(runtime.activeCount()).toBe(0);
  });

  it("ignores a duplicate start after emitting its terminal result", async () => {
    const send = vi.fn();
    const runtime = createTaskRuntime(send);
    const taskId = "018f4f7e-8ead-7c0d-8000-000000000002";
    const request = {
      type: "start" as const,
      taskId,
      task: { kind: "health-check" as const, payload: { echo: "once" } },
    };

    await runtime.receive(request);
    await runtime.receive(request);

    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledWith({ type: "result", taskId, result: { echo: "once" } });
  });

  it("rejects malformed messages before starting a task", async () => {
    const runtime = createTaskRuntime(vi.fn());

    await expect(
      runtime.receive({ type: "start", taskId: "not-a-uuid", task: {} } as never),
    ).rejects.toThrow();
    expect(runtime.activeCount()).toBe(0);
  });
});
