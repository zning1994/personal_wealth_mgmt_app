import { z } from "zod";

export const updateStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("idle") }).strict(),
  z.object({ state: z.literal("checking") }).strict(),
  z.object({ state: z.literal("unavailable"), reason: z.enum(["offline", "service-unavailable", "invalid-response"]) }).strict(),
  z.object({ state: z.literal("available"), version: z.string().min(1), releaseUrl: z.string().url() }).strict(),
  z.object({ state: z.literal("blocked"), reason: z.enum(["untrusted-signature", "migration-required", "active-task"]) }).strict(),
  z.object({ state: z.literal("downloaded"), version: z.string().min(1) }).strict(),
]);

export type UpdateStatus = z.infer<typeof updateStatusSchema>;

export type UpdateRelease = {
  readonly version: string;
  readonly releaseUrl: string;
  readonly signatureTrusted: boolean;
  readonly schemaVersion: number;
};
