import { createHash, randomUUID } from "node:crypto";
import { TransmissionApprovalSchema, TransmissionDraftSchema, TransmissionPreviewSchema, type TransmissionApproval, type TransmissionDraft, type TransmissionPreview } from "@pwm/contracts";

function redactText(text: string): string {
  return text
    .replace(/([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/gu, "[REDACTED_EMAIL]")
    .replace(/\b(?:\d[ -]*?){12,19}\b/gu, (value) => `****${value.replace(/\D/gu, "").slice(-4)}`)
    .replace(/(\+?\d[\d ()-]{7,}\d)/gu, "[REDACTED_PHONE]")
    .replace(/^(\s*(?:name|姓名|account holder|持卡人)\s*[:：]).*$/gimu, "$1 [REDACTED_NAME]")
    .replace(/^(\s*(?:address|地址)\s*[:：]).*$/gimu, "$1 [REDACTED_ADDRESS]");
}

function canonicalPayload(draft: TransmissionDraft, redactedText: string): string {
  return JSON.stringify({
    providerId: draft.providerId,
    providerName: draft.providerName,
    baseUrl: draft.baseUrl,
    model: draft.model,
    dataTypes: [...draft.dataTypes].sort(),
    text: redactedText,
    imageSha256: [...draft.imageSha256].sort(),
    fileSha256: draft.fileSha256 ?? null,
  });
}

export function buildTransmissionPreview(input: TransmissionDraft): TransmissionPreview {
  const draft = TransmissionDraftSchema.parse(input);
  const redactedText = redactText(draft.text ?? "");
  const risks: TransmissionPreview["risks"] = [];
  if (draft.dataTypes.includes("text")) risks.push("REMOTE_PROVIDER_RECEIVES_FINANCIAL_TEXT");
  if (draft.dataTypes.includes("image")) risks.push("REMOTE_PROVIDER_RECEIVES_PAGE_IMAGE");
  if (draft.dataTypes.includes("file")) risks.push("REMOTE_PROVIDER_RECEIVES_ORIGINAL_FILE");
  const payloadSha256 = createHash("sha256").update(canonicalPayload(draft, redactedText), "utf8").digest("hex");
  return TransmissionPreviewSchema.parse({ draft, redactedText, textCharacters: redactedText.length, imageCount: draft.imageSha256.length, fileCount: draft.fileSha256 ? 1 : 0, risks, payloadSha256 });
}

export function approveTransmission(preview: TransmissionPreview, now = new Date().toISOString()): TransmissionApproval {
  const parsed = TransmissionPreviewSchema.parse(preview);
  return TransmissionApprovalSchema.parse({ approvalId: randomUUID(), payloadSha256: parsed.payloadSha256, approvedAt: now });
}

export function assertApprovalMatches(preview: TransmissionPreview, approval: TransmissionApproval): void {
  const parsedApproval = TransmissionApprovalSchema.parse(approval);
  if (parsedApproval.payloadSha256 !== TransmissionPreviewSchema.parse(preview).payloadSha256) throw new Error("TRANSMISSION_APPROVAL_MISMATCH");
}

export function assertRemoteTransmissionApproved(preview: TransmissionPreview, approval: TransmissionApproval | null | undefined): void {
  if (!approval) throw new Error("TRANSMISSION_APPROVAL_REQUIRED");
  assertApprovalMatches(preview, approval);
}
