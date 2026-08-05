import type { UpdateRelease, UpdateStatus } from "@pwm/contracts";

export type MigrationPreflight =
  | { readonly canProceed: true }
  | { readonly canProceed: false; readonly reason: "migration-required" };

export function evaluateUpdate(
  release: UpdateRelease,
  migration: MigrationPreflight,
): UpdateStatus {
  if (!release.signatureTrusted) return { state: "blocked", reason: "untrusted-signature" };
  if (!migration.canProceed) return { state: "blocked", reason: migration.reason };
  return { state: "available", version: release.version, releaseUrl: release.releaseUrl };
}
