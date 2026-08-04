import {
  TaskIdSchema,
  WorkerResponseSchema,
  type CancelTaskInput,
  type StartUtilityTaskInput,
  type TaskId,
  type TaskProgress,
  type TaskStarted,
  type WorkerRequest,
} from "@pwm/contracts";

export interface UtilityPort {
  postMessage(message: WorkerRequest): void;
  onMessage(listener: (message: unknown) => void): () => void;
}

export class TaskCoordinator {
  private readonly active = new Set<TaskId>();
  private readonly issued = new Set<TaskId>();
  private readonly cancellationRequested = new Set<TaskId>();
  private readonly createId: () => TaskId;

  constructor(
    private readonly port: UtilityPort,
    private readonly publish: (progress: TaskProgress) => void,
    createId?: () => TaskId,
  ) {
    this.createId = createId ?? (() => TaskIdSchema.parse(crypto.randomUUID()));
    this.port.onMessage((message) => this.receiveWorkerMessage(message));
  }

  start(input: StartUtilityTaskInput): TaskStarted {
    const taskId = TaskIdSchema.parse(this.createId());
    if (this.issued.has(taskId)) return { taskId };

    this.issued.add(taskId);
    this.active.add(taskId);
    this.port.postMessage({ type: "start", taskId, task: input });
    return { taskId };
  }

  cancel(input: CancelTaskInput): { cancelled: boolean } {
    if (!this.active.has(input.taskId)) return { cancelled: false };

    if (!this.cancellationRequested.has(input.taskId)) {
      this.cancellationRequested.add(input.taskId);
      this.port.postMessage({ type: "cancel", taskId: input.taskId });
    }

    return { cancelled: true };
  }

  private receiveWorkerMessage(message: unknown): void {
    const parsed = WorkerResponseSchema.safeParse(message);
    if (!parsed.success) return;

    const response = parsed.data;
    if (response.type === "progress") {
      if (this.active.has(response.progress.taskId)) this.publish(response.progress);
      return;
    }

    if (!this.active.delete(response.taskId)) return;
    this.cancellationRequested.delete(response.taskId);
  }
}
