import { z } from "zod";

export const AppInfoSchema = z.object({
  name: z.literal("Personal Wealth"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  platform: z.enum(["darwin", "win32"]),
}).strict();

export type AppInfo = z.infer<typeof AppInfoSchema>;

export function parseAppInfo(value: unknown): AppInfo {
  return AppInfoSchema.parse(value);
}
