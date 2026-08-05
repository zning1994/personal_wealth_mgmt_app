export type AcceptanceManifest = {
  version: number;
  platforms: Array<{ platform: string; status: string; sha256: string }>;
  criteria: Array<{ id: string; status: string }>;
};
export declare function createPassingAcceptanceFixture(platforms?: string[]): AcceptanceManifest;
export declare function parseReleaseAcceptance(value: unknown): AcceptanceManifest;
