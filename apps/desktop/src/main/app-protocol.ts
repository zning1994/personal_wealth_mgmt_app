import { protocol } from "electron";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import * as originalFs from "original-fs";

export const APPLICATION_SCHEME = "app";
export const APPLICATION_HOST = "desktop";
export const APPLICATION_ORIGIN = `${APPLICATION_SCHEME}://${APPLICATION_HOST}`;
export const APPLICATION_ENTRY_URL = `${APPLICATION_ORIGIN}/index.html`;

const INVALID_ASSET_URL = "Application asset URL is not allowed";
let installedRendererRoot: string | undefined;

function rejectAssetUrl(): never {
  throw new Error(INVALID_ASSET_URL);
}

function decodeAssetPath(encodedPath: string): string {
  let decoded = encodedPath;

  for (let pass = 0; pass < 3; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return rejectAssetUrl();
    }
    if (next === decoded) return next;
    decoded = next;
  }

  if (decoded.includes("%")) return rejectAssetUrl();
  return decoded;
}

function pathImplementation(
  rendererRoot: string,
): typeof path.posix | typeof path.win32 {
  if (/^[A-Za-z]:[\\/]/.test(rendererRoot) || rendererRoot.startsWith("\\\\"))
    return path.win32;
  if (path.posix.isAbsolute(rendererRoot)) return path.posix;
  throw new Error("Renderer root must be absolute");
}

async function canonicalRendererRoot(rendererRoot: string): Promise<string> {
  try {
    const metadata = await lstat(rendererRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      return rejectAssetUrl();
    return await realpath(rendererRoot);
  } catch {
    return rejectAssetUrl();
  }
}

function isContainedFile(
  canonicalAsset: string,
  canonicalRoot: string,
): boolean {
  const pathApi = pathImplementation(canonicalRoot);
  const relative = pathApi.relative(canonicalRoot, canonicalAsset);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(relative)
  );
}

export function asarArchivePath(assetPath: string): string | undefined {
  return /^(.*?\.asar)(?=[\\/]|$)/i.exec(assetPath)?.[1];
}

function isAsarPath(assetPath: string): boolean {
  return asarArchivePath(assetPath) !== undefined;
}

function isNoFollowUnsupported(error: unknown, assetPath: string): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    (process.platform === "win32" || isAsarPath(assetPath)) &&
    (code === "EINVAL" ||
      code === "ENOTSUP" ||
      code === "ENOSYS" ||
      code === "UNKNOWN")
  );
}

async function openReadOnlyNoFollow(assetPath: string) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  if (noFollow === 0) return open(assetPath, constants.O_RDONLY);

  try {
    return await open(assetPath, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (!isNoFollowUnsupported(error, assetPath)) throw error;
    // Windows and Electron's virtual ASAR filesystem may not implement
    // O_NOFOLLOW. The post-open lstat/realpath/fstat identity checks below
    // remain mandatory when this explicit compatibility fallback is used.
    return open(assetPath, constants.O_RDONLY);
  }
}

type OriginalFileHandle = Awaited<ReturnType<typeof originalFs.promises.open>>;

async function assertAsarArchiveIdentity(
  archivePath: string,
  archiveHandle: OriginalFileHandle,
): Promise<void> {
  const descriptorMetadata = await archiveHandle.stat();
  if (!descriptorMetadata.isFile()) return rejectAssetUrl();
  const pathMetadata = await originalFs.promises.lstat(archivePath);
  if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile())
    return rejectAssetUrl();
  const canonicalArchive = await originalFs.promises.realpath(archivePath);
  if (
    pathImplementation(archivePath).relative(archivePath, canonicalArchive) !==
    ""
  ) {
    return rejectAssetUrl();
  }
  const followedPathMetadata = await originalFs.promises.stat(archivePath);
  if (
    followedPathMetadata.dev !== descriptorMetadata.dev ||
    followedPathMetadata.ino !== descriptorMetadata.ino
  ) {
    return rejectAssetUrl();
  }
}

async function openVerifiedAsarArchive(
  archivePath: string,
): Promise<OriginalFileHandle> {
  const archiveMetadata = await originalFs.promises.lstat(archivePath);
  if (archiveMetadata.isSymbolicLink() || !archiveMetadata.isFile())
    return rejectAssetUrl();

  const noFollow = originalFs.constants.O_NOFOLLOW ?? 0;
  let archiveHandle: OriginalFileHandle | undefined;
  try {
    try {
      archiveHandle = await originalFs.promises.open(
        archivePath,
        originalFs.constants.O_RDONLY | noFollow,
      );
    } catch (error) {
      if (!isNoFollowUnsupported(error, archivePath)) throw error;
      archiveHandle = await originalFs.promises.open(
        archivePath,
        originalFs.constants.O_RDONLY,
      );
    }
    await assertAsarArchiveIdentity(archivePath, archiveHandle);
    return archiveHandle;
  } catch (error) {
    await archiveHandle?.close();
    throw error;
  }
}

export function resolveRendererAsset(
  requestUrl: string,
  rendererRoot: string,
): string {
  const pathApi = pathImplementation(rendererRoot);
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return rejectAssetUrl();
  }

  const prefix = `${APPLICATION_ORIGIN}/`;
  if (
    !requestUrl.startsWith(prefix) ||
    parsed.protocol !== `${APPLICATION_SCHEME}:` ||
    parsed.host !== APPLICATION_HOST ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    return rejectAssetUrl();
  }

  const decodedPath = decodeAssetPath(
    requestUrl.slice(APPLICATION_ORIGIN.length),
  );
  if (
    !decodedPath.startsWith("/") ||
    decodedPath.includes("\\") ||
    decodedPath.includes("\0") ||
    /^[A-Za-z]:/.test(decodedPath.slice(1))
  ) {
    return rejectAssetUrl();
  }

  const segments = decodedPath.split("/").slice(1);
  if (segments.some((segment) => segment === "." || segment === ".."))
    return rejectAssetUrl();

  const relativeAsset = segments.filter(Boolean).join("/") || "index.html";
  if (
    path.posix.isAbsolute(relativeAsset) ||
    path.win32.isAbsolute(relativeAsset)
  )
    return rejectAssetUrl();

  const normalizedRoot = pathApi.resolve(rendererRoot);
  const assetPath = pathApi.resolve(
    normalizedRoot,
    ...relativeAsset.split("/"),
  );
  const relativeToRoot = pathApi.relative(normalizedRoot, assetPath);
  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relativeToRoot)
  ) {
    return rejectAssetUrl();
  }

  return assetPath;
}

export function contentTypeForAsset(assetPath: string): string {
  const extension = path.extname(assetPath).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
  };
  return contentTypes[extension] ?? "application/octet-stream";
}

export async function readVerifiedRendererAsset(
  requestUrl: string,
  rendererRoot: string,
): Promise<{ body: Uint8Array; contentType: string }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let archiveHandle: OriginalFileHandle | undefined;
  try {
    const canonicalRoot = await canonicalRendererRoot(rendererRoot);
    const assetPath = resolveRendererAsset(requestUrl, canonicalRoot);
    const expectedArchivePath = asarArchivePath(assetPath);
    if (expectedArchivePath !== undefined) {
      archiveHandle = await openVerifiedAsarArchive(expectedArchivePath);
    }
    handle = await openReadOnlyNoFollow(assetPath);

    const descriptorMetadata = await handle.stat();
    if (!descriptorMetadata.isFile()) return rejectAssetUrl();

    const pathMetadata = await lstat(assetPath);
    if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile())
      return rejectAssetUrl();
    const canonicalAsset = await realpath(assetPath);
    if (!isContainedFile(canonicalAsset, canonicalRoot))
      return rejectAssetUrl();

    const followedPathMetadata = await stat(assetPath);
    if (!followedPathMetadata.isFile()) return rejectAssetUrl();
    const archivePath = asarArchivePath(canonicalAsset);
    if (archivePath === undefined) {
      if (
        followedPathMetadata.dev !== descriptorMetadata.dev ||
        followedPathMetadata.ino !== descriptorMetadata.ino
      ) {
        return rejectAssetUrl();
      }
    } else {
      // Electron exposes synthetic dev/ino values for virtual ASAR entries.
      // Verify the real archive container identity through original-fs while
      // continuing to read the entry from its already-opened asset handle.
      if (
        archiveHandle === undefined ||
        expectedArchivePath === undefined ||
        pathImplementation(archivePath).relative(
          expectedArchivePath,
          archivePath,
        ) !== ""
      ) {
        return rejectAssetUrl();
      }
      await assertAsarArchiveIdentity(archivePath, archiveHandle);
    }

    const body = await handle.readFile();
    if (archivePath !== undefined && archiveHandle !== undefined) {
      await assertAsarArchiveIdentity(archivePath, archiveHandle);
    }
    return { body, contentType: contentTypeForAsset(canonicalAsset) };
  } catch {
    return rejectAssetUrl();
  } finally {
    try {
      await handle?.close();
    } finally {
      await archiveHandle?.close();
    }
  }
}

export function registerApplicationProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APPLICATION_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

export function installApplicationProtocol(rendererRoot: string): void {
  const normalizedRoot = pathImplementation(rendererRoot).resolve(rendererRoot);
  if (installedRendererRoot === normalizedRoot) return;
  if (installedRendererRoot !== undefined) {
    throw new Error(
      "Application protocol is already installed for another renderer root",
    );
  }

  protocol.handle(APPLICATION_SCHEME, async (request) => {
    const asset = await readVerifiedRendererAsset(request.url, normalizedRoot);
    return new Response(Uint8Array.from(asset.body), {
      headers: { "Content-Type": asset.contentType },
    });
  });
  installedRendererRoot = normalizedRoot;
}
