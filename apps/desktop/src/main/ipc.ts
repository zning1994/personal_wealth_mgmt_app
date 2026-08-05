import type { IpcMain } from "electron";
import {
  commandSchemas,
  parseCommandInput,
  parseCommandOutput,
  type CommandInput,
  type CommandOutput,
  type DesktopCommand,
} from "@pwm/contracts";

export type CommandHandlers = {
  [K in DesktopCommand]: (input: CommandInput<K>) => Promise<CommandOutput<K>> | CommandOutput<K>;
};

export function registerCommandHandlers(
  ipc: Pick<IpcMain, "handle" | "removeHandler">,
  handlers: CommandHandlers,
): () => void {
  const channels = Object.keys(commandSchemas) as DesktopCommand[];
  const registered: DesktopCommand[] = [];
  try {
    for (const channel of channels) {
      ipc.handle(channel, async (_event, value) => {
        const input = parseCommandInput(channel, value);
        return parseCommandOutput(channel, await handlers[channel](input as never));
      });
      registered.push(channel);
    }
  } catch (error) {
    for (const channel of registered) ipc.removeHandler(channel);
    throw error;
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const channel of registered) ipc.removeHandler(channel);
  };
}
