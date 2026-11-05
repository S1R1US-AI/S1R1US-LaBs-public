/**
 * Test-only redirect for saved desk files. Server-only.
 *
 * Only when NODE_ENV is "test" and the test set DESK_TEST_DATA_DIR are the
 * shared files swapped for a file of the same name inside that private folder.
 * Every other run, including production, uses the normal paths unchanged.
 */
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

/**
 * The one accessor for the durable desk data folder. Read from the host's private env on every
 * call, with no built-in folder. Unset, relative, or containing ".." returns null, and callers then
 * keep only the /tmp copy (fail closed: never write a durable copy to a guessed folder).
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
  return dir ? `${dir}/${name}` : null;
}

/** deskDataFile with the test-only redirect applied (null when neither folder is set). */
export function deskDataPath(name: string): string | null {
  const test = testDataDir();
  return test ? `${test}/${name}` : deskDataFile(name);
}

/** Returns the path, or throws when the data folder is not set, so the caller's catch skips the read or write. */
export function requireDataFile(path: string | null): string {
  if (!path) throw new Error("desk data folder is not set");
  return path;
}

/** Saved-file list for one desk file: the /tmp copy, then the durable copy when the folder is set. */
export function deskStoreFiles(name: string): string[] {
  const durable = deskDataFile(name);
  return durable ? [`/tmp/${name}`, durable] : [`/tmp/${name}`];
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
