/**
 * Child process for the planted-temp-file tests. Not part of the default test
 * list: the parent spawns it once per scenario with NODE_ENV=production, no
 * test redirect, and TMPDIR set to a fresh private folder, so module-level store
 * path lists are computed the way production does and nothing touches the
 * shared system temp folder.
 *
 * Scenarios (DESK_HOSTILE_SCENARIO):
 * - durable:      durable folder set; planted copies in the temp folder are ignored and
 *                 writes do not follow a planted symlink.
 * - symlink-dir:  no durable folder; the state folder is a symlink to a folder of planted files.
 * - open-dir:     no durable folder; the state folder is pre-made with mode 0777 and planted files.
 * - symlink-file: no durable folder; a real 0700 state folder whose store files are symlinks
 *                 to planted files.
 * - control:      no durable folder; a real 0700 state folder with the same rows as regular
 *                 files is read (proves the scenarios above would see planted data).
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("../../../scripts/test-ts-alias-hooks.mjs", import.meta.url));

const ADMIN = "app-admins.json";
const GATE = "agent-gate.json";
const LOCK = "lock-status.json";
const PANEL = "admin-yubi-gate.json";

const goodAdmin = {
  rows: [{ id: "good-admin", at: "2026-11-10T00:00:00.000Z", kind: "iphone", handle: "good", label: "good" }],
};
const badAdmin = {
  rows: [{ id: "hostile-admin", at: "2026-11-10T00:00:00.000Z", kind: "iphone", handle: "bad", label: "bad" }],
};
const goodGate = { externalAgents: true, closedAt: null, openedAt: "2026-11-10T00:00:00.000Z", inviteBatchAt: null, inviteCount: 0 };
const badGate = { externalAgents: false, closedAt: "2026-11-10T00:00:00.000Z", openedAt: null, inviteBatchAt: null, inviteCount: 0 };
const badLock = { mode: "LIVE", locked: {}, include: {}, at: "1999-01-01T00:00:00.000Z", by: "system" };
const goodPanel = { panelLock: false, updatedAt: "2026-11-10T00:00:00.000Z" };
const badPanel = { panelLock: true, updatedAt: "1999-01-01T00:00:00.000Z" };

const PLANTED: Record<string, unknown> = { [ADMIN]: badAdmin, [GATE]: badGate, [LOCK]: badLock, [PANEL]: badPanel };

function fail(msg: string): never {
  throw new Error(msg);
}

function plantAll(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [name, body] of Object.entries(PLANTED)) writeFileSync(join(dir, name), JSON.stringify(body));
}

async function loaders() {
  const dp = await import("./data-path.ts");
  const admin = await import("./app-admin.ts");
  const gate = await import("./agent-gate.ts");
  const lock = await import("./lock-status.server.ts");
  return { dp, admin, gate, lock };
}

type Loaded = Awaited<ReturnType<typeof loaders>>;

function panelState(dp: Loaded["dp"]): unknown {
  for (const p of dp.deskStoreFiles(PANEL)) {
    try {
      return JSON.parse(dp.readDeskFile(p));
    } catch {
      /* skipped */
    }
  }
  return null;
}

/** Every loader must ignore the planted rows. */
function expectIgnored(l: Loaded, label: string) {
  if (l.admin.peekAppAdmin("hostile-admin")) fail(`${label}: app-admin loader returned a planted row`);
  if (l.gate.isAgentCommOpen() !== true) fail(`${label}: agent-gate loader returned planted closed state`);
  const store = l.lock.peekLockStore();
  if (store.mode !== "SIM" || store.by === "system") fail(`${label}: panel-lock loader returned planted state`);
  const panel = panelState(l.dp) as { panelLock?: boolean } | null;
  if (panel?.panelLock === true) fail(`${label}: hardware-key panel-lock file returned planted state`);
}

async function scenarioDurable(tmp: string) {
  const { dataDirSetting, deskStoreFiles, writeDeskFile } = await import("./data-path.ts");
  const durable = process.env[dataDirSetting];
  if (!durable || !durable.startsWith("/")) fail("durable scenario needs the durable data folder in the environment");
  mkdirSync(durable, { recursive: true, mode: 0o700 });
  for (const name of [ADMIN, GATE, PANEL]) {
    const listed = deskStoreFiles(name);
    if (listed.includes(join(tmp, name)) || listed.some((p) => p === `/tmp/${name}`)) {
      fail(`${name} still lists a shared temp copy`);
    }
    if (!listed[0]?.startsWith(`${durable}/`)) fail(`${name} does not read the durable copy first`);
  }
  writeDeskFile(join(durable, ADMIN), JSON.stringify(goodAdmin));
  writeDeskFile(join(durable, GATE), JSON.stringify(goodGate));
  writeDeskFile(join(durable, PANEL), JSON.stringify(goodPanel));
  // Old-style planted copies directly in the temp folder.
  writeFileSync(join(tmp, ADMIN), JSON.stringify(badAdmin));
  writeFileSync(join(tmp, GATE), JSON.stringify(badGate));
  const hostilePanel = join(tmp, "hostile-panel-lock.json");
  writeFileSync(hostilePanel, JSON.stringify(badPanel));
  symlinkSync(hostilePanel, join(tmp, PANEL));

  const l = await loaders();
  const admin = l.admin.peekAppAdmin("good-admin");
  if (!admin || admin.handle !== "good") fail("durable admin row was not read");
  expectIgnored(l, "durable");

  // Writing the real store must not follow the planted symlink.
  const target = l.dp.deskStoreFiles(PANEL)[0]!;
  l.dp.writeDeskFile(target, JSON.stringify(goodPanel));
  if (!readFileSync(hostilePanel, "utf8").includes("1999")) fail("panel-lock write followed a planted symlink");
  if (!existsSync(target) || lstatSync(target).isSymbolicLink()) fail("panel-lock durable copy is not a regular file");

  // A symlink at the durable target is refused.
  const refuseDir = mkdtempSync(join(tmp, "desk-refuse-"));
  const real = join(refuseDir, "real.json");
  const dest = join(refuseDir, "dest.json");
  writeFileSync(real, "keep");
  symlinkSync(real, dest);
  let threw = false;
  try {
    l.dp.writeDeskFile(dest, "nope");
  } catch {
    threw = true;
  }
  if (!threw) fail("writeDeskFile did not refuse a symlink target");
  if (readFileSync(real, "utf8") !== "keep") fail("symlink target was overwritten");
}

async function scenarioNoDurable(kind: string, tmp: string) {
  const { DESK_STATE_DIR_NAME } = await import("./data-path.ts");
  const stateDir = join(tmp, DESK_STATE_DIR_NAME);
  if (kind === "symlink-dir") {
    const attacker = join(tmp, "attacker-state");
    plantAll(attacker);
    symlinkSync(attacker, stateDir);
  } else if (kind === "open-dir") {
    plantAll(stateDir);
    chmodSync(stateDir, 0o777);
  } else if (kind === "symlink-file") {
    const attacker = join(tmp, "attacker-files");
    plantAll(attacker);
    mkdirSync(stateDir, { mode: 0o700 });
    chmodSync(stateDir, 0o700);
    for (const name of Object.keys(PLANTED)) symlinkSync(join(attacker, name), join(stateDir, name));
  } else if (kind === "control") {
    plantAll(stateDir);
    chmodSync(stateDir, 0o700);
  } else {
    fail(`unknown scenario ${kind}`);
  }

  const l = await loaders();
  if (l.dp.deskDataDir() !== null) fail("no-durable scenario ran with a durable folder");
  if (l.dp.deskStoreFiles(ADMIN)[0] !== join(stateDir, ADMIN)) fail("loader does not use the private state copy");

  if (kind === "control") {
    if (!l.admin.peekAppAdmin("hostile-admin")) fail("control: app-admin loader did not read a safe state file");
    if (l.gate.isAgentCommOpen() !== false) fail("control: agent-gate loader did not read a safe state file");
    if (l.lock.peekLockStore().mode !== "LIVE") fail("control: panel-lock loader did not read a safe state file");
    if ((panelState(l.dp) as { panelLock?: boolean } | null)?.panelLock !== true) {
      fail("control: hardware-key panel-lock file was not read");
    }
    return;
  }
  if (l.dp.deskStateDirIsSafe() && kind !== "symlink-file") fail(`${kind}: unsafe state folder passed the check`);
  expectIgnored(l, kind);
  // The read side never creates or repairs the folder.
  const st = lstatSync(stateDir);
  if (kind === "symlink-dir" && !st.isSymbolicLink()) fail("symlink-dir: reader replaced the symlink");
  if (kind === "open-dir" && (st.mode & 0o777) !== 0o777) fail("open-dir: reader changed the folder mode");
}

async function main() {
  if (process.env.NODE_ENV === "test" || process.env.DESK_TEST_DATA_DIR) {
    fail("hostile child must not run with the test redirect");
  }
  const tmp = tmpdir();
  if (tmp === "/tmp" || tmp === "/var/tmp" || !process.env.DESK_HOSTILE_CHILD_TMP || tmp !== process.env.DESK_HOSTILE_CHILD_TMP) {
    fail("hostile child must run with TMPDIR set to its own private folder");
  }
  const kind = process.env.DESK_HOSTILE_SCENARIO ?? "";
  // The parent removes the private temp folder after the child exits.
  if (kind === "durable") await scenarioDurable(tmp);
  else await scenarioNoDurable(kind, tmp);
  process.stdout.write(`HOSTILE_TEST_OK ${kind}\n`);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exit(1);
});
