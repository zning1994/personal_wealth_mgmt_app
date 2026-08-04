import { describe, expect, it, vi } from "vitest";
import type { TaskId } from "@pwm/contracts";
import { TaskCoordinator, type UtilityPort } from "./task-coordinator";

function createPort() {
  let listener: ((message: unknown) => void) | undefined;
  const unsubscribe = vi.fn();
  const port: UtilityPort = {
    postMessage: vi.fn(),
    onMessage(nextListener) {
      listener = nextListener;
      return () => {
        listener = undefined;
        unsubscribe();
      };
    },
  };
  return {
    port,
    postMessage: port.postMessage as ReturnType<typeof vi.fn>,
    unsubscribe,
    receive(message: unknown) {
      listener?.(message);
    },
  };
}

const taskInput = { kind: "health-check" as const, payload: { echo: "ok" } };

describe("TaskCoordinator", () => {
  it("does not post a duplicate start when an injected ID is reused", () => {
    const utility = createPort();
    const taskId = "018f4f7e-8ead-7c0d-8000-000000000010" as TaskId;
    const coordinator = new TaskCoordinator(utility.port, vi.fn(), () => taskId);

    expect(coordinator.start(taskInput)).toEqual({ taskId });
    expect(coordinator.start(taskInput)).toEqual({ taskId });

    expect(utility.postMessage).toHaveBeenCalledOnce();
    expect(utility.postMessage).toHaveBeenCalledWith({ type: "start", taskId, task: taskInput });
  });

  it("keeps a second task active when a duplicate terminal message arrives for the first", () => {
    const utility = createPort();
    const firstId = "018f4f7e-8ead-7c0d-8000-000000000011" as TaskId;
    const secondId = "018f4f7e-8ead-7c0d-8000-000000000012" as TaskId;
    const ids = [firstId, secondId];
    const coordinator = new TaskCoordinator(utility.port, vi.fn(), () => ids.shift() as TaskId);
    const first = coordinator.start(taskInput);

    utility.receive({ type: "result", taskId: first.taskId, result: { echo: "ok" } });
    const second = coordinator.start(taskInput);
    utility.receive({ type: "result", taskId: first.taskId, result: { echo: "ok" } });

    expect(coordinator.cancel({ taskId: second.taskId })).toEqual({ cancelled: true });
    expect(utility.postMessage).toHaveBeenCalledWith({ type: "cancel", taskId: second.taskId });
  });

  it("does not post a cancellation for an unknown task ID", () => {
    const utility = createPort();
    const coordinator = new TaskCoordinator(utility.port, vi.fn(), () => {
      return "018f4f7e-8ead-7c0d-8000-000000000013" as TaskId;
    });

    expect(
      coordinator.cancel({ taskId: "018f4f7e-8ead-7c0d-8000-000000000014" as TaskId }),
    ).toEqual({ cancelled: false });
    expect(utility.postMessage).not.toHaveBeenCalled();
  });

  it("posts one cancellation for duplicate requests without affecting another task", () => {
    const utility = createPort();
    const firstId = "018f4f7e-8ead-7c0d-8000-000000000015" as TaskId;
    const secondId = "018f4f7e-8ead-7c0d-8000-000000000016" as TaskId;
    const ids = [firstId, secondId];
    const coordinator = new TaskCoordinator(utility.port, vi.fn(), () => ids.shift() as TaskId);
    const first = coordinator.start(taskInput);
    const second = coordinator.start(taskInput);

    expect(coordinator.cancel({ taskId: first.taskId })).toEqual({ cancelled: true });
    expect(coordinator.cancel({ taskId: first.taskId })).toEqual({ cancelled: true });
    expect(utility.postMessage).toHaveBeenCalledTimes(3);
    expect(utility.postMessage).toHaveBeenLastCalledWith({ type: "cancel", taskId: first.taskId });
    expect(coordinator.cancel({ taskId: second.taskId })).toEqual({ cancelled: true });
  });

  it("removes an active ID once when the worker reports an error", () => {
    const utility = createPort();
    const taskId = "018f4f7e-8ead-7c0d-8000-000000000017" as TaskId;
    const coordinator = new TaskCoordinator(utility.port, vi.fn(), () => taskId);
    const task = coordinator.start(taskInput);

    utility.receive({ type: "error", taskId: task.taskId, code: "worker-failure" });
    utility.receive({ type: "error", taskId: task.taskId, code: "worker-failure" });

    expect(coordinator.cancel({ taskId: task.taskId })).toEqual({ cancelled: false });
    expect(utility.postMessage).toHaveBeenCalledTimes(1);
  });

  it("publishes validated progress only for an active task", () => {
    const utility = createPort();
    const publish = vi.fn();
    const taskId = "018f4f7e-8ead-7c0d-8000-000000000018" as TaskId;
    const coordinator = new TaskCoordinator(utility.port, publish, () => taskId);
    coordinator.start(taskInput);

    utility.receive({
      type: "progress",
      progress: { taskId, phase: "running", completed: 0, total: 1 },
    });
    utility.receive({
      type: "progress",
      progress: { taskId, phase: "running", completed: 2, total: 1 },
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ taskId, phase: "running", completed: 0, total: 1 });
  });

  it("publishes completed progress before the terminal result clears the task", () => {
    const utility = createPort();
    const publish = vi.fn();
    const taskId = "018f4f7e-8ead-7c0d-8000-000000000019" as TaskId;
    const coordinator = new TaskCoordinator(utility.port, publish, () => taskId);
    const task = coordinator.start(taskInput);

    utility.receive({
      type: "progress",
      progress: { taskId: task.taskId, phase: "running", completed: 0, total: 1 },
    });
    utility.receive({
      type: "progress",
      progress: { taskId: task.taskId, phase: "completed", completed: 1, total: 1 },
    });
    utility.receive({ type: "result", taskId: task.taskId, result: { echo: "ok" } });

    expect(publish.mock.calls.map(([progress]) => progress)).toEqual([
      { taskId, phase: "running", completed: 0, total: 1 },
      { taskId, phase: "completed", completed: 1, total: 1 },
    ]);
    expect(coordinator.cancel({ taskId: task.taskId })).toEqual({ cancelled: false });
  });

  it("bounds issued IDs while retaining a recent duplicate start", () => {
    const utility = createPort();
    const firstId = "018f4f7e-8ead-7c0d-8000-000000000020" as TaskId;
    const secondId = "018f4f7e-8ead-7c0d-8000-000000000021" as TaskId;
    const recentId = "018f4f7e-8ead-7c0d-8000-000000000022" as TaskId;
    const ids = [firstId, secondId, recentId, recentId];
    const coordinator = new TaskCoordinator(
      utility.port,
      vi.fn(),
      () => ids.shift() as TaskId,
      { issuedCapacity: 2 },
    );

    for (const currentTaskId of [firstId, secondId, recentId]) {
      coordinator.start(taskInput);
      utility.receive({ type: "result", taskId: currentTaskId, result: { echo: "ok" } });
    }
    coordinator.start(taskInput);

    expect(coordinator.diagnosticCounts()).toEqual({ active: 0, issued: 2, cancellationRequested: 0 });
    expect(utility.postMessage).toHaveBeenCalledTimes(3);
  });

  it("does not reuse an active ID after FIFO retention evicts its tombstone", () => {
    const utility = createPort();
    const activeId = "018f4f7e-8ead-7c0d-8000-000000000024" as TaskId;
    const nextId = "018f4f7e-8ead-7c0d-8000-000000000025" as TaskId;
    const ids = [activeId, nextId, activeId];
    const coordinator = new TaskCoordinator(
      utility.port,
      vi.fn(),
      () => ids.shift() as TaskId,
      { issuedCapacity: 1 },
    );

    coordinator.start(taskInput);
    coordinator.start(taskInput);
    coordinator.start(taskInput);

    expect(utility.postMessage).toHaveBeenCalledTimes(2);
    expect(coordinator.cancel({ taskId: activeId })).toEqual({ cancelled: true });
  });

  it("disposes once, clears active state, and prevents further lifecycle calls", () => {
    const utility = createPort();
    const publish = vi.fn();
    const taskId = "018f4f7e-8ead-7c0d-8000-000000000023" as TaskId;
    const coordinator = new TaskCoordinator(utility.port, publish, () => taskId);
    const task = coordinator.start(taskInput);

    coordinator.dispose();
    coordinator.dispose();
    utility.receive({
      type: "progress",
      progress: { taskId: task.taskId, phase: "running", completed: 0, total: 1 },
    });

    expect(utility.unsubscribe).toHaveBeenCalledOnce();
    expect(coordinator.cancel({ taskId: task.taskId })).toEqual({ cancelled: false });
    expect(() => coordinator.start(taskInput)).toThrow("TaskCoordinator is disposed");
    expect(publish).not.toHaveBeenCalled();
    expect(coordinator.diagnosticCounts()).toEqual({ active: 0, issued: 1, cancellationRequested: 0 });
  });

  it("best-effort cancels each active task once before disposing", () => {
    const utility = createPort();
    const firstId = "018f4f7e-8ead-7c0d-8000-000000000026" as TaskId;
    const secondId = "018f4f7e-8ead-7c0d-8000-000000000027" as TaskId;
    const ids = [firstId, secondId];
    const coordinator = new TaskCoordinator(utility.port, vi.fn(), () => ids.shift() as TaskId);
    coordinator.start(taskInput);
    coordinator.start(taskInput);
    coordinator.cancel({ taskId: firstId });

    coordinator.dispose();
    coordinator.dispose();

    const cancellationMessages = utility.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === "cancel");
    expect(cancellationMessages).toEqual([
      { type: "cancel", taskId: firstId },
      { type: "cancel", taskId: secondId },
    ]);
    expect(utility.unsubscribe).toHaveBeenCalledOnce();
  });

  it("retries a cancellation during disposal after its first synchronous send failure", () => {
    const utility = createPort();
    const taskId = "018f4f7e-8ead-7c0d-8000-000000000028" as TaskId;
    const coordinator = new TaskCoordinator(utility.port, vi.fn(), () => taskId);
    coordinator.start(taskInput);
    utility.postMessage.mockImplementationOnce(() => {
      throw new Error("cancel was not delivered");
    });

    expect(() => coordinator.cancel({ taskId })).toThrow("cancel was not delivered");
    expect(coordinator.diagnosticCounts()).toEqual({ active: 1, issued: 1, cancellationRequested: 0 });

    coordinator.dispose();
    coordinator.dispose();

    const cancellationMessages = utility.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === "cancel");
    expect(cancellationMessages).toEqual([
      { type: "cancel", taskId },
      { type: "cancel", taskId },
    ]);
    expect(utility.unsubscribe).toHaveBeenCalledOnce();
    expect(coordinator.diagnosticCounts()).toEqual({ active: 0, issued: 1, cancellationRequested: 0 });
  });

  it("rolls back a failed start so the same generated ID can retry", () => {
    const utility = createPort();
    const taskId = "018f4f7e-8ead-7c0d-8000-000000000029" as TaskId;
    const coordinator = new TaskCoordinator(utility.port, vi.fn(), () => taskId);
    utility.postMessage.mockImplementationOnce(() => {
      throw new Error("start was not delivered");
    });

    expect(() => coordinator.start(taskInput)).toThrow("start was not delivered");
    expect(coordinator.diagnosticCounts()).toEqual({ active: 0, issued: 0, cancellationRequested: 0 });

    expect(coordinator.start(taskInput)).toEqual({ taskId });
    expect(coordinator.diagnosticCounts()).toEqual({ active: 1, issued: 1, cancellationRequested: 0 });
    expect(utility.postMessage).toHaveBeenLastCalledWith({ type: "start", taskId, task: taskInput });
  });
});
