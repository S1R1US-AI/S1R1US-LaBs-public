import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dataDirSetting,
  dataPath,
  dataPaths,
  deskDataDir,
  deskDataFile,
  deskDataPath,
  deskStoreFiles,
  deskStorePaths,
  parentDir,
  requireDataFile,
  testDataDir,
} from "./data-path.ts";

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  DESK_TEST_DATA_DIR: process.env.DESK_TEST_DATA_DIR,
};
const fakeData = "/srv/fake-desk-data";
const SHARED = ["/tmp/board-wager.json", `${fakeData}/board-wager.json`];

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
      assert.deepEqual(deskStoreFiles("board-wager.json"), ["/tmp/board-wager.json"]);
      assert.throws(() => requireDataFile(deskDataFile("gm-live.json")), /data folder is not set/);
    }
  });

  it("uses the folder from the setting when it is set", () => {
    process.env[dataDirSetting] = `${fakeData}/`;
    assert.equal(deskDataDir(), fakeData);
    assert.equal(deskDataFile("gm-live.json"), `${fakeData}/gm-live.json`);
    assert.deepEqual(deskStoreFiles("board-wager.json"), SHARED);
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
