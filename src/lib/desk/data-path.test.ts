import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DESK_STATE_DIR_NAME,
  dataDirSetting,
  dataPath,
  dataPaths,
  deskDataDir,
  deskDataFile,
  deskDataPath,
  deskFileReadable,
  deskStateDir,
  deskStateDirIsSafe,
  deskStateFile,
  deskStoreFiles,
  deskStorePaths,
  ensureDeskStateDir,
  parentDir,
  readDeskFile,
  requireDataFile,
  testDataDir,
  writeDeskFile,
} from "./data-path.ts";

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  DESK_TEST_DATA_DIR: process.env.DESK_TEST_DATA_DIR,
};
const fakeData = "/srv/fake-desk-data";
const fallback = (name: string) => join(tmpdir(), DESK_STATE_DIR_NAME, name);
const SHARED = [`${fakeData}/board-wager.json`, fallback("board-wager.json")];

function setEnv(nodeEnv: string | undefined, dir: string | undefined) {
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  if (dir === undefined) delete process.env.DESK_TEST_DATA_DIR;
  else process.env.DESK_TEST_DATA_DIR = dir;
}

describe("test data folder redirect", () => {
  afterEach(() => setEnv(saved.NODE_ENV, saved.DESK_TEST_DATA_DIR));

  it("the test preload is active for this run", () => {
    assert.equal(process.env.NODE_ENV, "test");
    assert.ok(
      testDataDir().startsWith("/"),
      "DESK_TEST_DATA_DIR should be set by scripts/test-data-dir.mjs",
    );
  });

  it("sends saved files to the private folder in tests", () => {
    setEnv("test", "/tmp/private-x/");
    assert.deepEqual(dataPaths(SHARED), ["/tmp/private-x/board-wager.json"]);
    assert.equal(dataPath(`${fakeData}/morning-lib`), "/tmp/private-x/morning-lib");
  });

  it("never redirects outside tests", () => {
    for (const env of ["production", "development", undefined]) {
      setEnv(env, "/tmp/private-x");
      assert.deepEqual(dataPaths(SHARED), SHARED, `NODE_ENV=${env}`);
    }
  });

  it("ignores a missing or relative folder", () => {
    setEnv("test", undefined);
    assert.deepEqual(dataPaths(SHARED), SHARED);
    setEnv("test", "relative/dir");
    assert.deepEqual(dataPaths(SHARED), SHARED);
  });
});

describe("desk data folder setting", () => {
  const savedDir = process.env[dataDirSetting];
  afterEach(() => {
    if (savedDir === undefined) delete process.env[dataDirSetting];
    else process.env[dataDirSetting] = savedDir;
    setEnv(saved.NODE_ENV, saved.DESK_TEST_DATA_DIR);
  });

  it("fails closed when the setting is unset or not a plain absolute folder", () => {
    for (const bad of [undefined, "", "   ", "relative/dir", "/srv/a/../b"]) {
      if (bad === undefined) delete process.env[dataDirSetting];
      else process.env[dataDirSetting] = bad;
      assert.equal(deskDataDir(), null, `setting: ${String(bad)}`);
      assert.equal(deskDataFile("board-wager.json"), null);
      assert.deepEqual(deskStoreFiles("board-wager.json"), [fallback("board-wager.json")]);
      assert.throws(() => requireDataFile(deskDataFile("gm-live.json")), /data folder is not set/);
    }
  });

  it("uses the folder from the setting when it is set, and reads that copy first", () => {
    process.env[dataDirSetting] = `${fakeData}/`;
    assert.equal(deskDataDir(), fakeData);
    assert.equal(deskDataFile("gm-live.json"), `${fakeData}/gm-live.json`);
    assert.deepEqual(deskStoreFiles("board-wager.json"), SHARED);
    assert.equal(deskStoreFiles("board-wager.json")[0], `${fakeData}/board-wager.json`);
    assert.ok(!deskStoreFiles("board-wager.json").includes("/tmp/board-wager.json"));
    assert.equal(requireDataFile(deskDataFile("gm-live.json")), `${fakeData}/gm-live.json`);
    assert.equal(parentDir(`${fakeData}/gm-live.json`), fakeData);
  });

  it("keeps the test redirect ahead of the setting", () => {
    process.env[dataDirSetting] = fakeData;
    setEnv("test", "/tmp/private-x");
    assert.deepEqual(deskStorePaths("board-wager.json"), ["/tmp/private-x/board-wager.json"]);
    assert.equal(deskDataPath("practice-pulse.json"), "/tmp/private-x/practice-pulse.json");
    setEnv("production", "/tmp/private-x");
    assert.deepEqual(deskStorePaths("board-wager.json"), SHARED);
    assert.equal(deskDataPath("practice-pulse.json"), `${fakeData}/practice-pulse.json`);
  });
});

describe("private state directory and atomic writes", () => {
  const scratch: string[] = [];
  afterEach(() => {
    for (const d of scratch.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  it("creates the state folder at 0700, owned by this process, and refuses a symlink", () => {
    const dir = ensureDeskStateDir();
    scratch.push(dir);
    assert.equal(dir, deskStateDir());
    const st = lstatSync(dir);
    assert.equal(st.isDirectory(), true);
    assert.equal(st.isSymbolicLink(), false);
    assert.equal(st.mode & 0o777, 0o700);
    if (typeof process.getuid === "function") assert.equal(st.uid, process.getuid());
  });

  it("writes with 0600 via a sibling temp file and rename", () => {
    const dir = mkdtempSync(join(tmpdir(), "desk-write-"));
    scratch.push(dir);
    const target = join(dir, "row.json");
    writeDeskFile(target, '{"ok":true}');
    // One no-follow handle: a symlink fails to open, and mode and body come from the same file.
    const fd = openSync(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const st = fstatSync(fd);
      assert.equal(st.isFile(), true);
      assert.equal(st.mode & 0o777, 0o600);
      assert.equal(readFileSync(fd, "utf8"), '{"ok":true}');
    } finally {
      closeSync(fd);
    }
    assert.deepEqual(
      readdirSync(dir).filter((n: string) => n.endsWith(".tmp")),
      [],
    );
  });

  it("refuses to write through a symlink at the target", () => {
    const dir = mkdtempSync(join(tmpdir(), "desk-link-"));
    scratch.push(dir);
    const real = join(dir, "real.json");
    const target = join(dir, "row.json");
    writeFileSync(real, "secret", { mode: 0o600 });
    symlinkSync(real, target);
    assert.throws(() => writeDeskFile(target, "hostile"), /symlink/);
    assert.equal(readFileSync(real, "utf8"), "secret");
  });
});

describe("desk file reader", () => {
  const scratch: string[] = [];
  afterEach(() => {
    for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
    rmSync(deskStateDir(), { recursive: true, force: true });
  });

  it("reads a regular file and refuses a symlinked file or a non-file", () => {
    const dir = mkdtempSync(join(tmpdir(), "desk-read-"));
    scratch.push(dir);
    writeFileSync(join(dir, "real.json"), '{"ok":1}', { mode: 0o600 });
    symlinkSync(join(dir, "real.json"), join(dir, "link.json"));
    mkdirSync(join(dir, "sub.json"));
    assert.equal(readDeskFile(join(dir, "real.json")), '{"ok":1}');
    assert.throws(() => readDeskFile(join(dir, "link.json")));
    assert.throws(() => readDeskFile(join(dir, "sub.json")), /regular file/);
    assert.throws(() => readDeskFile(join(dir, "missing.json")));
    assert.throws(() => readDeskFile(""), /invalid/);
    assert.equal(deskFileReadable(join(dir, "real.json")), true);
    assert.equal(deskFileReadable(join(dir, "link.json")), false);
  });

  it("checks the state folder without creating or repairing it", () => {
    assert.equal(deskStateDirIsSafe(), false, "missing folder is not safe");
    assert.throws(() => readDeskFile(deskStateFile("app-admins.json")), /safety check/);
    assert.throws(() => lstatSync(deskStateDir()), /ENOENT/, "reader must not create the folder");

    mkdirSync(deskStateDir(), { mode: 0o700 });
    chmodSync(deskStateDir(), 0o777);
    writeFileSync(deskStateFile("app-admins.json"), '{"rows":[]}', { mode: 0o600 });
    assert.equal(deskStateDirIsSafe(), false, "0777 folder is not safe");
    assert.throws(() => readDeskFile(deskStateFile("app-admins.json")), /safety check/);
    assert.equal(lstatSync(deskStateDir()).mode & 0o777, 0o777, "reader must not chmod the folder");

    assert.throws(() => ensureDeskStateDir(), /wrong mode/, "writer must not repair an open folder");
    assert.throws(() => writeDeskFile(deskStateFile("app-admins.json"), '{"rows":[1]}'), /wrong mode/);
    assert.equal(lstatSync(deskStateDir()).mode & 0o777, 0o777, "writer must not chmod an open folder");

    chmodSync(deskStateDir(), 0o700);
    assert.equal(deskStateDirIsSafe(), true);
    assert.equal(readDeskFile(deskStateFile("app-admins.json")), '{"rows":[]}');
  });

  it("refuses a state folder that is a symlink to a private folder", () => {
    const real = mkdtempSync(join(tmpdir(), "desk-real-state-"));
    scratch.push(real);
    chmodSync(real, 0o700);
    writeFileSync(join(real, "agent-gate.json"), "{}", { mode: 0o600 });
    symlinkSync(real, deskStateDir());
    assert.equal(deskStateDirIsSafe(), false);
    assert.throws(() => readDeskFile(deskStateFile("agent-gate.json")), /safety check/);
    assert.equal(lstatSync(deskStateDir()).isSymbolicLink(), true);
  });
});

describe("planted temp files do not override desk state", () => {
  const child = fileURLToPath(new URL("./desk-store-hostile-child.ts", import.meta.url));

  function runChild(scenario: string, durable: boolean) {
    // Each run gets its own private temp folder, never the shared system temp folder.
    const tmp = mkdtempSync(join(tmpdir(), `desk-hostile-${scenario}-`));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      DESK_HOSTILE_SCENARIO: scenario,
      DESK_HOSTILE_CHILD_TMP: tmp,
      TMPDIR: tmp,
    };
    delete env.DESK_TEST_DATA_DIR;
    // Run as production does: without the node test-runner flag, test-only fixed temp paths stay off.
    delete env.NODE_TEST_CONTEXT;
    delete env[dataDirSetting];
    if (durable) env[dataDirSetting] = join(tmp, "durable");
    try {
      const res = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", child], {
        encoding: "utf8",
        timeout: 60_000,
        env,
      });
      if (res.status !== 0) {
        assert.fail(res.stderr || res.stdout || `hostile child (${scenario}) exited ${res.status}`);
      }
      assert.ok(res.stdout.includes(`HOSTILE_TEST_OK ${scenario}\n`), `hostile child (${scenario}) did not report OK`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  it("a planted or symlinked file in the temp folder does not override durable admin, agent, or panel-lock state", () => {
    runChild("durable", true);
  });

  it("a symlinked state folder is ignored by the app-admin, agent-gate and panel-lock loaders", () => {
    runChild("symlink-dir", false);
  });

  it("a 0777 state folder is ignored by the app-admin, agent-gate and panel-lock loaders", () => {
    runChild("open-dir", false);
  });

  it("symlinked files inside the state folder are ignored by the app-admin, agent-gate and panel-lock loaders", () => {
    runChild("symlink-file", false);
  });

  it("control: the same rows in a safe state folder are read, so the checks above are meaningful", () => {
    runChild("control", false);
  });
});
