import { describe, expect, it } from "vitest";
import type { TransmissionDraft } from "@pwm/contracts";
import { approveTransmission, assertApprovalMatches, assertRemoteTransmissionApproved, buildTransmissionPreview } from "./transmission-preview";

const base: TransmissionDraft = { providerId: "018f4f7e-8ead-7c0d-8000-000000000001", providerName: "Synthetic Remote", baseUrl: "https://example.invalid/v1", model: "synthetic-model", dataTypes: ["text"], text: "Name: Alice Example\nAddress: 1 Example Road\nAccount: 1234567890123456\nMerchant: 合成超市", imageSha256: [] };

describe("transmission preview and consent", () => {
  it("shows an exact redacted preview and binds approval to its hash", () => {
    const preview = buildTransmissionPreview(base);
    expect(preview.redactedText).toBe("Name: [REDACTED_NAME]\nAddress: [REDACTED_ADDRESS]\nAccount: ****3456\nMerchant: 合成超市");
    const approval = approveTransmission(preview, "2026-08-05T00:00:00.000Z");
    expect(() => assertRemoteTransmissionApproved(preview, approval)).not.toThrow();
    const changed = buildTransmissionPreview({ ...base, text: "Name: Bob Example" });
    expect(() => assertApprovalMatches(changed, approval)).toThrow("TRANSMISSION_APPROVAL_MISMATCH");
  });

  it("requires approval for every remote transmission", () => {
    const preview = buildTransmissionPreview(base);
    expect(() => assertRemoteTransmissionApproved(preview, null)).toThrow("TRANSMISSION_APPROVAL_REQUIRED");
  });
});
