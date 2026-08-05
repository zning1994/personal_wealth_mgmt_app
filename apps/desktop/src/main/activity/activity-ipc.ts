import { ActivityListInputSchema, ActivityOperationSchema, UndoActivityInputSchema } from "@pwm/contracts";
import type { DesktopActivityService } from "./activity-service";

export interface ActivityIpcRegistrar {
  handle(channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>): void;
  removeHandler?(channel: string): void;
}

export function registerActivityIpc(ipc: ActivityIpcRegistrar, activity: DesktopActivityService): () => void {
  ipc.handle("activity:latest", async () => {
    const value = await activity.latest();
    return value === null ? null : ActivityOperationSchema.parse(value);
  });
  ipc.handle("activity:list", async (_event, payload) => (await activity.list(ActivityListInputSchema.parse(payload ?? {}))).map((value) => ActivityOperationSchema.parse(value)));
  ipc.handle("activity:undo", async (_event, payload) => ActivityOperationSchema.parse(await activity.undo(UndoActivityInputSchema.parse(payload ?? {}))));
  return () => { ipc.removeHandler?.("activity:latest"); ipc.removeHandler?.("activity:list"); ipc.removeHandler?.("activity:undo"); };
}
