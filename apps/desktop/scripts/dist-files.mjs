import { constants } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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

function isContained(candidate, root) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function noFollowUnsupported(error) {
  return (
    process.platform === "win32" &&
    ["EINVAL", "ENOTSUP", "ENOSYS", "UNKNOWN"].includes(error.code)
  );
}

async function openReadOnlyNoFollow(pathname) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  if (noFollow === 0) return open(pathname, constants.O_RDONLY);
  try {
    return await open(pathname, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (!noFollowUnsupported(error)) throw error;
    // O_NOFOLLOW is not implemented by every Windows filesystem. The
    // mandatory post-open lstat/realpath/fstat identity checks remain active.
    return open(pathname, constants.O_RDONLY);
  }
}

export async function readRegularFile(pathname, label, canonicalRoot) {
  let handle;
  try {
    const beforeOpen = await metadata(pathname, label);
    assertNotSymlink(beforeOpen, label);
    if (!beforeOpen.isFile()) {
      throw new Error(`Distribution path is not a regular file: ${label}`);
    }

    handle = await openReadOnlyNoFollow(pathname);
    const descriptorMetadata = await handle.stat();
    if (!descriptorMetadata.isFile()) {
      throw new Error(`Distribution path is not a regular file: ${label}`);
    }

    const afterOpen = await metadata(pathname, label);
    assertNotSymlink(afterOpen, label);
    if (!afterOpen.isFile()) {
      throw new Error(`Distribution path is not a regular file: ${label}`);
    }
    const canonicalPath = await realpath(pathname);
    if (!isContained(canonicalPath, canonicalRoot)) {
      throw new Error(`Distribution path escapes the output root: ${label}`);
    }
    const followedPathMetadata = await stat(pathname);
    if (
      followedPathMetadata.dev !== descriptorMetadata.dev ||
      followedPathMetadata.ino !== descriptorMetadata.ino
    ) {
      throw new Error(`Distribution path changed while being read: ${label}`);
    }

    return { label, contents: await handle.readFile() };
  } finally {
    await handle?.close();
  }
}

async function readDirectory(directory, label, canonicalRoot) {
  const directoryMetadata = await metadata(directory, label);
  assertNotSymlink(directoryMetadata, label);
  if (!directoryMetadata.isDirectory()) {
    throw new Error(`Distribution path is not a directory: ${label}`);
  }
  const canonicalDirectory = await realpath(directory);
  if (!isContained(canonicalDirectory, canonicalRoot)) {
    throw new Error(`Distribution path escapes the output root: ${label}`);
  }

  const files = [];
  for (const entry of await readdir(directory)) {
    const entryPath = path.join(directory, entry);
    const entryLabel = `${label}/${entry}`;
    const entryMetadata = await metadata(entryPath, entryLabel);
    assertNotSymlink(entryMetadata, entryLabel);
    if (entryMetadata.isDirectory()) {
      files.push(
        ...(await readDirectory(entryPath, entryLabel, canonicalRoot)),
      );
    } else if (entryMetadata.isFile()) {
      files.push(await readRegularFile(entryPath, entryLabel, canonicalRoot));
    } else {
      throw new Error(`Unsupported distribution path type: ${entryLabel}`);
    }
  }
  return files;
}

export async function readFilesBelow(directory, label = directory) {
  const rootMetadata = await metadata(directory, label);
  assertNotSymlink(rootMetadata, label);
  if (!rootMetadata.isDirectory()) {
    throw new Error(`Distribution path is not a directory: ${label}`);
  }
  const canonicalRoot = await realpath(directory);
  return readDirectory(directory, label, canonicalRoot);
}
