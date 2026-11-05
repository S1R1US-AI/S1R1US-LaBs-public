import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  currentRoundMeta,
  placeWager,
  seedSpiceSim,
  serverStake,
  settleOpenRounds,
  spiceOdds,
  wagerThrottle,
  pickThrottleSettingNames,
  wagerMaxSetting,
  wagerMaxUsd,
  wagerMaxWithinSanity,
  wagerPicksOn,
  wagerPublic,
  WAGER_MIN_USD,
  WAGER_REFUSAL_REASONS,
  WAGER_REFUSED,
} from "./board-wager.ts";

const WAGER_MAX_USD = wagerMaxUsd() ?? 0;

describe("board-wager", () => {
  it("reads the per-pick max from env on every call and fails closed when it is unset", () => {
    assert.ok((wagerMaxUsd() ?? 0) >= WAGER_MIN_USD, "test preload sets a fake per-pick max");
    const saved = process.env[wagerMaxSetting];
    try {
      for (const bad of [undefined, "", "abc", "0", "1000.5", "-1", "1e3", "0x10", "+5"]) {
        if (bad === undefined) delete process.env[wagerMaxSetting];
        else process.env[wagerMaxSetting] = bad;
        assert.equal(wagerMaxUsd(), null, `unset or invalid: ${String(bad)}`);
        assert.equal(wagerPicksOn(), false);
        assert.equal(serverStake(1, WAGER_MIN_USD), null);
        assert.equal(serverStake(undefined, WAGER_MIN_USD, "max"), null);
        const r = placeWager({ fromId: "ag_off_a", fromName: "OFF-A", pickId: "ag_off_b", pickName: "OFF-B", stakeUsd: 1, px: 80_000 });
        assert.equal(r.ok, false);
        assert.equal(r.ok ? "" : r.error, WAGER_REFUSED);
      }
    } finally {
      if (saved !== undefined) process.env[wagerMaxSetting] = saved;
      else delete process.env[wagerMaxSetting];
    }
    assert.ok(wagerPicksOn(), "picks reopen once the setting is back");
  });

  it("has no built-in pick-check list values: picks stay off until both settings are set", () => {
    const names = [pickThrottleSettingNames.maxEntries, pickThrottleSettingNames.pruneGapMs];
    const saved = names.map((k) => process.env[k]);
    try {
      for (const name of names) {
        for (const bad of [undefined, "", "abc", "-1", "1.5"]) {
          names.forEach((k, i) => {
            if (saved[i] !== undefined) process.env[k] = saved[i];
          });
          if (bad === undefined) delete process.env[name];
          else process.env[name] = bad;
          assert.equal(wagerPicksOn(), false, `${name} unset or invalid: ${String(bad)}`);
          assert.equal(wagerThrottle({ agentId: "ag_off_t", ip: "192.0.2.77" }), null);
          const r = placeWager({ fromId: "ag_off_t", fromName: "OFF-T", pickId: "ag_off_u", pickName: "OFF-U", stakeUsd: 1, px: 80_000 });
          assert.equal(r.ok ? "" : r.error, WAGER_REFUSED);
        }
      }
    } finally {
      names.forEach((k, i) => {
        if (saved[i] !== undefined) process.env[k] = saved[i];
        else delete process.env[k];
      });
    }
    assert.ok(wagerPicksOn(), "picks reopen once both settings are back");
  });

  it("fails closed on every bad max setting: board says PAUSED and one warning names only the setting", () => {
    const saved = process.env[wagerMaxSetting];
    const warn = console.warn;
    const warned: string[] = [];
    console.warn = (...a: unknown[]) => void warned.push(a.map(String).join(" "));
    try {
      const bads = [undefined, "", "  ", "abc", "-5", "0", "0.5", "1e3", "12.345", "[CAP]", "Infinity", "NaN", "99999999999999999999"];
      for (const bad of bads) {
        if (bad === undefined) delete process.env[wagerMaxSetting];
        else process.env[wagerMaxSetting] = bad;
        assert.equal(wagerMaxUsd(), null, `no default for ${JSON.stringify(bad)}`);
        assert.equal(serverStake(undefined, WAGER_MIN_USD, "max"), null);
        const pub = wagerPublic(79_700);
        assert.equal(pub.live, false);
        assert.equal(pub.status, "PAUSED", "the board reports PAUSED while the max is not valid");
        assert.equal(pub.picksOn, false);
        if (saved !== undefined) process.env[wagerMaxSetting] = saved;
        assert.ok(wagerMaxUsd() !== null);
      }
      assert.equal(warned.length, bads.length, "one warning per missing spell");
      for (const w of warned) {
        assert.ok(w.includes(wagerMaxSetting));
        assert.equal(/\d/.test(w.replace(wagerMaxSetting, "")), false, "the warning carries no amount");
      }
      delete process.env[wagerMaxSetting];
      warned.length = 0;
      wagerMaxUsd();
      wagerMaxUsd();
      serverStake(5, WAGER_MIN_USD);
      assert.equal(warned.length, 1, "logged once while the setting stays missing");
    } finally {
      console.warn = warn;
      if (saved !== undefined) process.env[wagerMaxSetting] = saved;
      else delete process.env[wagerMaxSetting];
    }
    assert.equal(wagerPublic(79_700).picksOn, true);
  });

  it("gives two picks placed in the same millisecond different ids", () => {
    const realNow = Date.now;
    const t = realNow();
    Date.now = () => t;
    try {
      const sfx = t.toString(36);
      const a = placeWager({ fromId: `ag_qa_id_a_${sfx}`, fromName: "QA-ID-A", pickId: "ag_qa_id_p", pickName: "QA-ID-P", asset: "USDC", stakeUsd: 5, px: 79_700 });
      const b = placeWager({ fromId: `ag_qa_id_b_${sfx}`, fromName: "QA-ID-B", pickId: "ag_qa_id_p", pickName: "QA-ID-P", asset: "USDC", stakeUsd: 5, px: 79_700 });
      assert.ok(a.ok && b.ok);
      if (a.ok && b.ok) assert.notEqual(a.bet.id, b.bet.id);
    } finally {
      Date.now = realNow;
    }
  });

  it("uses four 6-hour ET rounds", () => {
    const m = currentRoundMeta();
    assert.equal(m.roundsPerDay, 4);
    assert.ok([0, 6, 12, 18].includes(m.slot));
    assert.match(m.id, /^\d{4}-\d{2}-\d{2}-R(00|06|12|18)$/);
  });

  it("lowers an over-max stake to WAGER_MAX_USD and rejects HOUSE", () => {
    const house = placeWager({
      fromId: "ag_x",
      fromName: "X",
      house: true,
      pickId: "ag_y",
      pickName: "Y",
      stakeUsd: 50,
      px: 80_000,
    });
    assert.equal(house.ok, false);
    const over = placeWager({
      fromId: "ag_x",
      fromName: "X",
      pickId: "ag_y",
      pickName: "Y",
      stakeUsd: WAGER_MAX_USD + 1,
      px: 80_000,
    });
    assert.equal(over.ok, true);
    assert.doesNotMatch(JSON.stringify(over), new RegExp(`(^|[^0-9.])${WAGER_MAX_USD}([^0-9]|$)`));
    const under = placeWager({
      fromId: "ag_x_under",
      fromName: "X",
      pickId: "ag_y",
      pickName: "Y",
      stakeUsd: WAGER_MIN_USD - 0.5,
      px: 80_000,
    });
    assert.equal(under.ok, false);
    assert.equal(under.ok ? "" : under.error, WAGER_REFUSED);
    assert.equal(house.ok ? "" : house.error, WAGER_REFUSED);
  });

  it("refuses a missing stake, applies stakeMode max on the server, and keeps the round meta free of the max", () => {
    assert.equal(serverStake(undefined, WAGER_MIN_USD), null);
    assert.equal(serverStake("", WAGER_MIN_USD), null);
    assert.equal(serverStake(undefined, WAGER_MIN_USD, "max"), WAGER_MAX_USD);
    assert.equal(serverStake(undefined, WAGER_MIN_USD, "MAX"), null);
    assert.equal(serverStake(WAGER_MAX_USD + 1, WAGER_MIN_USD), WAGER_MAX_USD);
    assert.equal(serverStake(1e12, WAGER_MIN_USD), WAGER_MAX_USD);
    assert.equal(serverStake(String(WAGER_MAX_USD + 0.5), WAGER_MIN_USD), WAGER_MAX_USD);
    assert.equal(serverStake(Infinity, WAGER_MIN_USD), null);
    assert.equal(serverStake("abc", WAGER_MIN_USD), null);
    assert.equal(serverStake(WAGER_MIN_USD - 0.5, WAGER_MIN_USD), null);
    assert.equal(serverStake(WAGER_MAX_USD, WAGER_MIN_USD), WAGER_MAX_USD);
    assert.equal(serverStake(WAGER_MIN_USD, WAGER_MIN_USD), WAGER_MIN_USD);
    const meta = currentRoundMeta() as Record<string, unknown>;
    assert.ok(!Object.keys(meta).some((k) => /max|limit|cap/i.test(k)));
  });

  it("accepts a max USDC paper pick and a BTC notional pick on a later agent", () => {
    const suffix = Date.now().toString(36);
    const a = placeWager({
      fromId: `ag_qa_w1_${suffix}`,
      fromName: "QA-W1",
      pickId: "ag_house_gpttape26",
      pickName: "GPT-TAPE-26",
      asset: "USDC",
      stakeUsd: WAGER_MAX_USD,
      px: 79_700,
    });
    assert.equal(a.ok, true);
    if (a.ok) {
      assert.equal(a.escrow, false);
      assert.equal(a.paper, true);
      assert.ok(!("stakeUsd" in a.bet), "reply does not show the stake");
    }
    const b = placeWager({
      fromId: `ag_qa_w2_${suffix}`,
      fromName: "QA-W2",
      pickId: "ag_house_gpttape26",
      pickName: "GPT-TAPE-26",
      asset: "BTC",
      stakeUsd: WAGER_MAX_USD,
      px: 79_700,
    });
    assert.equal(b.ok, true);
    if (b.ok) assert.ok(!("btcAtBet" in b.bet) && !("sleeveUsd" in b), "reply shows no stake-derived amount");
  });

  it("plants an as-live paper tape with odds and never escrows", () => {
    const field = [
      { id: "ag_house_gpttape26", name: "GPT-TAPE-26" },
      { id: "ag_house_slowcapital44", name: "SLOW-CAPITAL-44" },
      { id: "ag_system_s1r1us", name: "S1R1US 7-B0T" },
    ];
    const s = seedSpiceSim(field, 80_000);
    const meta = currentRoundMeta();
    const open = s.bets.filter((b) => b.roundId === meta.id && !b.settled && b.demo);
    assert.ok(open.length >= 6, `expected sim tickets, got ${open.length}`);
    const odds = spiceOdds(open);
    assert.ok(odds.length >= 1);
    assert.equal(
      odds.reduce((n, o) => n + o.pct, 0) >= 90,
      true,
    );
  });

  it("keeps the approved refusal reasons server-side, word for word", () => {
    assert.equal(WAGER_REFUSAL_REASONS.sleeve, "Paper wager sleeve is below the stake.");
    assert.equal(WAGER_REFUSAL_REASONS.range, "Stake is outside the allowed paper pick range.");
    assert.ok(!Object.values(WAGER_REFUSAL_REASONS).includes(WAGER_REFUSED as never));
  });

  it("counts odds by tickets: same output for any stake sizes", () => {
    const tickets = [
      { pickId: "a", pickName: "A" },
      { pickId: "b", pickName: "B" },
      { pickId: "b", pickName: "B" },
      { pickId: "c", pickName: "C" },
    ];
    const small = spiceOdds(tickets.map((x) => ({ ...x, stakeUsd: 1 })));
    const big = spiceOdds(tickets.map((x, i) => ({ ...x, stakeUsd: i === 0 ? WAGER_MAX_USD : 1 })));
    assert.deepEqual(small, big);
    assert.deepEqual(
      small.map((o) => [o.pickId, o.bets, o.pct]),
      [
        ["b", 2, 50],
        ["a", 1, 25],
        ["c", 1, 25],
      ],
    );
    assert.ok(small.every((o) => !("stakeUsd" in o)));
  });

  it("slows repeated pick calls", () => {
    const now = 1_000_000;
    const who = { agentId: `slow-${Date.now().toString(36)}`, ip: "198.51.100.7" };
    let slow: string | null = null;
    let n = 0;
    for (; n < 60 && !slow; n++) slow = wagerThrottle(who, now + n);
    assert.ok(slow, "repeat calls are slowed");
    assert.ok(n > 1, "first call passes");
    assert.equal(wagerThrottle(who, now + 24 * 60 * 60_000 + 1), null, "window resets");
  });

  it("counts v6 callers by network prefix", () => {
    const now = 5_000_000_000;
    const tag = Date.now().toString(36);
    let slow: string | null = null;
    let n = 0;
    for (; n < 60 && !slow; n++) slow = wagerThrottle({ agentId: `v6-${tag}-${n}`, ip: `2001:db8:77:${n % 2 ? "0" : ""}1::${(n + 1).toString(16)}` }, now);
    assert.ok(slow, "one network prefix is counted once");
    assert.equal(wagerThrottle({ agentId: `v6-${tag}-other`, ip: "2001:db8:77:2::1" }, now), null, "another network still passes");
    assert.equal(wagerThrottle({ agentId: `v6-${tag}-mapped`, ip: "::ffff:203.0.113.9" }, now), null, "a mapped v4 address passes");
  });

  it("keeps both lists at a fixed size and refuses new agents only when the agent list is full", () => {
    const saved = { size: process.env[pickThrottleSettingNames.maxEntries], gap: process.env[pickThrottleSettingNames.pruneGapMs] };
    process.env[pickThrottleSettingNames.maxEntries] = "10";
    process.env[pickThrottleSettingNames.pruneGapMs] = "0";
    try {
      const tag = Date.now().toString(36);
      // Two agents fill the address list.
      const t1 = 20_000_000_000;
      for (let i = 0; i < 10; i++) {
        assert.equal(wagerThrottle({ agentId: `fa-${tag}-${i % 2}`, ip: `192.0.2.${i + 1}` }, t1), null);
      }
      assert.equal(wagerThrottle({ agentId: `fa-${tag}-new`, ip: "192.0.2.200" }, t1), null, "a new agent on a new address still passes");
      // Many agents fill the agent list.
      const t2 = 40_000_000_000;
      let first: string | null = null;
      let i = 0;
      for (; i < 30 && !first; i++) first = wagerThrottle({ agentId: `ag-${tag}-${i}`, ip: `198.51.100.${i + 1}` }, t2);
      assert.ok(first, "a full agent list refuses a new agent");
      assert.ok(i <= 11, "agent list stays at its size");
      assert.equal(wagerThrottle({ agentId: `ag-${tag}-late`, ip: "198.51.100.250" }, t2 + 1), first, "same plain text");
      assert.equal(wagerThrottle({ agentId: `ag-${tag}-0`, ip: "198.51.100.1" }, t2 + 2), null, "a known agent still passes");
      assert.equal(wagerThrottle({ agentId: `ag-${tag}-later`, ip: "198.51.100.251" }, t2 + 24 * 60 * 60_000 + 1), null, "stale entries are pruned");
    } finally {
      for (const [k, v] of [[pickThrottleSettingNames.maxEntries, saved.size], [pickThrottleSettingNames.pruneGapMs, saved.gap]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("fails closed above a generic sanity ceiling on the limit setting (not derived from the real limit)", () => {
    const saved = process.env[wagerMaxSetting];
    const warn = console.warn;
    console.warn = () => {};
    try {
      for (const huge of ["1".repeat(20), "9".repeat(17), "9".repeat(16), String(Number.MAX_SAFE_INTEGER)]) {
        process.env[wagerMaxSetting] = huge;
        assert.equal(wagerMaxUsd(), null, `${huge.length}-digit setting is refused`);
        assert.equal(wagerPicksOn(), false);
        assert.equal(serverStake(undefined, WAGER_MIN_USD, "max"), null);
      }
      assert.equal(wagerMaxWithinSanity(Number.MAX_SAFE_INTEGER), false);
      assert.equal(wagerMaxWithinSanity(Number.POSITIVE_INFINITY), false);
      assert.equal(wagerMaxWithinSanity(Number.NaN), false);
      process.env[wagerMaxSetting] = "1234567";
      assert.equal(wagerMaxUsd(), 1234567, "large but sane settings are kept");
    } finally {
      console.warn = warn;
      if (saved !== undefined) process.env[wagerMaxSetting] = saved;
      else delete process.env[wagerMaxSetting];
    }
    assert.ok(wagerPicksOn(), "picks reopen once the setting is back");
  });

  it("holds open simulated tickets to the limit when it drops and at settle, and plants none without one", () => {
    const field = [
      { id: "ag_house_gpttape26", name: "GPT-TAPE-26" },
      { id: "ag_house_slowcapital44", name: "SLOW-CAPITAL-44" },
      { id: "ag_system_s1r1us", name: "S1R1US 7-B0T" },
    ];
    const saved = process.env[wagerMaxSetting];
    const warn = console.warn;
    console.warn = () => {};
    /* Obviously fake test-only limits, unrelated to the deploy value. */
    const highLimit = 500;
    const lowLimit = 7;
    const start = new Date("2026-03-04T15:30:00Z").getTime();
    mock.timers.enable({ apis: ["Date"], now: start });
    try {
      const meta = currentRoundMeta();
      const demoOpen = (s: ReturnType<typeof seedSpiceSim>, id = meta.id) => s.bets.filter((b) => b.roundId === id && !b.settled && b.demo);
      process.env[wagerMaxSetting] = String(highLimit);
      const before = demoOpen(seedSpiceSim(field, 80_000));
      assert.ok(before.length >= 6);
      assert.ok(before.some((b) => b.stakeUsd > lowLimit), "fixture: default sim stakes exceed the low test limit");
      // the limit drops: tickets already on the tape are held to it
      process.env[wagerMaxSetting] = String(lowLimit);
      const held = demoOpen(seedSpiceSim(field, 80_000));
      assert.ok(held.length >= 6);
      for (const b of held) {
        assert.ok(b.stakeUsd <= lowLimit, `sim stake ${b.stakeUsd} is within the limit`);
        if (b.asset === "BTC") assert.equal(b.btcAtBet, Math.round((b.stakeUsd / 80_000) * 1e8) / 1e8);
      }
      // next round: tickets planted under the higher limit, then the limit drops before settle
      mock.timers.tick(6 * 3600_000);
      const round2Meta = currentRoundMeta();
      assert.notEqual(round2Meta.id, meta.id);
      process.env[wagerMaxSetting] = String(highLimit);
      const planted = demoOpen(seedSpiceSim(field, 80_000), round2Meta.id);
      assert.ok(planted.some((b) => b.stakeUsd > lowLimit), "fixture: fresh sim stakes exceed the low test limit");
      const ids = new Set(planted.map((b) => b.id));
      process.env[wagerMaxSetting] = String(lowLimit);
      mock.timers.tick(6 * 3600_000);
      const settled = settleOpenRounds(null).bets.filter((b) => ids.has(b.id));
      assert.ok(settled.length >= 1);
      for (const b of settled) {
        assert.equal(b.settled, true);
        assert.ok(b.stakeUsd <= lowLimit, `settled sim stake ${b.stakeUsd} is within the limit`);
      }
      // no valid limit: nothing new is planted
      delete process.env[wagerMaxSetting];
      const next = currentRoundMeta();
      assert.equal(demoOpen(seedSpiceSim(field, 80_000), next.id).length, 0, "no simulated tickets planted while PAUSED");
    } finally {
      mock.timers.reset();
      console.warn = warn;
      if (saved !== undefined) process.env[wagerMaxSetting] = saved;
      else delete process.env[wagerMaxSetting];
    }
  });
});
