import { ActivityOperationSchema } from "@pwm/contracts";
import type { ActivityLogPort } from "@pwm/application";
import type { WorkspaceId } from "@pwm/contracts";

export interface ActivityIpcRegistrar {
  handle(channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>): void;
  removeHandler?(channel: string): void;
}

export function registerActivityIpc(ipc: ActivityIpcRegistrar, activity: ActivityLogPort, workspaceId: WorkspaceId): () => void {
  ipc.handle("activity:latest", async () => {
    const value = await activity.latest(workspaceId);
    return value === null ? null : ActivityOperationSchema.parse(value);
  });
  return () => { ipc.removeHandler?.("activity:latest"); };
}
