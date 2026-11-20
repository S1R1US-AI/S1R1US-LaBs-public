import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MAX_DEPTH,
  changes,
  isMainModule,
  guardDataDir,
  sharedPathsFromSource,
  snapshot,
} from "./shared-files-guard.mjs";

const GUARD = fileURLToPath(new URL("./shared-files-guard.mjs", import.meta.url));

/**
 * Runs the guard command against `dir` only: a copy of the guard that scans an empty
 * source tree and uses a fake data folder, so nothing outside `dir` is watched and
 * other activity on the machine can't affect the result.
 */
function isolatedGuard(dir, watched) {
  const root = join(dir, "root");
  const dataDir = join(dir, "data");
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  const line = "export const DATA_DIR = guardDataDir(process.env[dataDirSetting]);";
  const src = readFileSync(GUARD, "utf8");
  assert.ok(src.includes(line));
  const copy = join(root, "bin", "guard.mjs");
  writeFileSync(copy, src.replace(line, `export const DATA_DIR = ${JSON.stringify(dataDir)};`));
  const state = join(dir, "state.json");
  const env = {
    ...process.env,
    SHARED_FILES_GUARD_STATE: state,
    SHARED_FILES_GUARD_EXTRA: watched,
  };
  const run = (cmd) => {
    const res = spawnSync(process.execPath, [copy, cmd], { env, encoding: "utf8" });
    if (cmd === "snapshot" && res.status === 0) {
      for (const p of Object.keys(JSON.parse(readFileSync(state, "utf8"))))
        assert.ok(p.startsWith(dir + "/"), `${p} is outside the test folder`);
    }
    return res;
  };
  return run;
}

test("the watched list includes the saved desk files", () => {
  const fake = "/srv/fake-desk-data";
  const paths = sharedPathsFromSource(undefined, fake);
  for (const p of [
    join(tmpdir(), "s1r1us-desk-state", "app-admins.json"),
    join(tmpdir(), "s1r1us-desk-state", "board-wager.json"),
    `${fake}/board-wager.json`,
    `${fake}/practice-pulse.json`,
    "/tmp/world-cup-test.json",
  ]) {
    assert.ok(paths.includes(p), `${p} should be watched`);
  }
  assert.ok(!sharedPathsFromSource(undefined, null).some((p) => p.startsWith(fake)), "no data folder when unset");
});

test("the data folder comes only from an absolute env setting", () => {
  assert.equal(guardDataDir(undefined), null);
  assert.equal(guardDataDir(""), null);
  assert.equal(guardDataDir("relative/dir"), null);
  assert.equal(guardDataDir("/srv/x/../y"), null);
  assert.equal(guardDataDir("/srv/fake-desk-data/"), "/srv/fake-desk-data");
});

test("a changed, added or removed file is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-unit-"));
  try {
    const a = join(dir, "a.json");
    const b = join(dir, "b.json");
    writeFileSync(a, "1");
    const before = snapshot([a, b], join(dir, "none"));
    assert.deepEqual(changes(before, snapshot([a, b], join(dir, "none"))), []);
    writeFileSync(a, "2");
    writeFileSync(b, "new");
    const diff = changes(before, snapshot([a, b], join(dir, "none")));
    assert.deepEqual(
      diff.map((d) => d.path),
      [a, b],
    );
    rmSync(a);
    assert.equal(changes(snapshot([a], join(dir, "none")), before).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a same-size rewrite inside a watched folder is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-dir-"));
  try {
    const sub = join(dir, "lib");
    const f = join(sub, "deep", "item.json");
    mkdirSync(join(sub, "deep"), { recursive: true });
    writeFileSync(f, "aaaa");
    const { atime, mtime } = statSync(f);
    const before = snapshot([sub], join(dir, "none"));
    writeFileSync(f, "bbbb");
    utimesSync(f, atime, mtime);
    assert.deepEqual(
      changes(before, snapshot([sub], join(dir, "none"))).map((d) => d.path),
      [sub],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a new file in a new folder under the data folder is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-data-"));
  try {
    const before = snapshot([], dir);
    mkdirSync(join(dir, "fresh"));
    writeFileSync(join(dir, "fresh", "leak.json"), "{}");
    assert.deepEqual(
      changes(before, snapshot([], dir)).map((d) => d.path),
      [join(dir, "fresh")],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check exits non-zero when a watched file changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-cli-"));
  try {
    const watched = join(dir, "watched.json");
    writeFileSync(watched, "before");
    const run = isolatedGuard(dir, watched);
    assert.equal(run("snapshot").status, 0);
    assert.equal(run("check").status, 0);
    assert.equal(run("snapshot").status, 0);
    writeFileSync(watched, "after");
    const res = run("check");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /watched\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a same-size rewrite 7 levels deep inside a watched folder is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-deep-"));
  try {
    const sub = join(dir, "lib");
    const leaf = join(sub, "a", "b", "c", "d", "e", "f");
    const f = join(leaf, "item.json");
    mkdirSync(leaf, { recursive: true });
    writeFileSync(f, "aaaa");
    const { atime, mtime } = statSync(f);
    const before = snapshot([sub], join(dir, "none"));
    writeFileSync(f, "bbbb");
    utimesSync(f, atime, mtime);
    assert.deepEqual(
      changes(before, snapshot([sub], join(dir, "none"))).map((d) => d.path),
      [sub],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a folder nested past the limit fails the check as too deep to verify", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-cap-"));
  try {
    const watched = join(dir, "lib");
    let leaf = watched;
    for (let i = 0; i <= MAX_DEPTH + 1; i++) leaf = join(leaf, "d");
    mkdirSync(leaf, { recursive: true });
    writeFileSync(join(leaf, "item.json"), "x");
    const tooDeep = [];
    snapshot([watched], join(dir, "none"), tooDeep);
    assert.ok(tooDeep.length > 0);
    const run = isolatedGuard(dir, watched);
    assert.equal(run("snapshot").status, 0);
    const res = run("check");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /too deep to verify/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a link loop inside a watched folder is not followed", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-loop-"));
  try {
    const sub = join(dir, "lib");
    mkdirSync(join(sub, "inner"), { recursive: true });
    writeFileSync(join(sub, "inner", "item.json"), "1");
    symlinkSync(sub, join(sub, "inner", "loop"));
    const tooDeep = [];
    const linked = [];
    const before = snapshot([sub], join(dir, "none"), tooDeep, linked);
    assert.deepEqual(tooDeep, []);
    assert.deepEqual(linked, [join(sub, "inner", "loop")]);
    assert.deepEqual(changes(before, snapshot([sub], join(dir, "none"))), []);
    writeFileSync(join(sub, "inner", "item.json"), "2");
    assert.deepEqual(
      changes(before, snapshot([sub], join(dir, "none"))).map((d) => d.path),
      [sub],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a change through a link at the top of the data folder is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-toplink-"));
  try {
    const data = join(dir, "data");
    const target = join(dir, "elsewhere.json");
    mkdirSync(data);
    writeFileSync(target, "1");
    symlinkSync(target, join(data, "linked.json"));
    const before = snapshot([], data);
    writeFileSync(join(data, "linked.json"), "2");
    assert.deepEqual(
      changes(before, snapshot([], data)).map((d) => d.path),
      [join(data, "linked.json")],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a linked folder inside a watched folder fails the check as not verified", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-dirlink-"));
  try {
    const watched = join(dir, "lib");
    const outside = join(dir, "outside");
    mkdirSync(watched, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "item.json"), "1");
    symlinkSync(outside, join(watched, "linked"));
    const run = isolatedGuard(dir, watched);
    assert.equal(run("snapshot").status, 0);
    writeFileSync(join(watched, "linked", "item.json"), "2");
    const res = run("check");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /linked folder not verified/);
    assert.match(res.stderr, /lib\/linked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the guard still runs when started through a linked path", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-entry-"));
  try {
    const link = join(dir, "guard-link.mjs");
    symlinkSync(GUARD, link);
    assert.equal(isMainModule(pathToFileURL(GUARD).href, link), true);
    const res = spawnSync(process.execPath, [link, "check"], {
      env: { ...process.env, SHARED_FILES_GUARD_STATE: join(dir, "no-state.json") },
      encoding: "utf8",
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /no snapshot found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("creating, repointing or removing a dangling link is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-dangling-"));
  try {
    const data = join(dir, "data");
    const watched = join(dir, "watched.json");
    mkdirSync(data);
    const link = join(data, "gone.json");
    const empty = snapshot([watched], data);
    symlinkSync(join(dir, "nowhere-1"), link);
    symlinkSync(join(dir, "nowhere-1"), watched);
    const one = snapshot([watched], data);
    assert.equal(one[link], `dangling link ${join(dir, "nowhere-1")}`);
    assert.deepEqual(
      changes(empty, one).map((d) => d.path),
      [watched, link].sort(),
    );
    rmSync(link);
    rmSync(watched);
    symlinkSync(join(dir, "nowhere-2"), link);
    symlinkSync(join(dir, "nowhere-2"), watched);
    const two = snapshot([watched], data);
    assert.deepEqual(
      changes(one, two).map((d) => d.path),
      [watched, link].sort(),
    );
    rmSync(link);
    rmSync(watched);
    assert.deepEqual(
      changes(two, snapshot([watched], data)).map((d) => d.path),
      [watched, link].sort(),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Folder permissions don't stop the root user, so these checks only run as a normal user.
const canDenyListing = typeof process.getuid === "function" && process.getuid() !== 0;
const denySkip = canDenyListing ? false : "running as root: folder permissions are not enforced";

test(
  "a folder that can be listed but not entered fails snapshot and check",
  { skip: denySkip },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "guard-noenter-"));
    const sub = join(dir, "lib", "locked");
    try {
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, "item.json"), "aaaa");
      const run = isolatedGuard(dir, join(dir, "lib"));
      assert.equal(run("snapshot").status, 0);
      // Listable but not enterable: its files can't be checked, so they must not count as missing.
      chmodSync(sub, 0o400);
      const unreadable = [];
      snapshot([join(dir, "lib")], join(dir, "none"), [], [], unreadable);
      assert.deepEqual(unreadable, [join(sub, "item.json")]);
      const check = run("check");
      assert.equal(check.status, 1);
      assert.match(check.stderr, /item\.json: cannot be listed or read/);
      assert.equal(run("snapshot").status, 1);
    } finally {
      chmodSync(sub, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "a folder that cannot be listed inside a watched folder fails snapshot and check",
  { skip: denySkip },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "guard-noread-"));
    const sub = join(dir, "lib", "hidden");
    try {
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, "item.json"), "aaaa");
      const run = isolatedGuard(dir, join(dir, "lib"));
      assert.equal(run("snapshot").status, 0);
      // Writable and enterable, but not listable: a test could still change files here.
      chmodSync(sub, 0o300);
      writeFileSync(join(sub, "item.json"), "bbbb");
      const check = run("check");
      assert.equal(check.status, 1);
      assert.match(check.stderr, /hidden: cannot be listed/);
      const snap = run("snapshot");
      assert.equal(snap.status, 1);
      assert.match(snap.stderr, /hidden: cannot be listed/);
      const unreadable = [];
      snapshot([join(dir, "lib")], join(dir, "none"), [], [], unreadable);
      assert.deepEqual(unreadable, [sub]);
    } finally {
      chmodSync(sub, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "a data folder that cannot be listed is reported, and a missing one is not",
  { skip: denySkip },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "guard-nodata-"));
    const data = join(dir, "data");
    try {
      mkdirSync(data);
      writeFileSync(join(data, "leak.json"), "{}");
      chmodSync(data, 0o300);
      const unreadable = [];
      snapshot([], data, [], [], unreadable);
      assert.deepEqual(unreadable, [data]);
      const none = [];
      snapshot([], join(dir, "missing"), [], [], none);
      assert.deepEqual(none, []);
    } finally {
      chmodSync(data, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "a source folder that cannot be listed stops the scan instead of being skipped",
  { skip: denySkip },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "guard-nosrc-"));
    const sub = join(dir, "src", "lib");
    try {
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, "a.ts"), 'const p = "/tmp/x.json";');
      assert.deepEqual(sharedPathsFromSource(dir), ["/tmp/x.json"]);
      chmodSync(sub, 0o300);
      assert.throws(() => sharedPathsFromSource(dir), /cannot list .*src\/lib/);
      // A missing top-level source folder (here server/ and scripts/) is fine.
      chmodSync(sub, 0o700);
      assert.doesNotThrow(() => sharedPathsFromSource(dir));
    } finally {
      chmodSync(sub, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("repointing a watched link to a file with the same bytes is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-repoint-"));
  try {
    const one = join(dir, "one.json");
    const two = join(dir, "two.json");
    writeFileSync(one, "same");
    writeFileSync(two, "same");
    const watched = join(dir, "watched.json");
    const data = join(dir, "data");
    mkdirSync(data);
    const top = join(data, "top.json");
    const lib = join(dir, "lib");
    mkdirSync(lib);
    const nested = join(lib, "nested.json");
    for (const l of [watched, top, nested]) symlinkSync(one, l);
    const before = snapshot([watched, lib], data);
    assert.match(before[watched], /^link ".*one\.json" -> file 4 /);
    for (const l of [watched, top, nested]) {
      rmSync(l);
      symlinkSync(two, l);
    }
    assert.deepEqual(
      changes(before, snapshot([watched, lib], data)).map((d) => d.path),
      [watched, lib, top].sort(),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("swapping a watched link for a regular file with the same bytes is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-swap-"));
  try {
    const target = join(dir, "target.json");
    writeFileSync(target, "same");
    const watched = join(dir, "watched.json");
    const lib = join(dir, "lib");
    mkdirSync(lib);
    const nested = join(lib, "nested.json");
    symlinkSync(target, watched);
    symlinkSync(target, nested);
    const before = snapshot([watched, lib], join(dir, "none"));
    for (const l of [watched, nested]) {
      rmSync(l);
      writeFileSync(l, "same");
    }
    const after = snapshot([watched, lib], join(dir, "none"));
    assert.match(after[watched], /^file 4 /);
    assert.deepEqual(
      changes(before, after).map((d) => d.path),
      [watched, lib].sort(),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("each run keeps its own snapshot and a check uses it only once", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-perrun-"));
  try {
    const root = join(dir, "root");
    const dataDir = join(dir, "data");
    mkdirSync(join(root, "bin"), { recursive: true });
    mkdirSync(dataDir);
    const line = "export const DATA_DIR = guardDataDir(process.env[dataDirSetting]);";
    const copy = join(root, "bin", "guard.mjs");
    writeFileSync(
      copy,
      readFileSync(GUARD, "utf8").replace(
        line,
        `export const DATA_DIR = ${JSON.stringify(dataDir)};`,
      ),
    );
    const env = { ...process.env, SHARED_FILES_GUARD_EXTRA: join(dir, "w.json") };
    delete env.SHARED_FILES_GUARD_STATE;
    // Each call starts one parent process that runs the given guard commands in turn,
    // like the shell in the "test" script. No shell is involved.
    const parent = (...cmds) =>
      spawnSync(
        process.execPath,
        [
          "-e",
          `const { spawnSync } = require("node:child_process");
           let status = 0;
           for (const cmd of process.argv.slice(1)) {
             const r = spawnSync(process.execPath, [${JSON.stringify(copy)}, cmd], { stdio: "inherit" });
             if (r.status !== 0) { status = r.status ?? 1; break; }
           }
           process.exit(status);`,
          ...cmds,
        ],
        { env, encoding: "utf8" },
      );
    // Snapshot and check from the same run pass, and the snapshot is removed after.
    const run = parent("snapshot", "check");
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(readdirSync(join(root, "node_modules", ".cache")), []);
    // A second check in the same run has no snapshot left to compare against.
    const again = parent("snapshot", "check", "check");
    assert.equal(again.status, 1);
    assert.match(again.stderr, /no snapshot found/);
    // A check from another run never sees this run's snapshot.
    assert.equal(parent("snapshot").status, 0);
    const other = parent("check");
    assert.equal(other.status, 1);
    assert.match(other.stderr, /no snapshot found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a snapshot named by SHARED_FILES_GUARD_STATE is also used only once", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-once-"));
  try {
    const run = isolatedGuard(dir, join(dir, "w.json"));
    assert.equal(run("snapshot").status, 0);
    assert.equal(run("check").status, 0);
    const again = run("check");
    assert.equal(again.status, 1);
    assert.match(again.stderr, /no snapshot found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
