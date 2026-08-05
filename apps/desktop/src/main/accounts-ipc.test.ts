import { describe, expect, it, vi } from "vitest";
import { registerAccountsIpc } from "./accounts-ipc";

describe("account IPC", () => {
  it("validates account creation at the main boundary", async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const service = { list: vi.fn(async () => []), create: vi.fn(async (input: { name: string; kind: string; currency: string }) => ({ id: "00000000-0000-4000-8000-000000000101", workspaceId: "00000000-0000-4000-8000-000000000001", name: input.name, kind: input.kind, currency: input.currency, version: 0, deletedAt: null, createdAt: "2026-08-05T00:00:00.000Z", updatedAt: "2026-08-05T00:00:00.000Z" })) };
    registerAccountsIpc({ handle: (channel, handler) => handlers.set(channel, handler), removeHandler: vi.fn() }, service as never, "00000000-0000-4000-8000-000000000001");
    await expect(handlers.get("accounts:create")?.({}, { name: "Cash", kind: "asset", currency: "AED" })).resolves.toMatchObject({ name: "Cash" });
    await expect(handlers.get("accounts:create")?.({}, { name: "" })).rejects.toThrow();
  });
});
