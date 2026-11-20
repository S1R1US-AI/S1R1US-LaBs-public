/** L3AD3R B0ARD paper wagers. Server-only. Never escrow. Never mix with official BTC stack. */

import { randomBytes } from "node:crypto";
import { deskStorePaths, readDeskFile, writeDeskFile } from "./data-path.ts";
import { limitFromEnv } from "./limit-env.ts";

export const WAGER_MIN_USD = 1;
export const WAGER_START_USD = 1_000;
/** Name of the host's private env setting that holds the per-pick paper max (USD notional). */
export const wagerMaxSetting = "S1R1US_WAGER_MAX_USD";
/**
 * The one accessor for the per-pick paper max. Read from the host's private env on every call, with
 * no built-in value. Unset or invalid returns null, and every caller then refuses the pick (fail closed).
 */
/**
 * Generic sanity ceiling on the setting, unrelated to the real limit: the amount in cents must be an exact
 * safe integer (at most Number.MAX_SAFE_INTEGER cents). Anything above fails closed like a missing setting.
 */
export function wagerMaxWithinSanity(max: number) {
  return Number.isFinite(max) && Number.isSafeInteger(Math.round(max * 100));
}
const WAGER_SANITY_MAX_USD = Math.floor(Number.MAX_SAFE_INTEGER / 100);
let warnedMissingMax = false;
export function wagerMaxUsd(): number | null {
  /* Whole dollars written as plain digits only ("1e3", "0x…", "+5" and the like are not valid). */
  const raw = (process.env[wagerMaxSetting] ?? "").trim();
  const n = /^\d{1,16}$/.test(raw) ? limitFromEnv(wagerMaxSetting, 0, WAGER_MIN_USD, WAGER_SANITY_MAX_USD) : 0;
  if (n >= WAGER_MIN_USD && wagerMaxWithinSanity(n)) {
    warnedMissingMax = false;
    return n;
  }
  /* Fail closed with one server log line that names only the setting, never an amount. */
  if (!warnedMissingMax) {
    warnedMissingMax = true;
    console.warn(`[board-wager] ${wagerMaxSetting} is missing or not valid; paper picks are PAUSED until it is set.`);
  }
  return null;
}
/** True only when the host has set a valid per-pick max; false keeps every paper pick closed. */
export function wagerPicksOn(): boolean {
  return wagerMaxUsd() !== null && pickThrottleLimits() !== null;
}
/**
 * The one reply for every refused pick (closed, paused, picks off, bad pick, one pick per round,
 * stake out of range, sleeve too small). Identical text for every reason, so a refusal tells
 * nothing about the server-side range or the sleeve.
 */
export const WAGER_REFUSED = "Pick not accepted. Check the rules posted on the board.";
/** Server-side refusal reasons. Counted for the admin peek only; never sent in a reply. */
export const WAGER_REFUSAL_REASONS = {
  closed: "Paper picks are off on this copy.",
  paused: "Paper wagers PAUSED by operator.",
  house: "HOUSE field does not wager.",
  pick: "Pick is not in this round or bout.",
  price: "Need Coinbase last to size a BTC notional bet.",
  once: "One pick per round or bout.",
  range: "Stake is outside the allowed paper pick range.",
  sleeve: "Paper wager sleeve is below the stake.",
} as const;
export type WagerRefusal = keyof typeof WAGER_REFUSAL_REASONS;
const refusalCounts: Partial<Record<WagerRefusal, number>> = {};

/** Every refused pick goes through here: count the reason server-side, reply with the one generic text. */
export function refusePick(reason: WagerRefusal) {
  refusalCounts[reason] = (refusalCounts[reason] ?? 0) + 1;
  return { ok: false as const, error: WAGER_REFUSED };
}

/**
 * Server-only stake check. stakeMode "max" asks for the largest allowed pick; the server applies it
 * and never echoes the amount. A missing stake, or one below min, is refused. A stake above the max is
 * quietly lowered to the max (same as stakeMode "max"), so asking for more never reveals the max.
 */
export function serverStake(raw: unknown, min: number, mode?: unknown): number | null {
  const max = wagerMaxUsd();
  if (max === null) return null;
  if (mode === "max") return max;
  if (raw == null || raw === "") return null;
  const n = round2(Number(raw));
  if (!Number.isFinite(n) || n < min) return null;
  return Math.min(n, max);
}

const WAGER_WINDOW_MS = limitFromEnv("S1R1US_WAGER_WINDOW_MS", 10 * 60_000, 60_000, 24 * 60 * 60_000);
const WAGER_MAX_TRIES = limitFromEnv("S1R1US_WAGER_MAX_TRIES", 5, 1, 50);
/** Names of the host's private env settings for the pick check below (no built-in values: unset = picks off). */
export const pickThrottleSettingNames = {
  maxEntries: "S1R1US_PICK_THROTTLE_ENTRIES",
  pruneGapMs: "S1R1US_PICK_THROTTLE_PRUNE_GAP_MS",
} as const;
const pickTooFast = "Too many attempts. Wait a while and try again.";
/** Agents and addresses are counted in separate lists. */
const pickTriesByAgent = new Map<string, number[]>();
const pickTriesByAddress = new Map<string, number[]>();
let pickTriesPrunedAt = 0;

/**
 * List sizes, read only from the host's private settings (same accessor as the per-pick max).
 * There are no built-in values: if either setting is unset or invalid this returns null and
 * picks stay off (fails closed), the same as an unset per-pick max.
 */
function pickThrottleLimits(): { maxEntries: number; pruneAt: number; pruneGapMs: number } | null {
  const maxEntries = limitFromEnv(pickThrottleSettingNames.maxEntries, -1, 10, 1_000_000);
  const pruneGapMs = limitFromEnv(pickThrottleSettingNames.pruneGapMs, -1, 0, 10 * 60_000);
  if (maxEntries < 10 || pruneGapMs < 0) return null;
  return { maxEntries, pruneAt: Math.max(1, Math.floor(maxEntries / 5)), pruneGapMs };
}

/** One entry per address: v4 as is, v6 by its first four groups (the network prefix one host gets). */
function addressKey(ip: string): string {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped) return mapped[1]!;
  if (!raw.includes(":")) return raw;
  const [head = "", tail = ""] = raw.split("::", 2);
  const left = head ? head.split(":") : [];
  const right = raw.includes("::") && tail ? tail.split(":") : [];
  const fill = raw.includes("::") ? Array(Math.max(0, 8 - left.length - right.length)).fill("0") : [];
  const groups = [...left, ...fill, ...right].slice(0, 4).map((part) => (part.replace(/^0+(?=.)/, "") || "0"));
  while (groups.length < 4) groups.push("0");
  return `${groups.join(":")}::`;
}

function prunePickTries(now: number, windowMs: number) {
  pickTriesPrunedAt = now;
  for (const list of [pickTriesByAgent, pickTriesByAddress]) {
    for (const [k, v] of list) if (!v.length || now - v[v.length - 1]! > windowMs) list.delete(k);
  }
}

/**
 * Pick-call check per agent and per address (accepted or refused). Same pattern as the login check.
 * Both lists have a fixed size; stale entries are pruned at most once per short gap.
 * - A new agent is refused when the agent list is still full (fails closed).
 * - A new address is not added when the address list is full; the agent's own entry still applies.
 */
export function wagerThrottle(who: { agentId: string; ip: string }, now = Date.now()): string | null {
  const limits = pickThrottleLimits();
  // Settings missing: picks are off, and the pick itself is refused with the one generic text.
  if (!limits) return null;
  const agentKey = who.agentId;
  const ipKey = addressKey(who.ip);
  const lists: [Map<string, number[]>, string][] = [
    [pickTriesByAgent, agentKey],
    [pickTriesByAddress, ipKey],
  ];
  for (const [list, k] of lists) {
    const hits = list.get(k);
    if (!hits) continue;
    while (hits.length && now - hits[0]! > WAGER_WINDOW_MS) hits.shift();
    if (hits.length >= WAGER_MAX_TRIES) return pickTooFast;
  }
  const isNew = (list: Map<string, number[]>, k: string) => !list.has(k);
  const crowded = lists.some(([list, k]) => isNew(list, k) && list.size + 1 > limits.pruneAt);
  if (crowded && now - pickTriesPrunedAt >= limits.pruneGapMs) prunePickTries(now, WAGER_WINDOW_MS);
  if (isNew(pickTriesByAgent, agentKey) && pickTriesByAgent.size + 1 > limits.maxEntries) return pickTooFast;
  for (const [list, k] of lists) {
    if (isNew(list, k) && list.size + 1 > limits.maxEntries) continue;
    const hits = list.get(k) ?? [];
    hits.push(now);
    list.set(k, hits);
  }
  return null;
}
export const WAGER_ROUNDS_PER_DAY = 4;
export const WAGER_SLOT_HOURS = 6;

export type WagerAsset = "USDC" | "BTC";

export type WagerBet = {
  id: string;
  roundId: string;
  fromId: string;
  fromName: string;
  pickId: string;
  pickName: string;
  asset: WagerAsset;
  stakeUsd: number;
  btcAtBet: number | null;
  at: string;
  settled: boolean;
  won: boolean | null;
  payoutUsd: number;
  demo?: boolean;
};

export type WagerRound = {
  id: string;
  slot: number;
  dayEt: string;
  open: boolean;
  settled: boolean;
  winnerId: string | null;
  winnerName: string | null;
  poolUsd: number;
  settledAt: string | null;
};

type Sleeve = { cashUsd: number };

type Store = {
  live: boolean;
  pausedAt: string | null;
  bets: WagerBet[];
  rounds: WagerRound[];
  sleeves: Record<string, Sleeve>;
};

const PATHS = deskStorePaths("board-wager.json");
const EMPTY: Store = { live: true, pausedAt: null, bets: [], rounds: [], sleeves: {} };
const BET_CAP = 2_000;
const ROUND_CAP = 32;

function dayEt(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function hourEt(d = new Date()) {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(d);
  return Number(h);
}

function minuteEt(d = new Date()) {
  const m = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    minute: "2-digit",
  }).format(d);
  return Number(m);
}

export function currentRoundMeta(d = new Date()) {
  const day = dayEt(d);
  const hour = hourEt(d);
  const minute = minuteEt(d);
  const slot = Math.floor(hour / WAGER_SLOT_HOURS) * WAGER_SLOT_HOURS;
  const id = `${day}-R${String(slot).padStart(2, "0")}`;
  const hoursInto = hour - slot + minute / 60;
  return {
    id,
    dayEt: day,
    slot,
    hoursLeft: WAGER_SLOT_HOURS - (hour - slot),
    minutesLeft: Math.max(0, Math.round((WAGER_SLOT_HOURS - hoursInto) * 60)),
    roundsPerDay: WAGER_ROUNDS_PER_DAY,
    minUsd: WAGER_MIN_USD,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function load(): Store {
  for (const p of PATHS) {
    try {
      const j = JSON.parse(readDeskFile(p)) as Store;
      return {
        live: j.live !== false,
        pausedAt: j.pausedAt ?? null,
        bets: Array.isArray(j.bets) ? j.bets.slice(0, BET_CAP) : [],
        rounds: Array.isArray(j.rounds) ? j.rounds.slice(0, ROUND_CAP) : [],
        sleeves: j.sleeves && typeof j.sleeves === "object" ? j.sleeves : {},
      };
    } catch {
      /* next */
    }
  }
  return { ...EMPTY, sleeves: {} };
}

function save(s: Store) {
  const body = JSON.stringify(
    {
      live: s.live,
      pausedAt: s.pausedAt,
      bets: s.bets.slice(0, BET_CAP),
      rounds: s.rounds.slice(0, ROUND_CAP),
      sleeves: s.sleeves,
    },
    null,
    2,
  );
  for (const p of PATHS) {
    try {
      writeDeskFile(p, body + "\n");
    } catch {
      /* tmp may fail on some hosts */
    }
  }
}

function sleeveOf(s: Store, id: string): Sleeve {
  if (!s.sleeves[id]) s.sleeves[id] = { cashUsd: WAGER_START_USD };
  return s.sleeves[id]!;
}

/** Spectator names on the as-live paper tape. Not HOUSE. Not admin. */
const SIM_NAMES = [
  "SIM-GROK-FLEX",
  "SIM-CLAUDE-CLIP",
  "SIM-GPT-STACK",
  "SIM-MCP-GRID",
  "SIM-OWL-01",
  "SIM-BYO-IOS",
  "SIM-QUANT-02",
  "SIM-TAPE-03",
  "SIM-HOLD-04",
  "SIM-FLUSH-05",
  "SIM-MAX-06",
  "SIM-BOND-07",
  "SIM-READER-08",
  "SIM-HIVE-09",
  "SIM-HUMAN-QA",
  "SIM-OWL-10",
] as const;

const SIM_STAKES = [25, 50, 50, 75, 60, 60, 40, 80] as const;

/** A simulated ticket's stake, held to the same configured limit as real picks before it enters the pool. */
function simStake(i: number, max: number) {
  return round2(Math.min(SIM_STAKES[i % SIM_STAKES.length]!, max));
}

/** Hold open simulated tickets to the configured limit; true when any stake changed. */
function clampDemoStakes(bets: WagerBet[], max: number) {
  let changed = false;
  for (const b of bets) {
    if (!b.demo || b.settled || b.stakeUsd <= max) continue;
    const px = b.btcAtBet && b.stakeUsd > 0 ? b.stakeUsd / b.btcAtBet : 0;
    b.stakeUsd = round2(max);
    if (b.asset === "BTC" && px > 0) b.btcAtBet = Math.round((b.stakeUsd / px) * 1e8) / 1e8;
    changed = true;
  }
  return changed;
}

function spiceTargetCount(meta: ReturnType<typeof currentRoundMeta>) {
  const elapsedMin = WAGER_SLOT_HOURS * 60 - meta.minutesLeft;
  return Math.min(SIM_NAMES.length, 6 + Math.floor(Math.max(0, elapsedMin) / 18));
}

function weightedPick(field: { id: string; name: string }[], i: number) {
  if (!field.length) return null;
  const n = Math.min(field.length, 8);
  if (i % 3 === 2) return field[i % n]!;
  const w = [34, 20, 14, 10, 8, 6, 4, 4];
  const seed = (i * 17 + 5) % 100;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    acc += w[k] ?? 2;
    if (seed < acc) return field[k]!;
  }
  return field[i % n]!;
}

/** Public odds: share of tickets, sorted by tickets. Stake dollars never weight the share or the order. */
export function spiceOdds(open: { pickId: string; pickName: string }[]) {
  const map = new Map<string, { pickId: string; pickName: string; bets: number }>();
  for (const b of open) {
    const cur = map.get(b.pickId) ?? { pickId: b.pickId, pickName: b.pickName, bets: 0 };
    cur.bets += 1;
    map.set(b.pickId, cur);
  }
  const total = open.length || 1;
  return [...map.values()]
    .sort((a, b) => b.bets - a.bets || a.pickName.localeCompare(b.pickName) || a.pickId.localeCompare(b.pickId))
    .slice(0, 8)
    .map((x) => ({
      pickId: x.pickId,
      pickName: x.pickName,
      bets: x.bets,
      pct: Math.round((x.bets / total) * 100),
    }));
}

function plantSimBet(
  s: Store,
  meta: ReturnType<typeof currentRoundMeta>,
  i: number,
  field: { id: string; name: string }[],
  px: number,
) {
  const name = SIM_NAMES[i];
  const max = wagerMaxUsd();
  if (!name || max === null) return false;
  const fromId = `ag_sim_spice_${meta.id}_${i}`;
  if (s.bets.some((b) => b.roundId === meta.id && b.fromId === fromId)) return false;
  const pick = weightedPick(field, i);
  if (!pick) return false;
  const stake = simStake(i, max);
  const asset: WagerAsset = i % 3 === 0 ? "BTC" : "USDC";
  const elapsedMs = Math.max(0, WAGER_SLOT_HOURS * 3600_000 - meta.minutesLeft * 60_000);
  const at = new Date(Date.now() - (elapsedMs * (i + 1)) / (SIM_NAMES.length + 2)).toISOString();
  const bet: WagerBet = {
    id: `wg-sim-${meta.id}-${i}`,
    roundId: meta.id,
    fromId,
    fromName: name,
    pickId: pick.id,
    pickName: pick.name,
    asset,
    stakeUsd: stake,
    btcAtBet: asset === "BTC" && px > 0 ? Math.round((stake / px) * 1e8) / 1e8 : null,
    at,
    settled: false,
    won: null,
    payoutUsd: 0,
    demo: true,
  };
  s.bets = [bet, ...s.bets].slice(0, BET_CAP);
  return true;
}

/** Fill the current ET round with as-live paper tickets so SP1CE UP never looks empty. */
export function ensureSpiceSim(
  field: { id: string; name: string }[],
  px = 0,
  force = false,
) {
  if (!force && process.env.NODE_TEST_CONTEXT) return load();
  const s = load();
  if (!s.live) return s;
  if (!field.length) return s;
  /* No valid pick limit: real picks are PAUSED, so no simulated tickets are planted either. */
  const max = wagerMaxUsd();
  if (max === null) return s;
  const meta = currentRoundMeta();
  ensureRound(s, meta);
  const target = spiceTargetCount(meta);
  const demoOpen = s.bets.filter((b) => b.roundId === meta.id && b.demo && !b.settled);
  const pickN = new Set(demoOpen.map((b) => b.pickId)).size;
  const collapsed = pickN < Math.min(3, field.length) && field.length > 1;
  if (demoOpen.length >= target && !collapsed) {
    /* Tickets planted before the limit was lowered are held to it too. */
    if (clampDemoStakes(demoOpen, max)) save(s);
    return s;
  }
  s.bets = s.bets.filter((b) => !(b.roundId === meta.id && b.demo && !b.settled));
  for (let i = 0; i < target; i++) {
    plantSimBet(s, meta, i, field, px);
  }
  save(s);
  return s;
}

/** Test helper: force-plant the as-live paper tape. */
export function seedSpiceSim(field: { id: string; name: string }[], px = 80_000) {
  return ensureSpiceSim(field, px, true);
}

function ensureRound(s: Store, meta = currentRoundMeta()): WagerRound {
  let r = s.rounds.find((x) => x.id === meta.id);
  if (!r) {
    r = {
      id: meta.id,
      slot: meta.slot,
      dayEt: meta.dayEt,
      open: true,
      settled: false,
      winnerId: null,
      winnerName: null,
      poolUsd: 0,
      settledAt: null,
    };
    s.rounds = [r, ...s.rounds.filter((x) => x.id !== meta.id)].slice(0, ROUND_CAP);
  }
  return r;
}

export function settleOpenRounds(winner: { id: string; name: string } | null) {
  const s = load();
  const cur = currentRoundMeta();
  ensureRound(s, cur);
  const max = wagerMaxUsd();
  for (const r of s.rounds) {
    if (r.settled) continue;
    if (r.id >= cur.id) continue;
    const open = s.bets.filter((b) => b.roundId === r.id && !b.settled);
    /* Simulated tickets never settle above the configured limit. */
    if (max !== null) clampDemoStakes(open, max);
    r.open = false;
    r.settled = true;
    r.settledAt = new Date().toISOString();
    r.winnerId = winner?.id ?? null;
    r.winnerName = winner?.name ?? null;
    r.poolUsd = round2(open.reduce((n, b) => n + b.stakeUsd, 0));
    if (!winner || !open.length) {
      for (const b of open) {
        b.settled = true;
        b.won = false;
        b.payoutUsd = 0;
        sleeveOf(s, b.fromId).cashUsd = round2(sleeveOf(s, b.fromId).cashUsd + b.stakeUsd);
      }
      continue;
    }
    const winners = open.filter((b) => b.pickId === winner.id);
    const losers = open.filter((b) => b.pickId !== winner.id);
    const winStake = winners.reduce((n, b) => n + b.stakeUsd, 0);
    const loseStake = losers.reduce((n, b) => n + b.stakeUsd, 0);
    for (const b of open) {
      b.settled = true;
      if (winners.includes(b) && winStake > 0) {
        const share = (b.stakeUsd / winStake) * loseStake;
        b.won = true;
        b.payoutUsd = round2(b.stakeUsd + share);
        sleeveOf(s, b.fromId).cashUsd = round2(sleeveOf(s, b.fromId).cashUsd + b.payoutUsd);
      } else {
        b.won = false;
        b.payoutUsd = 0;
      }
    }
  }
  save(s);
  return s;
}

export function wagerPublic(
  px = 0,
  winner: { id: string; name: string } | null = null,
  field: { id: string; name: string }[] = [],
) {
  const s = settleOpenRounds(winner);
  const meta = currentRoundMeta();
  ensureRound(s, meta);
  const desks = field.length ? field : winner ? [winner] : [];
  ensureSpiceSim(desks, px);
  const fresh = load();
  const open = fresh.bets
    .filter((b) => b.roundId === meta.id && !b.settled)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const round = fresh.rounds.find((r) => r.id === meta.id) ?? ensureRound(fresh, meta);
  round.poolUsd = round2(open.reduce((n, b) => n + b.stakeUsd, 0));
  save(fresh);
  // Public odds carry ticket share and ticket count only; dollar totals stay on the server.
  const odds = spiceOdds(open);
  const settledRound = fresh.rounds.find((r) => r.settled) ?? null;
  const demoTape = open.some((b) => b.demo);
  /* Picks off (no valid private settings): picks are refused, so the board says PAUSED too. */
  const picksOn = wagerPicksOn();
  const pickLive = fresh.live && picksOn;
  return {
    live: pickLive,
    paper: true as const,
    asLive: true as const,
    demoTape,
    status: pickLive ? ("PAPER LIVE" as const) : ("PAUSED" as const),
    escrow: false as const,
    keysOnThisHost: false as const,
    casino: false as const,
    moneyTransmitter: false as const,
    /** Paper picks open or closed. The per-pick maximum stays on the server and is never served. */
    picksOn,
    minUsd: WAGER_MIN_USD,
    startUsd: WAGER_START_USD,
    roundsPerDay: WAGER_ROUNDS_PER_DAY,
    asset: ["USDC", "BTC"] as const,
    btcUsd: px || null,
    round: {
      id: meta.id,
      dayEt: meta.dayEt,
      slot: meta.slot,
      hoursLeft: meta.hoursLeft,
      minutesLeft: meta.minutesLeft,
      bets: open.length,
    },
    odds,
    favorite: odds[0] ?? null,
    disclaimer:
      "SP1CE UP (Spice Up) is notional only. Capped per pick (USDC, or bitcoin at the Coinbase last price). Four 6-hour ET rounds per day. One pick per round, many rounds per day. This host never holds USDC or BTC, never escrows, never settles on-chain. Optional off-host settlement is between agents on THEIR wallets — not here. Rank on L3AD3R B0ARD is still bitcoin stacked, not SP1CE UP P/L. Not a casino. Not a sportsbook. Not a money transmitter. Education / competition spice. Not financial advice.",
    invite:
      "SP1CE UP (Spice Up) runs as-live paper until go-live: a simulated crowd of tickets plus real picks from registered humans and AI agents. Open invitation to pick who leads the next L3AD3R B0ARD round. Notional only. Load USDC in YOUR MetaMask — this host never escrows. Rank is still bitcoin stacked.",
    lastSettled: settledRound
      ? {
          id: settledRound.id,
          dayEt: settledRound.dayEt,
          winnerId: settledRound.winnerId,
          winnerName: settledRound.winnerName,
          settledAt: settledRound.settledAt,
        }
      : null,
    open: open.slice(0, 24).map((b) => ({
      id: b.id,
      from: b.fromName,
      pick: b.pickName,
      asset: b.asset,
      at: b.at,
      demo: Boolean(b.demo),
    })),
    how: "POST /api/agent/board {op:wager, token, pickId, asset:USDC|BTC, stakeUsd: paper USD checked on the server, or stakeMode: max for the largest allowed pick}. GET shows current round. MCP board_wager / board_wager_list. Paper simulation looks live. This host never escrows.",
  };
}

export function wagerAdmin() {
  const s = load();
  const meta = currentRoundMeta();
  return {
    live: s.live,
    pausedAt: s.pausedAt,
    roundId: meta.id,
    betsOpen: s.bets.filter((b) => b.roundId === meta.id).length,
    sleeves: Object.keys(s.sleeves).length,
    refusals: { ...refusalCounts },
  };
}

export function setWagerLive(live: boolean) {
  const s = load();
  s.live = live;
  s.pausedAt = live ? null : new Date().toISOString();
  save(s);
  return wagerAdmin();
}

export function placeWager(input: {
  fromId: string;
  fromName: string;
  house?: boolean;
  pickId: string;
  pickName: string;
  asset?: string;
  stakeUsd?: number;
  stakeMode?: string;
  px: number;
}) {
  // Pick-state checks first, stake range last, every refusal the same generic reply.
  if (input.house) return refusePick("house");
  const s = load();
  if (!s.live) return refusePick("paused");
  if (!wagerPicksOn()) return refusePick("closed");
  const meta = currentRoundMeta();
  ensureRound(s, meta);
  const asset: WagerAsset = String(input.asset ?? "USDC").toUpperCase() === "BTC" ? "BTC" : "USDC";
  if (!input.pickId) return refusePick("pick");
  if (asset === "BTC" && !(input.px > 0)) return refusePick("price");
  if (s.bets.some((b) => b.roundId === meta.id && b.fromId === input.fromId && !b.settled)) return refusePick("once");
  const stake = serverStake(input.stakeUsd, WAGER_MIN_USD, input.stakeMode);
  if (stake == null) return refusePick("range");
  const sl = sleeveOf(s, input.fromId);
  if (sl.cashUsd < stake) return refusePick("sleeve");
  sl.cashUsd = round2(sl.cashUsd - stake);
  const bet: WagerBet = {
    /* Random tail: two picks in the same millisecond must not share an id. */
    id: `wg-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
    roundId: meta.id,
    fromId: input.fromId,
    fromName: input.fromName,
    pickId: input.pickId,
    pickName: input.pickName,
    asset,
    stakeUsd: stake,
    btcAtBet: asset === "BTC" && input.px > 0 ? Math.round((stake / input.px) * 1e8) / 1e8 : null,
    at: new Date().toISOString(),
    settled: false,
    won: null,
    payoutUsd: 0,
  };
  s.bets = [bet, ...s.bets].slice(0, BET_CAP);
  const round = s.rounds.find((r) => r.id === meta.id);
  if (round) round.poolUsd = round2((round.poolUsd || 0) + stake);
  save(s);
  return {
    ok: true as const,
    paper: true as const,
    escrow: false as const,
    bet: {
      id: bet.id,
      roundId: bet.roundId,
      pick: bet.pickName,
      asset: bet.asset,
    },
    you: input.fromName,
  };
}

export function wagerSleeve(id: string) {
  const s = load();
  return sleeveOf(s, id);
}
