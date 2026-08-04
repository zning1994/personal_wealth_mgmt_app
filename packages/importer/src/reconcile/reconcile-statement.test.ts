import { describe, expect, it } from "vitest";
import { normalizeCandidate } from "../normalize/normalize-candidate.js";
import { reconcileStatement } from "./reconcile-statement.js";
import type { ImportCandidateV1 } from "@pwm/contracts";
const provenance = { source: "ocr" as const, locator: "page:1#line:4", producerId: "local-ocr", producerVersion: "1.0.0" };
const candidate = { schemaVersion: 1, rawRecordId: "018f8f19-2d6a-7b00-8000-000000000001", transactionDate: { value: "2026-08-01", confidence: .9, provenance }, description: { value: "  ＳＹＮＴＨＥＴＩＣ　商店  ", confidence: .7, provenance }, amountMinor: { value: "-1000", confidence: .9, provenance }, currency: { value: "AED", confidence: 1, provenance }, direction: { value: "debit", confidence: .9, provenance }, balanceMinor: { value: "9000", confidence: .8, provenance } } as unknown as ImportCandidateV1;
describe("normalization and reconciliation", () => {
 it("normalizes Unicode without losing provenance", () => expect(normalizeCandidate(candidate).normalizedDescription).toMatchObject({ value: "SYNTHETIC 商店", provenance, confidence: .7 }));
 it("requires explicit skip reasons", () => expect(reconcileStatement({ openingBalanceMinor: "10000", closingBalanceMinor: "9000", candidates: [candidate], skips: [{ rawRecordId: "018f8f19-2d6a-7b00-8000-000000000002" as never, reasonCode: "unparseable", explanation: "Synthetic unreadable row", confirmedAt: "2026-08-04T00:00:00.000Z" }], expectedRecordCount: 2, expectedPageCount: 1, parsedPageCount: 1 })).toMatchObject({ status: "mismatch", differenceMinor: "0", blockers: ["SKIPPED_RECORD_REQUIRES_RECONCILIATION_CONFIRMATION"] }));
});
