import { describe, expect, it, vi } from "vitest";
import type { TaskId } from "@pwm/contracts";
import { TaskCoordinator, type UtilityPort } from "./task-coordinator";

function createPort() {
  let listener: ((message: unknown) => void) | undefined;
  const port: UtilityPort = {
    postMessage: vi.fn(),
    onMessage(nextListener) {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    },
  };
  return {
    port,
    postMessage: port.postMessage as ReturnType<typeof vi.fn>,
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
});
