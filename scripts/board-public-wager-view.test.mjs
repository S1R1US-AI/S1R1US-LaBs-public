// The per-pick paper max lives on the server only. No public view, reply or player view may show it,
// show a value it can be worked out from, or answer differently depending on why a pick was refused.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_MAX = 977;
const START = 1000;
// Values that give the max back: the max itself and the sleeve left after a max pick.
const DERIVED = [TEST_MAX, START - TEST_MAX];

function runChild(body) {
  const dir = mkdtempSync(join(tmpdir(), "s1r1us-board-view-"));
  const loader = new URL("./lib/ts-src-loader.mjs", import.meta.url).href;
  const desk = (p) => JSON.stringify(new URL(`../src/lib/desk/${p}`, import.meta.url).href);
  const code = [
    `import { register } from "node:module";`,
    `register(${JSON.stringify(loader)});`,
    `const board = await import(${desk("gm-board.ts")});`,
    `const wager = await import(${desk("board-wager.ts")});`,
    `const callout = await import(${desk("board-callout.ts")});`,
    `const fs = await import("node:fs");`,
    `const { dataPaths } = await import(${desk("data-path.ts")});`,
    body,
  ].join("\n");
  try {
    return JSON.parse(
      execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code], {
        env: {
          ...process.env,
          NODE_ENV: "test",
          DESK_TEST_DATA_DIR: dir,
          TMPDIR: dir,
          S1R1US_WAGER_MAX_USD: String(TEST_MAX),
          S1R1US_PICK_THROTTLE_ENTRIES: "5000",
          S1R1US_PICK_THROTTLE_PRUNE_GAP_MS: "1000",
          S1R1US_WAGER_MAX_TRIES: "5",
        },
        encoding: "utf8",
        timeout: 60_000,
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function keysOf(v, out = []) {
  if (Array.isArray(v)) for (const x of v) keysOf(x, out);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  }
  return out;
}

// Ordinals and tallies that are not money (a rank or a count can be any small number).
const NOT_MONEY = new Set(["rank", "count", "topN", "fills", "bets", "pct", "roundsPerDay", "slot", "round", "rounds"]);

function moneyNumbers(v, key = "", out = []) {
  if (Array.isArray(v)) for (const x of v) moneyNumbers(x, key, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) moneyNumbers(x, k, out);
  else if (typeof v === "number" && !NOT_MONEY.has(key)) out.push(v);
  return out;
}

function assertNoStakeValues(name, part) {
  const keys = keysOf(part).filter((k) => /max|limit|cap|stake|pool|sleeve|payout|btcAtBet/i.test(k));
  assert.deepEqual(keys, [], `${name} has no max, stake, pool or sleeve field`);
  assert.doesNotMatch(JSON.stringify(part), new RegExp(`(^|[^0-9.])${TEST_MAX}([^0-9]|$)`), `${name} does not contain the max`);
  const nums = moneyNumbers(part);
  for (const v of DERIVED) assert.ok(!nums.includes(v), `${name} has no amount equal to ${v}`);
}

const SETUP = `
const purpose = "Accumulate bitcoin on GM MANUAL paper. Never sell. Never short.";
const reg = (name, ip) => board.registerBoard({ name, mandate: true, ip, purpose });
const out = {};
`;

describe("public board wager view", () => {
  it("has no max field before any pick", () => {
    const { view } = runChild(`process.stdout.write(JSON.stringify({ view: board.boardPublic(80000) }));`);
    assert.ok(view.wager, "board serves a wager view");
    assert.equal(view.wager.picksOn, true, "picks are on when the env value is set");
    assertNoStakeValues("board", view);
  });

  it("refuses no-stake picks, takes stakeMode max, and never shows the stake, pool or sleeve", () => {
    const out = runChild(`${SETUP}
const a = reg("VIEW-A", "10.0.0.1");
const b = reg("VIEW-B", "10.0.0.2");
const c = reg("VIEW-C", "10.0.0.3");
const pickId = b.you?.id ?? b.agent?.id ?? b.id;
out.reg = [a.ok, b.ok, c.ok];
out.noStakeKing = board.placeBoardWager({ token: a.token, pickId: "VIEW-B", ip: "10.0.0.1", px: 80000 });
out.noStakeBtc = board.placeBoardWager({ token: a.token, pickId: "VIEW-B", asset: "BTC", ip: "10.0.0.1", px: 80000 });
out.king = board.placeBoardWager({ token: a.token, pickId: "VIEW-B", stakeMode: "max", ip: "10.0.0.1", px: 80000 });
out.btcKing = board.placeBoardWager({ token: c.token, pickId: "VIEW-B", asset: "BTC", stakeMode: "max", ip: "10.0.0.3", px: 80000 });
const from = { id: "ag_view_c", name: "VIEW-FC", purpose };
const target = { id: "ag_view_d", name: "VIEW-FD", purpose };
out.started = callout.issueCallout({ from, target }).ok;
out.noStakeFight = callout.placeFightWager({ fromId: "ag_view_e", fromName: "VIEW-E", pickId: from.id, pickName: from.name });
out.fight = callout.placeFightWager({ fromId: "ag_view_e", fromName: "VIEW-E", pickId: from.id, pickName: from.name, stakeMode: "max" });
out.me = board.boardMe(a.token, 80000);
out.board = board.boardPublic(80000);
out.pickId = pickId;
process.stdout.write(JSON.stringify(out));
`);
    assert.deepEqual(out.reg, [true, true, true], "agents registered");
    for (const k of ["noStakeKing", "noStakeBtc", "noStakeFight"]) {
      assert.equal(out[k].ok, false, `${k} refused`);
    }
    assert.equal(out.king.ok, true, "max king pick placed");
    assert.equal(out.btcKing.ok, true, "max BTC king pick placed");
    assert.equal(out.started, true, "fight started");
    assert.equal(out.fight.ok, true, "max fight pick placed");
    assert.equal(out.me.ok, true, "boardMe answers");
    assert.ok(out.board.wager.open.length >= 2, "king picks are listed");
    assert.ok(out.board.callout.fightWager.open.length >= 1, "fight pick is listed");
    for (const k of ["king", "btcKing", "fight", "me", "board"]) assertNoStakeValues(k, out[k]);
  });

  it("gives every refusal the same reply, with the range check after the pick checks", () => {
    const out = runChild(`${SETUP}
const a = reg("REF-A", "10.0.1.1");
const b = reg("REF-B", "10.0.1.2");
const d = reg("REF-D", "10.0.1.4");
const tries = {};
tries.house = wager.placeWager({ fromId: "x", fromName: "X", house: true, pickId: "y", pickName: "Y", stakeUsd: 1, px: 80000 });
tries.badPick = board.placeBoardWager({ token: a.token, pickId: "NOBODY-HERE", stakeUsd: 1, ip: "10.0.1.1", px: 80000 });
tries.btcNoPrice = wager.placeWager({ fromId: "ref_p", fromName: "P", pickId: "y", pickName: "Y", asset: "BTC", stakeUsd: 1, px: 0 });
tries.rangeLow = board.placeBoardWager({ token: d.token, pickId: "REF-B", stakeUsd: 0, ip: "10.0.1.4", px: 80000 });
const first = board.placeBoardWager({ token: a.token, pickId: "REF-B", stakeUsd: 5, ip: "10.0.1.1", px: 80000 });
// After one real pick, in-range and out-of-range asks must look the same (no range oracle).
tries.onceInRange = board.placeBoardWager({ token: a.token, pickId: "REF-B", stakeUsd: 5, ip: "10.0.1.1", px: 80000 });
tries.onceOutOfRange = board.placeBoardWager({ token: a.token, pickId: "REF-B", stakeUsd: ${TEST_MAX + 1}, ip: "10.0.1.1", px: 80000 });
// Sleeve: empty one player's paper sleeve on disk, then ask for an in-range pick.
const path = dataPaths(["/tmp/board-wager.json"])[0];
const store = JSON.parse(fs.readFileSync(path, "utf8"));
store.sleeves["ag_ref_sleeve"] = { cashUsd: 0 };
fs.writeFileSync(path, JSON.stringify(store));
tries.sleeve = wager.placeWager({ fromId: "ag_ref_sleeve", fromName: "S", pickId: "y", pickName: "Y", stakeUsd: 1, px: 80000 });
tries.fightNone = callout.placeFightWager({ fromId: "fz", fromName: "FZ", pickId: "nobody", pickName: "N", stakeUsd: 1 });
const from = { id: "ag_ref_c", name: "REF-FC", purpose };
const target = { id: "ag_ref_d", name: "REF-FD", purpose };
callout.issueCallout({ from, target });
tries.fightBadPick = callout.placeFightWager({ fromId: "fz", fromName: "FZ", pickId: "nobody", pickName: "N", stakeUsd: 1 });
callout.placeFightWager({ fromId: "fy", fromName: "FY", pickId: from.id, pickName: from.name, stakeUsd: 1 });
tries.fightOnceOutOfRange = callout.placeFightWager({ fromId: "fy", fromName: "FY", pickId: from.id, pickName: from.name, stakeUsd: ${TEST_MAX + 1} });
process.stdout.write(JSON.stringify({ first: first.ok, b: b.ok, tries, reasons: wager.wagerAdmin().refusals }));
`);
    assert.equal(out.first, true, "first pick placed");
    const replies = Object.entries(out.tries);
    assert.ok(replies.length >= 10);
    const bodies = new Set(replies.map(([, r]) => JSON.stringify(r)));
    assert.equal(bodies.size, 1, `every refusal is byte-identical: ${[...bodies].join(" | ")}`);
    const [only] = bodies;
    assert.deepEqual(JSON.parse(only), { ok: false, error: "Pick not accepted. Check the rules posted on the board." });
    // The reason is kept server-side: the once-checks were counted as "once", not "range".
    assert.ok((out.reasons.once ?? 0) >= 3, "one-pick refusals counted before the range check");
    assert.ok((out.reasons.sleeve ?? 0) >= 1, "sleeve refusal counted server-side");
  });

  it("quietly lowers an over-max pick to the max, with the same reply as any other pick", () => {
    const out = runChild(`${SETUP}
const a = reg("OVER-A", "10.0.3.1");
const b = reg("OVER-B", "10.0.3.2");
const c = reg("OVER-C", "10.0.3.3");
out.reg = [a.ok, b.ok, c.ok];
out.over = board.placeBoardWager({ token: a.token, pickId: "OVER-B", stakeUsd: ${TEST_MAX + 1}, ip: "10.0.3.1", px: 80000 });
out.huge = board.placeBoardWager({ token: c.token, pickId: "OVER-B", stakeUsd: 1e12, ip: "10.0.3.3", px: 80000 });
const path = dataPaths(["/tmp/board-wager.json"])[0];
out.stakes = JSON.parse(fs.readFileSync(path, "utf8")).bets.map((x) => x.stakeUsd);
const from = { id: "ag_over_c", name: "OVER-FC", purpose };
const target = { id: "ag_over_d", name: "OVER-FD", purpose };
callout.issueCallout({ from, target });
out.fightOver = callout.placeFightWager({ fromId: "ag_over_e", fromName: "OVER-E", pickId: from.id, pickName: from.name, stakeUsd: ${TEST_MAX + 1} });
out.board = board.boardPublic(80000);
process.stdout.write(JSON.stringify(out));
`);
    assert.deepEqual(out.reg, [true, true, true], "agents registered");
    for (const k of ["over", "huge", "fightOver"]) {
      assert.equal(out[k].ok, true, `${k} pick placed`);
      assertNoStakeValues(k, out[k]);
    }
    assertNoStakeValues("board", out.board);
    // Server side only: both board picks were lowered to the max.
    assert.deepEqual(out.stakes, [TEST_MAX, TEST_MAX]);
  });

  it("rate-limits pick calls per agent and per IP", () => {
    const out = runChild(`${SETUP}
const a = reg("RATE-A", "10.0.2.1");
const r = [];
for (let i = 0; i < 8; i++) r.push(board.placeBoardWager({ token: a.token, pickId: "RATE-A", stakeUsd: 0, ip: "10.0.2.1", px: 80000 }));
const b = reg("RATE-B", "10.0.2.2");
const sameIp = board.placeBoardWager({ token: b.token, pickId: "RATE-A", stakeUsd: 0, ip: "10.0.2.1", px: 80000 });
process.stdout.write(JSON.stringify({ r, sameIp }));
`);
    const limited = out.r.filter((x) => x.rateLimited);
    assert.equal(out.r.slice(0, 5).filter((x) => x.rateLimited).length, 0, "first calls pass the throttle");
    assert.ok(limited.length >= 1, "throttle triggers for the agent");
    assert.equal(out.sameIp.rateLimited, true, "throttle triggers for the IP");
  });
});
