import type { ImportCandidateV1 } from "@pwm/contracts";
export type ParserProbe = { mimeType: string; extension: string; prefix: Uint8Array };
export type ParserInput = ParserProbe & { sourceDocumentId: string; bytes: Uint8Array; signal: AbortSignal };
export type ParserResult = { candidates: ImportCandidateV1[]; warnings: string[] };
export interface ParserPlugin { readonly id: string; readonly version: string; readonly priority: number; canParse(input: ParserProbe): boolean; parse(input: ParserInput): Promise<ParserResult> }
export function selectParser(plugins: readonly ParserPlugin[], probe: ParserProbe): ParserPlugin | null { return [...plugins].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id)).find((plugin) => plugin.canParse(probe)) ?? null; }
