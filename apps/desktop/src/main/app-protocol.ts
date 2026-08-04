import { net, protocol } from "electron";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

function canonicalRendererRoot(rendererRoot: string): string {
  try {
    const metadata = lstatSync(rendererRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      return rejectAssetUrl();
    return realpathSync(rendererRoot);
  } catch {
    return rejectAssetUrl();
  }
}

function canonicalContainedFile(
  assetPath: string,
  canonicalRoot: string,
): string {
  try {
    const metadata = lstatSync(assetPath);
    if (metadata.isSymbolicLink() || !metadata.isFile())
      return rejectAssetUrl();
    const canonicalAsset = realpathSync(assetPath);
    const pathApi = pathImplementation(canonicalRoot);
    const relative = pathApi.relative(canonicalRoot, canonicalAsset);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${pathApi.sep}`) ||
      pathApi.isAbsolute(relative)
    ) {
      return rejectAssetUrl();
    }
    return canonicalAsset;
  } catch {
    return rejectAssetUrl();
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

export function resolveCanonicalRendererAsset(
  requestUrl: string,
  rendererRoot: string,
): string {
  const canonicalRoot = canonicalRendererRoot(rendererRoot);
  return canonicalContainedFile(
    resolveRendererAsset(requestUrl, canonicalRoot),
    canonicalRoot,
  );
}

export function registerApplicationProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APPLICATION_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

export function isApplicationAssetFileUrl(candidate: string): boolean {
  if (installedRendererRoot === undefined) return false;

  let candidateUrl: URL;
  let candidatePath: string;
  try {
    candidateUrl = new URL(candidate);
    if (
      candidateUrl.protocol !== "file:" ||
      candidateUrl.host !== "" ||
      candidateUrl.search !== "" ||
      candidateUrl.hash !== ""
    ) {
      return false;
    }
    candidatePath = fileURLToPath(candidateUrl);
  } catch {
    return false;
  }

  try {
    canonicalContainedFile(candidatePath, installedRendererRoot);
    return true;
  } catch {
    return false;
  }
}

export function installApplicationProtocol(rendererRoot: string): void {
  const canonicalRoot = canonicalRendererRoot(rendererRoot);
  if (installedRendererRoot === canonicalRoot) return;
  if (installedRendererRoot !== undefined) {
    throw new Error(
      "Application protocol is already installed for another renderer root",
    );
  }

  protocol.handle(APPLICATION_SCHEME, async (request) => {
    const assetPath = canonicalContainedFile(
      resolveRendererAsset(request.url, canonicalRoot),
      canonicalRoot,
    );
    return net.fetch(pathToFileURL(assetPath).toString());
  });
  installedRendererRoot = canonicalRoot;
}
