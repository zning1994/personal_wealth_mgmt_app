import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

async function metadata(pathname, label) {
  try {
    return await lstat(pathname);
  } catch {
    throw new Error(`Missing required distribution path: ${label}`);
  }
}

function assertNotSymlink(value, label) {
  if (value.isSymbolicLink()) {
    throw new Error(`Distribution path must not be a symbolic link: ${label}`);
  }
}

export async function assertRegularFile(pathname, label = pathname) {
  const value = await metadata(pathname, label);
  assertNotSymlink(value, label);
  if (!value.isFile()) {
    throw new Error(`Distribution path is not a regular file: ${label}`);
  }
}

export async function filesBelow(directory, label = directory) {
  const directoryMetadata = await metadata(directory, label);
  assertNotSymlink(directoryMetadata, label);
  if (!directoryMetadata.isDirectory()) {
    throw new Error(`Distribution path is not a directory: ${label}`);
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      const entryLabel = path.join(label, entry.name);
      const entryMetadata = await metadata(entryPath, entryLabel);
      assertNotSymlink(entryMetadata, entryLabel);
      if (entryMetadata.isDirectory()) return filesBelow(entryPath, entryLabel);
      if (entryMetadata.isFile()) return [entryPath];
      throw new Error(`Unsupported distribution path type: ${entryLabel}`);
    }),
  );
  return nested.flat();
}
