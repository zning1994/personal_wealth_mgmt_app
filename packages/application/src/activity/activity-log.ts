import type { ActivityOperation, ActivityOperationId, WorkspaceId } from "@pwm/contracts";
import type { ActivityInverse, ActivityRecord } from "./inverse";

export type { ActivityOperation } from "@pwm/contracts";
export type ActivityKind = ActivityOperation["kind"];
export interface ActivityLogPort {
  append?(operation: ActivityOperation, inverse?: ActivityInverse | null): Promise<void>;
  latest(workspaceId: WorkspaceId): Promise<ActivityOperation | null>;
  list?(workspaceId: WorkspaceId, limit?: number): Promise<readonly ActivityOperation[]>;
  latestForUndo?(workspaceId: WorkspaceId): Promise<ActivityRecord | null>;
  findForUndo?(workspaceId: WorkspaceId, operationId: ActivityOperationId): Promise<ActivityRecord | null>;
  markUndone(operationId: ActivityOperationId, undoneAt: string): Promise<void>;
}
export interface ActivityCompensator { compensate(operation: ActivityOperation): Promise<void> }

export class UndoRecentOperationCommand {
  constructor(private readonly log: ActivityLogPort, private readonly compensator: ActivityCompensator, private readonly now: () => string = () => new Date().toISOString()) {}
  async execute(workspaceId: WorkspaceId): Promise<ActivityOperation> {
    const operation = await this.log.latest(workspaceId);
    if (!operation) throw new Error("UNDO_NOTHING_TO_UNDO");
    if (operation.undoneAt) throw new Error("UNDO_ALREADY_APPLIED");
    if (!operation.undoable || ["migration", "key-operation"].includes(operation.kind)) throw new Error("UNDO_REQUIRES_RECOVERY");
    if (operation.dependsOn.length > 0) throw new Error("UNDO_HAS_DEPENDENTS");
    await this.compensator.compensate(operation);
    await this.log.markUndone(operation.id, this.now());
    return { ...operation, undoneAt: this.now() };
  }
}
