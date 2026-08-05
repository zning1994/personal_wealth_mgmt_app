import { describe, expect, it, vi } from "vitest";
import type { ActivityOperation } from "@pwm/contracts";
import { UndoRecentOperationCommand } from "./activity-log";

const operation = (overrides: Partial<ActivityOperation> = {}): ActivityOperation => ({ id: "00000000-0000-4000-8000-000000000001" as never, workspaceId: "00000000-0000-4000-8000-000000000002" as never, kind: "edit", entityType: "journal", entityId: "journal-1", summary: "Edit", createdAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z", version: 0, deletedAt: null, undoable: true, undoneAt: null, dependsOn: [], ...overrides });

describe("UndoRecentOperationCommand", () => {
  it("compensates and marks an undoable operation", async () => { const current = operation(); const log = { latest: vi.fn(async () => current), markUndone: vi.fn(async () => undefined) }; const compensator = { compensate: vi.fn(async () => undefined) }; await expect(new UndoRecentOperationCommand(log, compensator, () => "2026-08-04T01:00:00.000Z").execute(current.workspaceId)).resolves.toMatchObject({ undoneAt: "2026-08-04T01:00:00.000Z" }); expect(compensator.compensate).toHaveBeenCalledWith(current); expect(log.markUndone).toHaveBeenCalledOnce(); });
  it.each([operation({ kind: "migration", undoable: false }), operation({ kind: "key-operation", undoable: false }), operation({ dependsOn: ["00000000-0000-4000-8000-000000000003" as never] })])("blocks unsafe undo", async (current) => { const log = { latest: vi.fn(async () => current), markUndone: vi.fn() }; await expect(new UndoRecentOperationCommand(log, { compensate: vi.fn() }).execute(current.workspaceId)).rejects.toThrow(/UNDO_(REQUIRES_RECOVERY|HAS_DEPENDENTS)/); });
});
