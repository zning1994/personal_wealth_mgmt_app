import { z } from "zod";

export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export const uuid = <Name extends string>() =>
  z.string().uuid().transform((value) => value as Brand<string, Name>);

export const WorkspaceIdSchema = uuid<"WorkspaceId">();
export const TaskIdSchema = uuid<"TaskId">();

export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;
