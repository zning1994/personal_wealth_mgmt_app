import { z } from "zod";
import { TaskIdSchema, type TaskId } from "./ids";

export interface StartUtilityTaskInput {
  kind: "health-check";
  payload: { echo: string };
}

export const StartUtilityTaskInputSchema = z
  .object({
    kind: z.literal("health-check"),
    payload: z.object({ echo: z.string().max(128) }).strict(),
  })
  .strict();

export interface TaskStarted {
  taskId: TaskId;
}

export const TaskStartedSchema = z.object({ taskId: TaskIdSchema }).strict();

export interface CancelTaskInput {
  taskId: TaskId;
}

export const CancelTaskInputSchema = z.object({ taskId: TaskIdSchema }).strict();

export type TaskProgress = {
  taskId: TaskId;
  phase: "queued" | "running" | "completed" | "cancelled";
  completed: number;
  total: number;
};

export const TaskProgressSchema = z
  .object({
    taskId: TaskIdSchema,
    phase: z.enum(["queued", "running", "completed", "cancelled"]),
    completed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  })
  .strict()
  .refine(({ completed, total }) => completed <= total, "completed must not exceed total");

export const WorkerRequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("start"),
      taskId: TaskIdSchema,
      task: StartUtilityTaskInputSchema,
    })
    .strict(),
  z.object({ type: z.literal("cancel"), taskId: TaskIdSchema }).strict(),
]);

export type WorkerRequest = z.infer<typeof WorkerRequestSchema>;

export const WorkerResponseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("progress"), progress: TaskProgressSchema }).strict(),
  z
    .object({
      type: z.literal("result"),
      taskId: TaskIdSchema,
      result: z.object({ echo: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      taskId: TaskIdSchema,
      code: z.enum(["cancelled", "worker-failure"]),
    })
    .strict(),
]);

export type WorkerResponse = z.infer<typeof WorkerResponseSchema>;
