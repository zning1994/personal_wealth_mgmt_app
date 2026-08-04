import type { IpcRenderer } from "electron";
import {
  parseCommandInput,
  parseCommandOutput,
  parseTaskProgress,
  type AppInfo,
  type CancelTaskInput,
  type CommandOutput,
  type StartUtilityTaskInput,
  type TaskProgress,
  type TaskStarted,
} from "@pwm/contracts";

export interface DesktopShellApi {
  getAppInfo(): Promise<AppInfo>;
  startTask(input: StartUtilityTaskInput): Promise<TaskStarted>;
  cancelTask(input: CancelTaskInput): Promise<{ cancelled: boolean }>;
  onTaskProgress(listener: (progress: TaskProgress) => void): () => void;
}

type InvokableCommand = "app:get-info" | "task:start" | "task:cancel";

export function createDesktopApi(
  ipc: Pick<IpcRenderer, "invoke" | "on" | "removeListener">,
): Readonly<DesktopShellApi> {
  async function invoke<K extends InvokableCommand>(channel: K, input: unknown): Promise<CommandOutput<K>> {
    const safeInput = parseCommandInput(channel, input);
    return parseCommandOutput(channel, await ipc.invoke(channel, safeInput));
  }

  return Object.freeze({
    getAppInfo: () => invoke("app:get-info", {}),
    startTask: (input: StartUtilityTaskInput) => invoke("task:start", input),
    cancelTask: (input: CancelTaskInput) => invoke("task:cancel", input),
    onTaskProgress(listener: (progress: TaskProgress) => void) {
      const wrapped = (_event: unknown, value: unknown) => listener(parseTaskProgress(value));
      let subscribed = true;
      ipc.on("task:progress", wrapped);

      return () => {
        if (!subscribed) return;
        subscribed = false;
        ipc.removeListener("task:progress", wrapped);
      };
    },
  });
}
