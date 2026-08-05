declare module "*.mjs" {
  export type AcceptanceManifest = {
    platforms: Array<{ platform: string; status: string; sha256: string }>;
    criteria: Array<{ id: string; status: string }>;
  };
  export const inspectArtifact: (inputPath: string, expected?: { architecture?: string }) => {
    errors: Array<{ code: string; path?: string }>;
    architecture?: string;
    sha256?: string;
  };
  export const preflight: (runner: { run: (gate: string, command: string) => Promise<{ gate: string; command: string; exitCode: number }> }) => Promise<{
    failures: Array<{ gate: string; command: string; exitCode: number }>;
    commands: string[];
    packageAllowed: boolean;
  }>;
  export const createPassingAcceptanceFixture: (platforms?: string[]) => AcceptanceManifest;
  export const parseReleaseAcceptance: (value: unknown) => AcceptanceManifest;
}
