import type { ImportBatchId, ImportBatchStatus, ImportDraft } from "@pwm/contracts";
import type { ImportBatchRepository } from "../ports/import-batch-repository";

const transitions: Readonly<Record<ImportBatchStatus, readonly ImportBatchStatus[]>> = {
  draft: ["extracting", "cancelled"], extracting: ["needs_mapping", "needs_ocr", "normalizing"],
  needs_mapping: ["normalizing"], needs_ocr: ["extracting"], normalizing: ["needs_review"],
  needs_review: ["validating", "cancelled"], validating: ["needs_review", "ready"], ready: ["committed"],
  committed: ["reverted"], cancelled: [], reverted: [],
};

export async function resumeImportBatch(repository: ImportBatchRepository, batchId: ImportBatchId): Promise<ImportDraft> {
  const draft = await repository.load(batchId);
  if (draft === null) throw new Error("IMPORT_BATCH_NOT_FOUND");
  return draft;
}

export async function transitionImportBatch(repository: ImportBatchRepository, batchId: ImportBatchId, target: ImportBatchStatus): Promise<ImportDraft> {
  const current = await resumeImportBatch(repository, batchId);
  if (!transitions[current.status].includes(target)) throw new Error("INVALID_IMPORT_TRANSITION");
  const next: ImportDraft = { ...current, status: target, revision: current.revision + 1, updatedAt: new Date().toISOString() };
  await repository.save(next, current.revision);
  return next;
}

export async function cancelImportBatch(repository: ImportBatchRepository, batchId: ImportBatchId, reason: string): Promise<ImportDraft> {
  const current = await resumeImportBatch(repository, batchId);
  if (!transitions[current.status].includes("cancelled")) throw new Error("INVALID_IMPORT_TRANSITION");
  const next: ImportDraft = { ...current, status: "cancelled", cancelReason: reason, revision: current.revision + 1, updatedAt: new Date().toISOString() };
  await repository.save(next, current.revision);
  return next;
}
