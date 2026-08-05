import { describe, expect, it, vi } from "vitest";
import { registerLedgerIpc } from "./ledger-ipc";

describe("ledger IPC", () => {
  it("validates list, suggestions, and transfer commands at the boundary", async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const ipc = { handle: (channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => handlers.set(channel, handler), removeHandler: vi.fn() };
    const service = { list: vi.fn(async () => []), suggestions: vi.fn(async () => []), delete: vi.fn(async () => undefined), update: vi.fn(async () => undefined), classify: vi.fn(async () => undefined), merge: vi.fn(async () => undefined), linkTransfer: vi.fn(async () => undefined), unlinkTransfer: vi.fn(async () => undefined) };
    const unregister = registerLedgerIpc(ipc, service);
    await expect(handlers.get("ledger:list")?.({}, {})).resolves.toEqual([]);
    await expect(handlers.get("ledger:suggestions")?.({})).resolves.toEqual([]);
    await expect(handlers.get("ledger:delete")?.({}, { id: "not-a-uuid", expectedVersion: 0 })).rejects.toThrow();
    unregister();
    expect(ipc.removeHandler).toHaveBeenCalledTimes(8);
  });
});
