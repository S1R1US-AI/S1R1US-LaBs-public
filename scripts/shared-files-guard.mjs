/**
 * Fails the test run if any shared file in /tmp or the desk data folder changed.
 *
 *   node scripts/shared-files-guard.mjs snapshot   (before the tests)
 *   node scripts/shared-files-guard.mjs check      (after the tests; exit 1 on change)
 *
 * The data folder comes from the host's data-folder env setting (none when unset).
 * The watched list is every "/tmp/..." path named in src/, server/ and scripts/,
 * every saved desk file named through deskStoreFiles / deskStorePaths /
 * deskDataFile / deskDataPath (its private state copy and its copy in the data folder),
 * plus every file and folder at the top of the data folder. Files are compared by content hash, folders by the hashes of
 * everything inside them, and links by their target as well as what they point to.
 * Other programs on the same machine can change these files too, so run the
 * tests in a private /tmp and data folder when other servers are running.
 */
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["src", "server", "scripts"];
const SCAN_EXT = /\.(ts|tsx|mjs|js|cjs|py)$/;
const PATH_RE = /\/tmp\/[A-Za-z0-9._-]+/g;
const STATE_DIR_NAME = "s1r1us-desk-state";
const storeCallRe = /\bdesk(Store(?:Files|Paths)|Data(?:File|Path))\(\s*"([A-Za-z0-9._-]+)"/g;
/** Absolute data folder from the env setting, or null (no built-in folder). */
export function guardDataDir(raw) {
  const dir = String(raw ?? "").trim().replace(/\/+$/, "");
  return dir.startsWith("/") && !dir.split("/").includes("..") ? dir : null;
}
const dataDirSetting = "S1R1US_DATA_DIR";
export const DATA_DIR = guardDataDir(process.env[dataDirSetting]);
/** Folders nested deeper than this are not read; `check` fails and names them. */
export const MAX_DEPTH = 64;

// Only a missing top-level source folder is skipped. Any other listing error stops the
// guard, because a folder it cannot read could name shared paths it would then miss.
function walk(dir, out, top = true) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (top && e?.code === "ENOENT") return out;
    throw new Error(`shared-files-guard: cannot list ${dir} (${e?.code ?? e?.message ?? e})`);
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, false);
    else if (e.isFile() && SCAN_EXT.test(e.name)) out.push(p);
  }
  return out;
}

/** Shared paths named in the source tree (sorted, unique). */
export function sharedPathsFromSource(root = ROOT, dataDir = DATA_DIR) {
  const found = new Set();
  for (const d of SCAN_DIRS) {
    for (const f of walk(path.join(root, d), [])) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(PATH_RE)) found.add(m[0]);
      for (const m of src.matchAll(storeCallRe)) {
        if (m[1].startsWith("Store")) found.add(path.join(tmpdir(), STATE_DIR_NAME, m[2]));
        if (dataDir) found.add(path.join(dataDir, m[2]));
      }
    }
  }
  return [...found].sort();
}

function hashFile(p, st) {
  return `file ${st.size} ${createHash("sha256").update(readFileSync(p)).digest("hex")}`;
}

// The watched path itself may be a link and is followed once. Links found inside a
// folder are never followed into folders (no loops); a linked file is still hashed.
// Every link, at any level, is recorded with its target ("link <target> -> ..."), so
// repointing a link to another file with the same bytes, or swapping a link for a
// regular file with the same bytes, is reported as a change.
// A linked folder inside a watched folder is added to `linked`, so `check` fails and
// names it instead of treating its contents as unchanged. A folder that cannot be
// listed is added to `unreadable`, so `check` fails instead of comparing two
// "dir unreadable" values as unchanged.
function describe(p, depth = 0, tooDeep = [], linked = [], unreadable = []) {
  let st;
  try {
    st = lstatSync(p);
  } catch (e) {
    return notThere(e, p, unreadable);
  }
  if (st.isSymbolicLink()) {
    let to;
    try {
      to = readlinkSync(p);
    } catch {
      unreadable.push(p);
      return "unreadable";
    }
    let target;
    try {
      target = statSync(p);
    } catch (e) {
      return notThere(e, p, unreadable);
    }
    const tag = `link ${JSON.stringify(to)} -> `;
    if (target.isFile()) return tag + hashFile(p, target);
    if (!target.isDirectory()) return `${tag}other`;
    if (depth === 0) return tag + describeDir(p, depth, tooDeep, linked, unreadable);
    linked.push(p);
    return `${tag}dir`;
  }
  if (st.isFile()) return hashFile(p, st);
  if (!st.isDirectory()) return "other";
  return describeDir(p, depth, tooDeep, linked, unreadable);
}

function describeDir(p, depth, tooDeep, linked, unreadable) {
  if (depth > MAX_DEPTH) {
    tooDeep.push(p);
    return "too-deep";
  }
  let names;
  try {
    names = readdirSync(p).sort();
  } catch {
    unreadable.push(p);
    return "dir unreadable";
  }
  // Children are described the same way, so file contents are hashed at every level.
  const parts = names.map(
    (n) => `${n}=${describe(path.join(p, n), depth + 1, tooDeep, linked, unreadable)}`,
  );
  return `dir ${createHash("sha256").update(parts.join("\n")).digest("hex")}`;
}

// Only a path that is really gone counts as missing. Any other error (for example a
// folder that can be listed but not entered) adds the path to `unreadable`, so `check`
// fails instead of recording "missing" before and after a change it could not see.
// A link whose target is gone is still recorded with its target, so creating, removing
// or repointing a dangling link is reported as a change.
function notThere(e, p, unreadable) {
  if (e?.code !== "ENOENT" && e?.code !== "ENOTDIR") {
    unreadable.push(p);
    return "unreadable";
  }
  let st;
  try {
    st = lstatSync(p);
  } catch (e2) {
    if (e2?.code === "ENOENT" || e2?.code === "ENOTDIR") return "missing";
    unreadable.push(p);
    return "unreadable";
  }
  if (!st.isSymbolicLink()) return "missing";
  try {
    return `dangling link ${readlinkSync(p)}`;
  } catch {
    unreadable.push(p);
    return "unreadable";
  }
}

// A missing data folder has nothing to watch. Any other listing error adds the folder
// to `unreadable`, so `check` fails instead of treating it as empty.
function topEntries(dir, unreadable = []) {
  if (!dir) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() || e.isDirectory() || e.isSymbolicLink())
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch (e) {
    if (e?.code !== "ENOENT") unreadable.push(dir);
    return [];
  }
}

/**
 * State of every watched path. Folders too deep to read are added to `tooDeep`,
 * linked folders inside watched folders (not followed) are added to `linked`, and
 * folders that cannot be listed are added to `unreadable`.
 */
export function snapshot(
  paths = sharedPathsFromSource(),
  dataDir = DATA_DIR,
  tooDeep = [],
  linked = [],
  unreadable = [],
) {
  const all = new Set([...paths, ...topEntries(dataDir, unreadable)]);
  return Object.fromEntries(
    [...all].sort().map((p) => [p, describe(p, 0, tooDeep, linked, unreadable)]),
  );
}

function reportUnreadable(unreadable) {
  if (!unreadable.length) return false;
  console.error("shared-files-guard: paths that cannot be listed or read:");
  for (const p of [...new Set(unreadable)].sort())
    console.error(`  ${p}: cannot be listed or read`);
  return true;
}

/** Paths that differ between two snapshots, plus new files or folders in the data folder. */
export function changes(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out = [];
  for (const k of [...keys].sort()) {
    const a = before[k] ?? "missing";
    const b = after[k] ?? "missing";
    if (a !== b) out.push({ path: k, before: a, after: b });
  }
  return out;
}

// Each test run keeps its own snapshot, so two runs in the same checkout can't read
// or overwrite each other's. `snapshot` and `check` are started by the same shell
// (see the "test" script in package.json), so the shell's process id names the run.
// SHARED_FILES_GUARD_STATE sets the file directly.
function stateFile() {
  return (
    process.env.SHARED_FILES_GUARD_STATE ||
    path.join(ROOT, "node_modules", ".cache", `shared-files-guard-${process.ppid}.json`)
  );
}

function extraPaths() {
  return (process.env.SHARED_FILES_GUARD_EXTRA ?? "")
    .split(":")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("/"));
}

function main(cmd) {
  let paths;
  try {
    paths = [...sharedPathsFromSource(), ...extraPaths()];
  } catch (e) {
    console.error(e?.message ?? String(e));
    return 1;
  }
  const file = stateFile();
  if (cmd === "snapshot") {
    const unreadable = [];
    const state = snapshot(paths, DATA_DIR, [], [], unreadable);
    if (reportUnreadable(unreadable)) return 1;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
    return 0;
  }
  if (cmd === "check") {
    let before;
    try {
      before = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      console.error("shared-files-guard: no snapshot found; run `snapshot` before the tests.");
      return 1;
    }
    // One check per snapshot: a later check without a new snapshot fails instead of
    // comparing against an old run.
    rmSync(file, { force: true });
    const tooDeep = [];
    const linked = [];
    const unreadable = [];
    const diff = changes(before, snapshot(paths, DATA_DIR, tooDeep, linked, unreadable));
    const blind = reportUnreadable(unreadable);
    if (tooDeep.length) {
      console.error("shared-files-guard: folders too deep to verify:");
      for (const p of tooDeep) console.error(`  ${p}: too deep to verify`);
    }
    if (linked.length) {
      console.error("shared-files-guard: linked folders not verified:");
      for (const p of [...new Set(linked)].sort())
        console.error(`  ${p}: linked folder not verified`);
    }
    if (!diff.length && !tooDeep.length && !linked.length && !blind) {
      console.log(`shared-files-guard: ${Object.keys(before).length} shared paths unchanged.`);
      return 0;
    }
    if (!diff.length) return 1;
    console.error("shared-files-guard: the test run changed shared files:");
    for (const d of diff)
      console.error(`  ${d.path}: ${d.before.split(" ")[0]} -> ${d.after.split(" ")[0]}`);
    console.error("Point the test at its own temp folder (see src/lib/desk/data-path.ts).");
    return 1;
  }
  console.error("usage: node scripts/shared-files-guard.mjs snapshot|check");
  return 2;
}

/**
 * Whether this file is the script node was asked to run. Both sides are resolved
 * through links: node resolves `import.meta.url` to the real file but leaves
 * `process.argv[1]` as typed, so a raw comparison would make a run through a linked
 * script or checkout path do nothing and exit 0.
 */
export function isMainModule(moduleUrl = import.meta.url, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = main(process.argv[2]);
}
