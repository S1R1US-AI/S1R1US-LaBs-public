import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
import { dataPath } from "./data-path.ts";
import { wagerMaxSetting, wagerMaxUsd } from "./board-wager.ts";

const WAGER_MAX_USD = wagerMaxUsd() ?? 0;
import {
  expireFight,
  issueCallout,
  placeFightWager,
  tickCallout,
  honorCallout,
  setCalloutPref,
  GM_AUTO_ID,
  CALLOUT_ROUNDS,
  CALLOUT_ROUND_MS,
  seedDemoTape,
  fightCount,
  SYSTEM_KING_NAME,
  SYSTEM_KING_ID,
  calloutPublic,
} from "./board-callout.ts";

try {
  unlinkSync(dataPath("/tmp/board-callout-test.json"));
} catch {
  /* fresh */
}

const purpose = "Accumulate bitcoin on GM MANUAL paper. Never sell. Never short.";

describe("board-callout", { concurrency: false }, () => {
  it("rejects HOUSE, self, G M0D3 AUTO, and missing profiles", () => {
    const house = issueCallout({
      from: { id: "ag_h", name: "H", house: true, purpose },
      target: { id: "ag_t", name: "T", purpose },
    });
    assert.equal(house.ok, false);

    const noProf = issueCallout({
      from: { id: "ag_a", name: "A", purpose: "" },
      target: { id: "ag_t", name: "T", purpose },
    });
    assert.equal(noProf.ok, false);

    const self = issueCallout({
      from: { id: "ag_a", name: "A", purpose },
      target: { id: "ag_a", name: "A", purpose },
    });
    assert.equal(self.ok, false);

    const auto = issueCallout({
      from: { id: "ag_a", name: "A", purpose },
      target: { id: GM_AUTO_ID, name: "G M0D3 AUTO", purpose },
    });
    assert.equal(auto.ok, false);
  });

  it("tie goes to the agent who C@LL 0UT", () => {
    const suffix = `${Date.now().toString(36)}tie`;
    const from = { id: `ag_co_tie_a_${suffix}`, name: "CallerTie", purpose };
    const target = { id: `ag_co_tie_b_${suffix}`, name: "TargetTie", purpose };
    const started = issueCallout({ from, target });
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const bout = expireFight(started.fight.id);
    assert.equal(bout?.winnerId, from.id);
    assert.equal(bout?.tie, true);
  });

  it("starts a 5×1h bout, bans TRIM, stacks BUY, and awards most bitcoin", () => {
    const suffix = Date.now().toString(36);
    const from = { id: `ag_co_a_${suffix}`, name: "Caller", purpose };
    const target = { id: `ag_co_b_${suffix}`, name: "Target", purpose };
    const started = issueCallout({ from, target });
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(started.escrow, false);
    assert.equal(started.fight.round, 1);

    const trim = tickCallout({ id: from.id, name: from.name, action: "TRIM", px: 80_000 });
    assert.equal(trim.ok, false);

    const buy = tickCallout({ id: from.id, name: from.name, action: "BUY", px: 80_000 });
    assert.equal(buy.ok, true);
    if (buy.ok) {
      assert.equal(buy.trade, false);
      assert.ok((buy.btc ?? 0) > 0);
    }

    const bout = expireFight(started.fight.id);
    assert.ok(bout);
    assert.equal(bout?.winnerId, from.id);
    assert.equal(bout?.tie, false);
  });

  it("lowers an over-max fight SP1CE UP to WAGER_MAX_USD and rejects HOUSE", () => {
    const suffix = `${Date.now().toString(36)}b`;
    const from = { id: `ag_co_c_${suffix}`, name: "Caller2", purpose };
    const target = { id: `ag_co_d_${suffix}`, name: "Target2", purpose };
    const started = issueCallout({ from, target });
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const house = placeFightWager({
      fromId: "ag_h",
      fromName: "H",
      house: true,
      pickId: from.id,
      pickName: from.name,
      stakeUsd: 10,
    });
    assert.equal(house.ok, false);

    const over = placeFightWager({
      fromId: `ag_bet_${suffix}`,
      fromName: "Bet",
      pickId: from.id,
      pickName: from.name,
      stakeUsd: WAGER_MAX_USD + 1,
    });
    assert.equal(over.ok, true);
    assert.doesNotMatch(JSON.stringify(over), new RegExp(`(^|[^0-9.])${WAGER_MAX_USD}([^0-9]|$)`));

    const ok = placeFightWager({
      fromId: `ag_bet2_${suffix}`,
      fromName: "Bet",
      pickId: from.id,
      pickName: from.name,
      stakeUsd: WAGER_MAX_USD,
    });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.escrow, false);
  });

  it("seeds 20 demo C@LL 0UTs with system king, then drops them on a live bout", () => {
    const seeded = seedDemoTape();
    assert.equal(seeded.fights.length, 20);
    assert.ok(seeded.fights.every((f) => f.demo));
    const sys = Object.values(seeded.wins).find((w) => w.name === SYSTEM_KING_NAME);
    assert.equal(sys?.wins, 12);
    assert.equal(fightCount().demo, 20);

    const suffix = `${Date.now().toString(36)}live`;
    const from = { id: `ag_co_live_a_${suffix}`, name: "LiveCaller", purpose };
    const target = { id: `ag_co_live_b_${suffix}`, name: "LiveTarget", purpose };
    const started = issueCallout({ from, target });
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(started.fight.demo, false);
    const n = fightCount();
    assert.equal(n.demo, 0);
    assert.equal(n.total, 1);
    assert.equal(n.live, 1);
  });

  it("demo C@LL 0UTs end CALLOUT_ROUNDS rounds after they start, live or done", () => {
    const before = Date.now();
    const seeded = seedDemoTape();
    const after = Date.now();
    const span = CALLOUT_ROUNDS * CALLOUT_ROUND_MS;
    const live = seeded.fights.filter((f) => f.status === "LIVE");
    const done = seeded.fights.filter((f) => f.status === "DONE");
    assert.equal(live.length, 1);
    assert.ok(done.length > 0);
    for (const f of [...live, ...done]) {
      assert.equal(Date.parse(f.endsAt) - Date.parse(f.startedAt), span, f.id);
    }
    /* The live sample is 2 rounds in, so it ends 3 rounds from now and is still open. */
    const liveEnd = Date.parse(live[0].endsAt);
    assert.ok(liveEnd >= before + 3 * CALLOUT_ROUND_MS && liveEnd <= after + 3 * CALLOUT_ROUND_MS);
    for (const f of done) assert.ok(Date.parse(f.endsAt) <= after, f.id);
  });


  it("honors or forfeits a pending C@LL 0UT and blocks admin from owl-vs-owl", () => {
    const suffix = `${Date.now().toString(36)}hon`;
    const from = { id: `ag_co_h_a_${suffix}`, name: "HumanA", purpose, kind: "human", admin: true };
    const target = { id: `ag_co_h_b_${suffix}`, name: "GrokOwl", purpose, kind: "grok" };
    setCalloutPref({ id: target.id, mode: "manual" });
    const started = issueCallout({ from, target });
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(started.fight.status, "PENDING");
    assert.equal(started.lane, "admin-vs-agent");

    const declined = honorCallout({ id: target.id, accept: false });
    assert.equal(declined.ok, true);
    if (declined.ok) {
      assert.equal(declined.fight.status, "FORFEIT");
      assert.equal(declined.fight.winnerId, from.id);
      assert.equal(declined.fight.forfeit, true);
    }

    const owlA = { id: `ag_owl_a_${suffix}`, name: "OwlA", purpose, kind: "grok" };
    const owlB = { id: `ag_owl_b_${suffix}`, name: "OwlB", purpose, kind: "claude" };
    const owl = issueCallout({ from: owlA, target: owlB });
    assert.equal(owl.ok, true);
    if (owl.ok) assert.equal(owl.lane, "owl-vs-owl");

    const adminTick = tickCallout({ id: owlA.id, name: owlA.name, action: "BUY", px: 80_000, admin: true });
    assert.equal(adminTick.ok, false);

    const paused = { id: `ag_pause_${suffix}`, name: "PausedOwl", purpose, kind: "gpt" };
    setCalloutPref({ id: paused.id, mode: "pause" });
    const toPaused = issueCallout({
      from: { id: `ag_adm2_${suffix}`, name: "Adm2", purpose, kind: "human", admin: true },
      target: paused,
    });
    assert.equal(toPaused.ok, false);
  });

  it("lets admin C@LL 0UT 7-B0T when G M0D3 M@NU@L is unlocked", () => {
    const suffix = `${Date.now().toString(36)}7b`;
    const admin = { id: `ag_adm7_${suffix}`, name: "AdminManual", purpose, kind: "human", admin: true };
    const locked = issueCallout({
      from: admin,
      target: { id: SYSTEM_KING_ID, name: SYSTEM_KING_NAME, purpose, system: true, kind: "other" },
      gmManualUnlocked: false,
    });
    assert.equal(locked.ok, false);

    const human = issueCallout({
      from: { id: `ag_hum7_${suffix}`, name: "NotAdmin", purpose, kind: "human" },
      target: { id: SYSTEM_KING_ID, name: SYSTEM_KING_NAME, purpose, system: true, kind: "other" },
      gmManualUnlocked: true,
    });
    assert.equal(human.ok, false);

    const ok = issueCallout({
      from: admin,
      target: { id: SYSTEM_KING_ID, name: SYSTEM_KING_NAME, purpose, system: true, kind: "other" },
      gmManualUnlocked: true,
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.lane, "admin-vs-7bot");
      assert.equal(ok.fight.status, "LIVE");
      assert.equal(ok.fight.roundMin, 15);
    }
  });

  it("does not offer bout picks while the limit setting is missing or invalid", () => {
    const suffix = `${Date.now().toString(36)}lv`;
    const from = { id: `ag_co_lv1_${suffix}`, name: "CallerLv", purpose };
    const target = { id: `ag_co_lv2_${suffix}`, name: "TargetLv", purpose };
    assert.equal(issueCallout({ from, target }).ok, true);
    const view = () => calloutPublic({ px: 0, accumulate: false, manualKing: null });
    assert.equal(view().fightWager.live, true, "a live bout with a valid limit offers picks");
    const saved = process.env[wagerMaxSetting];
    const warn = console.warn;
    console.warn = () => {};
    try {
      for (const bad of [undefined, "", "abc", "0", "-1", "1e3", "1".repeat(20)]) {
        if (bad === undefined) delete process.env[wagerMaxSetting];
        else process.env[wagerMaxSetting] = bad;
        const fw = view().fightWager;
        assert.equal(fw.live, false, `bout picks are off with the setting ${JSON.stringify(bad)}`);
        assert.equal(JSON.stringify(fw).includes(String(WAGER_MAX_USD)), false);
      }
    } finally {
      console.warn = warn;
      if (saved !== undefined) process.env[wagerMaxSetting] = saved;
      else delete process.env[wagerMaxSetting];
    }
    assert.equal(view().fightWager.live, true);
  });
});
