import { z } from "zod";
import { AppInfoSchema } from "./app-info";
import {
  CancelTaskInputSchema,
  StartUtilityTaskInputSchema,
  TaskProgressSchema,
  TaskStartedSchema,
  type TaskProgress,
} from "./task";

const empty = z.object({}).strict();

export const commandSchemas = {
  "app:get-info": { input: empty, output: AppInfoSchema },
  "task:start": { input: StartUtilityTaskInputSchema, output: TaskStartedSchema },
  "task:cancel": {
    input: CancelTaskInputSchema,
    output: z.object({ cancelled: z.boolean() }).strict(),
  },
} as const;

export type DesktopCommand = keyof typeof commandSchemas;
export type CommandInput<K extends DesktopCommand> = z.infer<(typeof commandSchemas)[K]["input"]>;
export type CommandOutput<K extends DesktopCommand> = z.infer<(typeof commandSchemas)[K]["output"]>;

export function parseCommandInput<K extends DesktopCommand>(channel: K, value: unknown): CommandInput<K> {
  return commandSchemas[channel].input.parse(value) as CommandInput<K>;
}

export function parseCommandOutput<K extends DesktopCommand>(channel: K, value: unknown): CommandOutput<K> {
  return commandSchemas[channel].output.parse(value) as CommandOutput<K>;
}

export function parseTaskProgress(value: unknown): TaskProgress {
  return TaskProgressSchema.parse(value);
}
