import { describe, expect, it, vi } from "vitest";
import {
  attachUtilityWorkerPort,
  createTaskRuntime,
  type UtilityWorkerPort,
} from "./task-runtime";

function taskId(suffix: string): string {
  return `018f4f7e-8ead-7c0d-8000-0000000000${suffix}`;
}

function start(taskIdValue: string, echo = "ok") {
  return {
    type: "start" as const,
    taskId: taskIdValue,
    task: { kind: "health-check" as const, payload: { echo } },
  };
}

function createQueuedWorkerPort() {
  const responses: unknown[] = [];
  let listener: ((message: unknown) => void) | undefined;
  const port: UtilityWorkerPort = {
    postMessage(message) {
      responses.push(message);
    },
    onMessage(nextListener) {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    },
  };

  return {
    port,
    responses,
    deliver(message: unknown) {
      setImmediate(() => listener?.(message));
    },
    async settle() {
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
  };
}

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

  it("cancels when start and cancel arrive as separate queued port events", async () => {
    const transport = createQueuedWorkerPort();
    attachUtilityWorkerPort(transport.port);
    const currentTaskId = taskId("03");

    transport.deliver(start(currentTaskId));
    transport.deliver({ type: "cancel", taskId: currentTaskId });
    await transport.settle();

    expect(transport.responses).toContainEqual({
      type: "error",
      taskId: currentTaskId,
      code: "cancelled",
    });
    expect(transport.responses).not.toContainEqual({
      type: "result",
      taskId: currentTaskId,
      result: { echo: "ok" },
    });
    expect(transport.responses).not.toContainEqual({
      type: "progress",
      progress: { taskId: currentTaskId, phase: "completed", completed: 1, total: 1 },
    });
  });

  it("reports a valid task handler failure through the attached transport", async () => {
    const transport = createQueuedWorkerPort();
    attachUtilityWorkerPort(transport.port, {
      waitForTurn: async () => {
        throw new Error("simulated work failure");
      },
    });
    const currentTaskId = taskId("04");

    transport.deliver(start(currentTaskId));
    await transport.settle();

    expect(transport.responses).toContainEqual({
      type: "error",
      taskId: currentTaskId,
      code: "worker-failure",
    });
    expect(transport.responses).not.toContainEqual({
      type: "result",
      taskId: currentTaskId,
      result: { echo: "ok" },
    });
  });

  it("keeps terminal and pending-cancellation retention bounded while preserving recent duplicates", async () => {
    const send = vi.fn();
    const runtime = createTaskRuntime(send, { terminalCapacity: 2, pendingCancellationCapacity: 2 });
    const firstTaskId = taskId("05");
    const secondTaskId = taskId("06");
    const recentTaskId = taskId("07");

    await runtime.receive(start(firstTaskId));
    await runtime.receive(start(secondTaskId));
    await runtime.receive(start(recentTaskId));
    await runtime.receive({ type: "cancel", taskId: taskId("08") });
    await runtime.receive({ type: "cancel", taskId: taskId("09") });
    await runtime.receive({ type: "cancel", taskId: taskId("10") });
    const sendsBeforeDuplicate = send.mock.calls.length;
    await runtime.receive(start(recentTaskId));

    expect(runtime.diagnosticCounts()).toEqual({ active: 0, terminal: 2, pendingCancellation: 2 });
    expect(send).toHaveBeenCalledTimes(sendsBeforeDuplicate);
  });

  it("turns a retained cancellation received before start into one cancelled terminal result", async () => {
    const send = vi.fn();
    const runtime = createTaskRuntime(send, { pendingCancellationCapacity: 2 });
    const currentTaskId = taskId("11");

    await runtime.receive({ type: "cancel", taskId: currentTaskId });
    await runtime.receive(start(currentTaskId));

    expect(send).toHaveBeenCalledWith({ type: "error", taskId: currentTaskId, code: "cancelled" });
    expect(send).not.toHaveBeenCalledWith({
      type: "result",
      taskId: currentTaskId,
      result: { echo: "ok" },
    });
    expect(runtime.diagnosticCounts()).toEqual({ active: 0, terminal: 1, pendingCancellation: 0 });
  });

  it("emits completed progress before its result terminal message", async () => {
    const send = vi.fn();
    const runtime = createTaskRuntime(send);
    const currentTaskId = taskId("12");

    await runtime.receive(start(currentTaskId));

    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { type: "progress", progress: { taskId: currentTaskId, phase: "running", completed: 0, total: 1 } },
      { type: "progress", progress: { taskId: currentTaskId, phase: "completed", completed: 1, total: 1 } },
      { type: "result", taskId: currentTaskId, result: { echo: "ok" } },
    ]);
  });

  it("reports malformed port messages through a payload-free diagnostic without responding", async () => {
    const transport = createQueuedWorkerPort();
    const onInvalidMessage = vi.fn();
    attachUtilityWorkerPort(transport.port, { onInvalidMessage });

    transport.deliver({ type: "start", taskId: "not-a-uuid", task: { payload: "untrusted" } });
    await transport.settle();

    expect(onInvalidMessage).toHaveBeenCalledWith({ code: "invalid-worker-message" });
    expect(transport.responses).toEqual([]);
  });

  it("rejects malformed messages before starting a task", async () => {
    const runtime = createTaskRuntime(vi.fn());

    await expect(
      runtime.receive({ type: "start", taskId: "not-a-uuid", task: {} } as never),
    ).rejects.toThrow();
    expect(runtime.activeCount()).toBe(0);
  });
});
