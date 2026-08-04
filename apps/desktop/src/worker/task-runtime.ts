import {
  WorkerRequestSchema,
  WorkerResponseSchema,
  type TaskId,
  type WorkerResponse,
} from "@pwm/contracts";

export const DEFAULT_TERMINAL_TASK_CAPACITY = 256;
export const DEFAULT_PENDING_CANCELLATION_CAPACITY = 256;

export interface TaskRuntimeOptions {
  terminalCapacity?: number;
  pendingCancellationCapacity?: number;
  waitForTurn?: (signal: AbortSignal) => Promise<void>;
}

export interface UtilityWorkerPort {
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
}

export interface UtilityWorkerPortOptions extends TaskRuntimeOptions {
  onInvalidMessage?: (diagnostic: { code: "invalid-worker-message" }) => void;
}

function resolveCapacity(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error("Task retention capacity must be a positive integer");
  return value;
}

function rememberBounded(ids: Set<TaskId>, taskId: TaskId, capacity: number): void {
  if (ids.has(taskId)) return;

  ids.add(taskId);
  if (ids.size > capacity) ids.delete(ids.values().next().value as TaskId);
}

function waitForCancellableTurn(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(finish, 0);
    const onAbort = () => finish();
    signal.addEventListener("abort", onAbort, { once: true });

    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
  });
}

function sendValidatedResponse(send: (message: WorkerResponse) => void, message: WorkerResponse): void {
  send(WorkerResponseSchema.parse(message));
}

export function createTaskRuntime(
  send: (message: WorkerResponse) => void,
  options: TaskRuntimeOptions = {},
) {
  const active = new Map<TaskId, AbortController>();
  const terminal = new Set<TaskId>();
  const pendingCancellation = new Set<TaskId>();
  const terminalCapacity = resolveCapacity(options.terminalCapacity, DEFAULT_TERMINAL_TASK_CAPACITY);
  const pendingCancellationCapacity = resolveCapacity(
    options.pendingCancellationCapacity,
    DEFAULT_PENDING_CANCELLATION_CAPACITY,
  );
  const waitForTurn = options.waitForTurn ?? waitForCancellableTurn;

  return {
    async receive(message: unknown): Promise<void> {
      const request = WorkerRequestSchema.parse(message);

      if (request.type === "cancel") {
        const controller = active.get(request.taskId);
        if (controller) controller.abort();
        else if (!terminal.has(request.taskId)) {
          rememberBounded(pendingCancellation, request.taskId, pendingCancellationCapacity);
        }
        return;
      }

      if (active.has(request.taskId) || terminal.has(request.taskId)) return;

      if (pendingCancellation.delete(request.taskId)) {
        try {
          sendValidatedResponse(send, { type: "error", taskId: request.taskId, code: "cancelled" });
        } finally {
          rememberBounded(terminal, request.taskId, terminalCapacity);
        }
        return;
      }

      const controller = new AbortController();
      const { taskId } = request;
      const progress = { taskId, phase: "running" as const, completed: 0, total: 1 };
      active.set(taskId, controller);
      let terminalSent = false;

      try {
        sendValidatedResponse(send, { type: "progress", progress });
        await waitForTurn(controller.signal);
        if (controller.signal.aborted) {
          terminalSent = true;
          sendValidatedResponse(send, { type: "error", taskId, code: "cancelled" });
          return;
        }

        sendValidatedResponse(send, {
          type: "progress",
          progress: { ...progress, phase: "completed", completed: 1 },
        });
        terminalSent = true;
        sendValidatedResponse(send, {
          type: "result",
          taskId,
          result: { echo: request.task.payload.echo },
        });
      } catch {
        if (!terminalSent) {
          terminalSent = true;
          sendValidatedResponse(send, { type: "error", taskId, code: "worker-failure" });
        }
      } finally {
        active.delete(taskId);
        rememberBounded(terminal, taskId, terminalCapacity);
      }
    },
    activeCount(): number {
      return active.size;
    },
    diagnosticCounts(): { active: number; terminal: number; pendingCancellation: number } {
      return { active: active.size, terminal: terminal.size, pendingCancellation: pendingCancellation.size };
    },
  };
}

export function attachUtilityWorkerPort(
  port: UtilityWorkerPort,
  options: UtilityWorkerPortOptions = {},
): () => void {
  const runtime = createTaskRuntime((message) => port.postMessage(message), options);

  return port.onMessage((message) => {
    const request = WorkerRequestSchema.safeParse(message);
    if (!request.success) {
      options.onInvalidMessage?.({ code: "invalid-worker-message" });
      return;
    }

    void runtime.receive(request.data).catch(() => {
      if (request.data.type !== "start") return;
      try {
        sendValidatedResponse(port.postMessage.bind(port), {
          type: "error",
          taskId: request.data.taskId,
          code: "worker-failure",
        });
      } catch {
        // The transport failed while reporting a valid task failure.
      }
    });
  });
}
