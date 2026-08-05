const PLATFORMS = new Set(["macos-arm64", "macos-x64", "windows-x64"]);
const CRITERIA = [
  "workspace-unlock",
  "import-review-commit",
  "duplicate-transfer",
  "offline-fx-cache",
  "backup-restore",
  "migration-recovery",
  "artifact-privacy",
];

export function parseReleaseAcceptance(value) {
  if (!value || typeof value !== "object") throw new Error("INVALID_ACCEPTANCE_MANIFEST");
  if (!Array.isArray(value.platforms) || !Array.isArray(value.criteria)) throw new Error("INVALID_ACCEPTANCE_MANIFEST");
  const platforms = value.platforms.map((item) => {
    if (!item || !PLATFORMS.has(item.platform) || item.status !== "passed" || typeof item.sha256 !== "string") throw new Error("INVALID_ACCEPTANCE_PLATFORM");
    return { platform: item.platform, status: item.status, sha256: item.sha256 };
  });
  const criteria = value.criteria.map((item) => {
    if (!item || !CRITERIA.includes(item.id) || item.status !== "passed") throw new Error("INVALID_ACCEPTANCE_CRITERION");
    return { id: item.id, status: item.status };
  });
  for (const platform of PLATFORMS) if (!platforms.some((item) => item.platform === platform)) throw new Error("MISSING_ACCEPTANCE_PLATFORM");
  for (const id of CRITERIA) if (!criteria.some((item) => item.id === id)) throw new Error("MISSING_ACCEPTANCE_CRITERION");
  return { version: 1, platforms, criteria };
}

export function createPassingAcceptanceFixture(platforms = [...PLATFORMS]) {
  return parseReleaseAcceptance({
    platforms: platforms.map((platform) => ({ platform, status: "passed", sha256: "0".repeat(64) })),
    criteria: CRITERIA.map((id) => ({ id, status: "passed" })),
  });
}
