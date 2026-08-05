import {
  TaskIdSchema,
  TaskProgressSchema,
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
  onDisconnect?(listener: () => void): () => void;
}

export const DEFAULT_ISSUED_TASK_CAPACITY = 256;

export interface TaskCoordinatorOptions {
  issuedCapacity?: number;
}

function resolveIssuedCapacity(value: number | undefined): number {
  if (value === undefined) return DEFAULT_ISSUED_TASK_CAPACITY;
  if (!Number.isInteger(value) || value < 1) throw new Error("Issued task capacity must be a positive integer");
  return value;
}

function rememberIssued(issued: Set<TaskId>, taskId: TaskId, capacity: number): void {
  issued.add(taskId);
  if (issued.size > capacity) issued.delete(issued.values().next().value as TaskId);
}

export class TaskCoordinator {
  private readonly active = new Set<TaskId>();
  private readonly issued = new Set<TaskId>();
  private readonly cancellationRequested = new Set<TaskId>();
  private readonly createId: () => TaskId;
  private readonly issuedCapacity: number;
  private unsubscribe: (() => void) | undefined;
  private unsubscribeDisconnect: (() => void) | undefined;
  private disposed = false;

  constructor(
    private readonly port: UtilityPort,
    private readonly publish: (progress: TaskProgress) => void,
    createId?: () => TaskId,
    options: TaskCoordinatorOptions = {},
  ) {
    this.createId = createId ?? (() => TaskIdSchema.parse(crypto.randomUUID()));
    this.issuedCapacity = resolveIssuedCapacity(options.issuedCapacity);
    this.unsubscribe = this.port.onMessage((message) => this.receiveWorkerMessage(message));
    this.unsubscribeDisconnect = this.port.onDisconnect?.(() => this.receiveTransportFailure());
  }

  start(input: StartUtilityTaskInput): TaskStarted {
    if (this.disposed) throw new Error("TaskCoordinator is disposed");

    const taskId = TaskIdSchema.parse(this.createId());
    if (this.active.has(taskId) || this.issued.has(taskId)) return { taskId };

    const issuedBeforeStart = new Set(this.issued);
    rememberIssued(this.issued, taskId, this.issuedCapacity);
    this.active.add(taskId);
    try {
      this.port.postMessage({ type: "start", taskId, task: input });
    } catch (error) {
      this.active.delete(taskId);
      this.issued.clear();
      for (const issuedTaskId of issuedBeforeStart) this.issued.add(issuedTaskId);
      throw error;
    }
    return { taskId };
  }

  cancel(input: CancelTaskInput): { cancelled: boolean } {
    if (this.disposed || !this.active.has(input.taskId)) return { cancelled: false };

    if (!this.cancellationRequested.has(input.taskId)) {
      this.port.postMessage({ type: "cancel", taskId: input.taskId });
      if (this.active.has(input.taskId)) this.cancellationRequested.add(input.taskId);
    }

    return { cancelled: true };
  }

  dispose(): void {
    if (this.disposed) return;

    for (const taskId of this.active) {
      if (this.cancellationRequested.has(taskId)) continue;

      try {
        this.port.postMessage({ type: "cancel", taskId });
        if (this.active.has(taskId)) this.cancellationRequested.add(taskId);
      } catch {
        // Disposal is best-effort: keep shutting down after a transport failure.
      }
    }

    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.unsubscribeDisconnect?.();
    this.unsubscribeDisconnect = undefined;
    this.active.clear();
    this.cancellationRequested.clear();
  }

  diagnosticCounts(): { active: number; issued: number; cancellationRequested: number } {
    return {
      active: this.active.size,
      issued: this.issued.size,
      cancellationRequested: this.cancellationRequested.size,
    };
  }

  private receiveWorkerMessage(message: unknown): void {
    if (this.disposed) return;

    const parsed = WorkerResponseSchema.safeParse(message);
    if (!parsed.success) return;

    const response = parsed.data;
    if (response.type === "progress") {
      if (this.active.has(response.progress.taskId)) this.publish(response.progress);
      return;
    }

    if (!this.active.has(response.taskId)) return;
    if (response.type === "error" && response.code === "cancelled") {
      try {
        this.publish(TaskProgressSchema.parse({
          taskId: response.taskId,
          phase: "cancelled",
          completed: 0,
          total: 1,
        }));
      } finally {
        this.active.delete(response.taskId);
        this.cancellationRequested.delete(response.taskId);
      }
      return;
    }
    this.active.delete(response.taskId);
    this.cancellationRequested.delete(response.taskId);
  }

  private receiveTransportFailure(): void {
    if (this.disposed) return;
    this.active.clear();
    this.cancellationRequested.clear();
  }
}
