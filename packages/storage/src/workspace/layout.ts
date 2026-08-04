import { chmod, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { WorkspaceIdSchema, type WorkspaceId } from "@pwm/contracts";
import type { Argon2idParameters, WrappedWorkspaceKey } from "../keys/app-lock";

export type WorkspacePaths = {
  readonly root: string;
  readonly database: string;
  readonly objects: string;
  readonly staging: string;
  readonly checkpoints: string;
  readonly manifest: string;
};

export type WorkspaceManifest = {
  readonly formatVersion: 1;
  readonly workspaceId: WorkspaceId;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly appLock: {
    readonly state: "disabled" | "pending" | "enabled";
    readonly parameters?: Argon2idParameters;
    readonly wrappedDek?: WrappedWorkspaceKey;
  };
  readonly recoveryState: "healthy" | "read-only";
};

const UUID_DIRECTORY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function resolveWorkspacePaths(baseDir: string, workspaceId: WorkspaceId): WorkspacePaths {
  const parsed = WorkspaceIdSchema.parse(workspaceId);
  const root = resolve(baseDir, parsed);
  if (!UUID_DIRECTORY.test(parsed) || dirname(root) !== resolve(baseDir)) {
    throw new Error("workspace-path-escape");
  }
  return {
    root,
    database: join(root, "workspace.db"),
    objects: join(root, "objects"),
    staging: join(root, "staging"),
    checkpoints: join(root, "checkpoints"),
    manifest: join(root, "manifest.json"),
  };
}

function assertSafeManifest(manifest: WorkspaceManifest): void {
  if (manifest.formatVersion !== 1 || !WorkspaceIdSchema.safeParse(manifest.workspaceId).success) {
    throw new Error("WORKSPACE_MANIFEST_INVALID");
  }
  if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion < 0 || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error("WORKSPACE_MANIFEST_INVALID");
  }
  if (manifest.appLock.state === "disabled" && (manifest.appLock.parameters || manifest.appLock.wrappedDek)) {
    throw new Error("WORKSPACE_MANIFEST_INVALID");
  }
  if (manifest.appLock.state !== "disabled" && (!manifest.appLock.parameters || !manifest.appLock.wrappedDek)) {
    throw new Error("WORKSPACE_MANIFEST_INVALID");
  }
}

export async function writeWorkspaceManifest(paths: WorkspacePaths, manifest: WorkspaceManifest): Promise<void> {
  assertSafeManifest(manifest);
  const temporary = `${paths.manifest}.new`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(manifest)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, paths.manifest);
  await chmod(paths.manifest, 0o600);
}

export async function readWorkspaceManifest(paths: WorkspacePaths): Promise<WorkspaceManifest> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(paths.manifest, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("WORKSPACE_MANIFEST_MISSING");
    throw new Error("WORKSPACE_MANIFEST_INVALID");
  }
  if (!value || typeof value !== "object") throw new Error("WORKSPACE_MANIFEST_INVALID");
  const record = value as Record<string, unknown>;
  const allowed = new Set(["formatVersion", "workspaceId", "schemaVersion", "createdAt", "appLock", "recoveryState"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error("WORKSPACE_MANIFEST_INVALID");
  const manifest = value as WorkspaceManifest;
  assertSafeManifest(manifest);
  return manifest;
}

export async function createWorkspaceLayout(baseDir: string, manifest: WorkspaceManifest): Promise<WorkspacePaths> {
  const paths = resolveWorkspacePaths(baseDir, manifest.workspaceId);
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  await mkdir(paths.objects, { recursive: true, mode: 0o700 });
  await mkdir(paths.staging, { recursive: true, mode: 0o700 });
  await mkdir(paths.checkpoints, { recursive: true, mode: 0o700 });
  await writeWorkspaceManifest(paths, manifest);
  return paths;
}

export async function cleanStaging(paths: WorkspacePaths): Promise<void> {
  const entries = await readdir(paths.staging, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.name.endsWith(".part") && !entry.name.endsWith(".partial") && !entry.name.endsWith(".restore")) return;
    await rm(join(paths.staging, entry.name), { recursive: entry.isDirectory(), force: true });
  }));
}
