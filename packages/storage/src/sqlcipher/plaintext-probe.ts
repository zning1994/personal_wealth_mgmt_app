import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";

const SCAN_CHUNK_SIZE = 64 * 1024;

export interface PlaintextHit {
  readonly path: string;
  readonly needleIndex: number;
  readonly offset: number;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function scanRegularFile(
  physicalPath: string,
  reportedPath: string,
  needles: readonly Buffer[],
): Promise<PlaintextHit[]> {
  const handle = await open(physicalPath, constants.O_RDONLY);
  const hits: PlaintextHit[] = [];
  const maxNeedleLength = Math.max(...needles.map((needle) => needle.byteLength));
  let carry = Buffer.alloc(0);
  let bytesConsumed = 0;

  try {
    const chunk = Buffer.allocUnsafe(SCAN_CHUNK_SIZE);
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;

      const combined = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
      const combinedOffset = bytesConsumed - carry.byteLength;

      needles.forEach((needle, needleIndex) => {
        let matchOffset = combined.indexOf(needle);
        while (matchOffset !== -1) {
          if (matchOffset + needle.byteLength > carry.byteLength) {
            hits.push({
              path: reportedPath,
              needleIndex,
              offset: combinedOffset + matchOffset,
            });
          }
          matchOffset = combined.indexOf(needle, matchOffset + 1);
        }
      });

      bytesConsumed += bytesRead;
      const carryLength = Math.min(maxNeedleLength - 1, combined.byteLength);
      carry = Buffer.from(combined.subarray(combined.byteLength - carryLength));
    }
  } finally {
    await handle.close();
  }

  return hits;
}

async function scanDirectoryRoot(
  rootPath: string,
  needles: readonly Buffer[],
): Promise<PlaintextHit[]> {
  const physicalRoot = await realpath(rootPath);
  const visitedDirectories = new Set<string>();
  const scannedFiles = new Set<string>();

  const visit = async (logicalPath: string): Promise<PlaintextHit[]> => {
    const entry = await lstat(logicalPath);
    let physicalPath = logicalPath;

    if (entry.isSymbolicLink()) {
      physicalPath = await realpath(logicalPath);
      if (!isWithinRoot(physicalRoot, physicalPath)) {
        throw new Error("plaintext-probe-symlink-escape");
      }
    }

    const physicalEntry = entry.isSymbolicLink() ? await lstat(physicalPath) : entry;
    if (physicalEntry.isDirectory()) {
      const canonicalDirectory = await realpath(physicalPath);
      if (visitedDirectories.has(canonicalDirectory)) return [];
      visitedDirectories.add(canonicalDirectory);
      const names = (await readdir(physicalPath)).sort();
      const nested = await Promise.all(names.map((name) => visit(path.join(logicalPath, name))));
      return nested.flat();
    }

    if (!physicalEntry.isFile()) return [];
    const canonicalFile = await realpath(physicalPath);
    if (!isWithinRoot(physicalRoot, canonicalFile)) {
      throw new Error("plaintext-probe-root-escape");
    }
    if (scannedFiles.has(canonicalFile)) return [];
    scannedFiles.add(canonicalFile);
    return scanRegularFile(canonicalFile, logicalPath, needles);
  };

  return visit(rootPath);
}

export async function findPlaintext(
  rootPaths: readonly string[],
  needles: readonly Uint8Array[],
): Promise<readonly PlaintextHit[]> {
  if (needles.some((needle) => needle.byteLength === 0)) {
    throw new Error("empty-plaintext-needle");
  }
  if (needles.length === 0) return [];

  const byteNeedles = needles.map((needle) => Buffer.from(needle));
  const hits: PlaintextHit[] = [];

  for (const rootPath of rootPaths) {
    const entry = await lstat(rootPath);
    if (entry.isSymbolicLink()) {
      throw new Error("plaintext-probe-symlink-root");
    }
    if (entry.isDirectory()) {
      hits.push(...(await scanDirectoryRoot(rootPath, byteNeedles)));
    } else if (entry.isFile()) {
      hits.push(...(await scanRegularFile(await realpath(rootPath), rootPath, byteNeedles)));
    }
  }

  return hits;
}
