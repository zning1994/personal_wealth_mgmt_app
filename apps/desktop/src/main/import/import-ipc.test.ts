import { describe, expect, it, vi } from "vitest";
import { registerImportIpc } from "./import-ipc";

describe("registerImportIpc", () => {
  it("rejects an unvalidated renderer payload before controller invocation", async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>(); const createDraft = vi.fn();
    registerImportIpc({ handle: (channel, handler) => void handlers.set(channel, handler) }, { getWorkspaceId: vi.fn(), selectSource: vi.fn(), createDraft, getDraft: vi.fn(), listDrafts: vi.fn(), updateCandidate: vi.fn(), skipCandidate: vi.fn(), cancel: vi.fn(), commit: vi.fn() });
    await expect(handlers.get("imports:create-draft")?.({}, { sourceToken: "" })).rejects.toThrow(); expect(createDraft).not.toHaveBeenCalled();
  });
});
