import {
  WorkerRequestSchema,
  WorkerResponseSchema,
  type TaskId,
  type WorkerResponse,
} from "@pwm/contracts";

function sendValidatedResponse(send: (message: WorkerResponse) => void, message: WorkerResponse): void {
  send(WorkerResponseSchema.parse(message));
}

export function createTaskRuntime(send: (message: WorkerResponse) => void) {
  const active = new Map<TaskId, AbortController>();
  const terminal = new Set<TaskId>();

  return {
    async receive(message: unknown): Promise<void> {
      const request = WorkerRequestSchema.parse(message);

      if (request.type === "cancel") {
        active.get(request.taskId)?.abort();
        return;
      }

      if (active.has(request.taskId) || terminal.has(request.taskId)) return;

      const controller = new AbortController();
      const { taskId } = request;
      const progress = { taskId, phase: "running" as const, completed: 0, total: 1 };
      active.set(taskId, controller);
      sendValidatedResponse(send, { type: "progress", progress });

      try {
        await Promise.resolve();
        if (controller.signal.aborted) {
          sendValidatedResponse(send, { type: "error", taskId, code: "cancelled" });
          return;
        }

        sendValidatedResponse(send, {
          type: "result",
          taskId,
          result: { echo: request.task.payload.echo },
        });
        sendValidatedResponse(send, {
          type: "progress",
          progress: { ...progress, phase: "completed", completed: 1 },
        });
      } finally {
        active.delete(taskId);
        terminal.add(taskId);
      }
    },
    activeCount(): number {
      return active.size;
    },
  };
}
