import type { ImportCandidateV1 } from "@pwm/contracts";
export type NormalizedCandidate = ImportCandidateV1 & { normalizedDescription: ImportCandidateV1["description"] };
export function normalizeCandidate(candidate: ImportCandidateV1): NormalizedCandidate { return { ...candidate, normalizedDescription: { value: candidate.description.value.normalize("NFKC").replace(/\s+/gu, " ").trim(), provenance: candidate.description.provenance, confidence: candidate.description.confidence } }; }
