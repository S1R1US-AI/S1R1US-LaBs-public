/**
 * Test-only redirect for saved desk files. Server-only.
 *
 * Only when NODE_ENV is "test" and the test set DESK_TEST_DATA_DIR are the
 * shared files swapped for a file of the same name inside that private folder.
 * Every other run, including production, uses the normal paths unchanged.
 */
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { randomBytes } from "node:crypto";

export function testDataDir(): string {
  if (typeof process === "undefined" || process.env?.NODE_ENV !== "test") return "";
  const dir = process.env.DESK_TEST_DATA_DIR?.trim() ?? "";
  return dir.startsWith("/") ? dir.replace(/\/+$/, "") : "";
}

export function dataPaths(paths: string[]): string[] {
  const dir = testDataDir();
  if (!dir || !paths.length) return paths;
  const base = paths[0]!.slice(paths[0]!.lastIndexOf("/") + 1);
  return [`${dir}/${base}`];
}

export function dataPath(path: string): string {
  return dataPaths([path])[0]!;
}

/** Name of the host's private env setting that holds the durable desk data folder. */
export const dataDirSetting = "S1R1US_DATA_DIR";

/** Folder name for the private fallback state directory under the process temp dir. */
export const DESK_STATE_DIR_NAME = "s1r1us-desk-state";

/**
 * The one accessor for the durable desk data folder. Read from the host's private env on every
 * call, with no built-in folder. Unset, relative, or containing ".." returns null, and callers then
 * keep only the private state copy (fail closed: never write a durable copy to a guessed folder).
 */
export function deskDataDir(): string | null {
  if (typeof process === "undefined" || !process.env) return null;
  const raw = process.env[dataDirSetting]?.trim() ?? "";
  if (!raw.startsWith("/")) return null;
  const dir = raw.replace(/\/+$/, "");
  if (!dir || dir.split("/").includes("..")) return null;
  return dir;
}

/** Durable copy of one desk file inside the data folder, or null when the folder is not set. */
export function deskDataFile(name: string): string | null {
  const dir = deskDataDir();
  return dir ? `${dir}/${storeFileName(name)}` : null;
}

/** deskDataFile with the test-only redirect applied (null when neither folder is set). */
export function deskDataPath(name: string): string | null {
  const test = testDataDir();
  return test ? `${test}/${storeFileName(name)}` : deskDataFile(name);
}

/** Returns the path, or throws when the data folder is not set, so the caller's catch skips the read or write. */
export function requireDataFile(path: string | null): string {
  if (!path) throw new Error("desk data folder is not set");
  return path;
}

function storeFileName(name: string): string {
  const base = String(name ?? "")
    .trim()
    .split(/[/\\]/)
    .pop() ?? "";
  if (!base || base === "." || base === ".." || !/^[A-Za-z0-9._-]+$/.test(base)) {
    throw new Error("invalid desk file name");
  }
  return base;
}

/** Absolute path of the private fallback state directory (not created yet). */
export function deskStateDir(): string {
  return join(tmpdir(), DESK_STATE_DIR_NAME);
}

/** Private fallback copy of one desk file, inside the state directory. */
export function deskStateFile(name: string): string {
  return join(deskStateDir(), storeFileName(name));
}

/**
 * Create or reuse the private state directory. Refuses a symlink, a non-directory,
 * a folder owned by anyone else, or a folder with any group or other access.
 */
export function ensureDeskStateDir(): string {
  const dir = deskStateDir();
  let st;
  try {
    st = lstatSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* rechecked below */
    }
    st = lstatSync(dir);
  }
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error("desk state folder is not a real directory");
  }
  const uid = processUid();
  if (uid !== undefined && st.uid !== uid) {
    throw new Error("desk state folder has the wrong owner");
  }
  if ((st.mode & 0o077) !== 0) {
    // Group or other access means files may already have been planted: refuse, never repair.
    throw new Error("desk state folder has the wrong mode");
  }
  if ((st.mode & 0o777) !== 0o700) {
    // Only owner bits are missing (for example a strict umask): restore 0700.
    chmodSync(dir, 0o700);
    st = lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory() || (st.mode & 0o777) !== 0o700) {
      throw new Error("desk state folder has the wrong mode");
    }
  }
  return dir;
}

/** Saved-file list for one desk file: the durable copy first when set, then the private state copy. */
export function deskStoreFiles(name: string): string[] {
  const file = storeFileName(name);
  const durable = deskDataFile(file);
  const fallback = deskStateFile(file);
  return durable ? [durable, fallback] : [fallback];
}

/** deskStoreFiles with the test-only redirect applied. */
export function deskStorePaths(name: string): string[] {
  return dataPaths(deskStoreFiles(name));
}

/** Folder that holds a saved file (for mkdir before a write). */
export function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : "/";
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Write a desk file by writing a sibling temp file at mode 0600, then renaming.
 * Refuses to write when the target is a symlink. When the target lives in the
 * private state directory, that directory is created and checked first.
 */
export function writeDeskFile(path: string, body: string | Buffer): void {
  if (!path || path.includes("\0")) throw new Error("invalid desk file path");
  const dir = parentDir(path);
  if (inDeskStateDir(path)) {
    ensureDeskStateDir();
  } else {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  if (isSymlink(path)) throw new Error("refusing to write through a symlink");
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let fd: number | undefined;
  try {
    if (isSymlink(tmp)) throw new Error("refusing to write through a symlink");
    fd = openSync(tmp, "wx", 0o600);
    const buf = typeof body === "string" ? Buffer.from(body, "utf8") : body;
    let off = 0;
    while (off < buf.length) {
      off += writeSync(fd, buf, off, buf.length - off);
    }
    fchmodSync(fd, 0o600);
    closeSync(fd);
    fd = undefined;
    if (isSymlink(path)) throw new Error("refusing to write through a symlink");
    renameSync(tmp, path);
  } catch (err) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
    try {
      unlinkSync(tmp);
    } catch {
      /* missing */
    }
    throw err;
  }
}

function processUid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

/** True when the path is the private state directory or a file inside it. */
function inDeskStateDir(path: string): boolean {
  const dir = deskStateDir();
  return path === dir || parentDir(path) === dir || path.startsWith(`${dir}/`);
}

/**
 * Read-side check of the private state directory. Creates and changes nothing.
 * True only for a real directory (not a symlink) owned by this process with mode exactly 0700.
 * Any other state, including a missing folder, is false, so readers skip the fallback copy.
 */
export function deskStateDirIsSafe(): boolean {
  let st;
  try {
    st = lstatSync(deskStateDir());
  } catch {
    return false;
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return false;
  const uid = processUid();
  if (uid !== undefined && st.uid !== uid) return false;
  return (st.mode & 0o777) === 0o700;
}

const READ_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);

/**
 * The one reader for saved desk files. Throws (so the caller's catch skips this path) when:
 * - the path is in the private state directory and that directory fails deskStateDirIsSafe(),
 * - the file is a symlink (opened with no-follow),
 * - the opened file is not a regular file, or, inside the state directory, not owned by this process.
 * The body is read from the same open handle that was checked.
 */
export function readDeskFile(path: string): string {
  if (!path || path.includes("\0")) throw new Error("invalid desk file path");
  const stateCopy = inDeskStateDir(path);
  if (stateCopy && !deskStateDirIsSafe()) throw new Error("desk state folder failed its safety check");
  // Read-only open; the 0600 mode would only apply if a file were ever created here.
  const fd = openSync(path, READ_FLAGS, 0o600);
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error("desk file is not a regular file");
    const uid = processUid();
    if (stateCopy && uid !== undefined && st.uid !== uid) throw new Error("desk state file has the wrong owner");
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

/** True when readDeskFile would read this path (used for presence-only flags). */
export function deskFileReadable(path: string): boolean {
  try {
    readDeskFile(path);
    return true;
  } catch {
    return false;
  }
}
