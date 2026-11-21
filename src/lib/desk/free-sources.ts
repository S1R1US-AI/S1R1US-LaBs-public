/**
 * Free data sources added in the 2026-11-20 free-source hunt (system admin t5563u).
 * Pure parsers and merge helpers only: no network, no secrets, no imports from server code,
 * so every function here is covered by fixture tests.
 *
 * Every reading carries the source's own timestamp (record date, holdings date,
 * ledger report date, last_updated, regularMarketTime). `stale` is computed from that
 * timestamp, never from the time we fetched it.
 *
 * Display only. Nothing here feeds marks, fills, the stale-price halt or the brakes.
 */
import type { BtcHolder, FreeSourceStamp, Headline, Quote } from "./types";

export const FISCAL_DEBT_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page%5Bsize%5D=1&fields=record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt";
export const FISCAL_DEBT_PAGE = "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/";
export const STRATEGY_LEDGER_URL = "https://www.strategy.com/ledger";
export const OPTECH_FEED_URL = "https://bitcoinops.org/feed.xml";
export const CMC_QUOTES_URL = "https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest";
export const CMC_PAGE = "https://coinmarketcap.com/";
/** Server-side env var holding the CoinMarketCap Basic API key. Never sent to a browser. */
export const CMC_KEY_ENV = "CMC_API_KEY";
export const CMC_HEADER = "X-CMC_PRO_API_KEY";
export const CMC_SYMBOLS = ["BTC", "ETH", "SOL", "HYPE", "ZEC"] as const;
/** Basic plan budget: 15k credits a month. One batched call per 5 minutes stays far under it. */
export const CMC_CACHE_MS = 5 * 60_000;

export const ATTRIBUTION = {
  fiscal: "Source: U.S. Treasury Fiscal Data, Debt to the Penny",
  strategy: "Source: Strategy Bitcoin Ledger",
  optech: "Source: Bitcoin Optech",
  cmc: "Data provided by CoinMarketCap",
} as const;

const DAY = 86_400_000;
/** Max age of each source's own timestamp before it is shown as stale. */
export const MAX_AGE_MS = {
  fiscal: 6 * DAY,
  strategy: 21 * DAY,
  cmc: 15 * 60_000,
  quote: 4 * DAY,
} as const;

export type TreasuryDebt = {
  totalUsd: number;
  publicUsd: number | null;
  intragovUsd: number | null;
  /** ISO day of the Treasury record. */
  asOf: string;
};

export type StrategyLedger = {
  btc: number;
  /** Whole-stack average cost and total cost, from the ledger totals row. */
  avgCostUsd: number | null;
  totalCostUsdM: number | null;
  lastBuyBtc: number | null;
  lastBuyPriceUsd: number | null;
  /** ISO day of the latest reported row. */
  asOf: string;
};

export type CmcQuote = {
  symbol: string;
  price: number;
  changePct24h: number | null;
  /** ISO time CoinMarketCap last updated this quote. */
  lastUpdated: string;
};

function numStr(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[$,"\s]/g, "");
  if (!s || s === "-") return null;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()]/g, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "Nov 19, 2026" | "11/16/2026" | "11 / 16 / 2026" | "2026-11-18" -> ISO day. */
export function isoDayOf(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
  if (m) return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/);
  if (m) {
    const mm = MONTHS[m[1]!.toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[2]!.padStart(2, "0")}`;
  }
  return null;
}

function dayMs(iso: string): number {
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isFinite(t) ? t : NaN;
}

/** True when the source timestamp is missing, unparseable, in the future (>1 day) or older than maxAgeMs. */
export function isStale(asOf: string | null, now: number, maxAgeMs: number): boolean {
  if (!asOf) return true;
  const t = dayMs(asOf);
  if (!Number.isFinite(t)) return true;
  if (t > now + DAY) return true;
  return now - t > maxAgeMs;
}

export function stampOf(
  id: FreeSourceStamp["id"],
  source: string,
  sourceUrl: string,
  asOf: string | null,
  now: number,
  maxAgeMs: number,
  ok: boolean,
  note = "",
): FreeSourceStamp {
  return { id, source, sourceUrl, asOf, ok, stale: !ok || isStale(asOf, now, maxAgeMs), note };
}

/** U.S. Treasury Fiscal Data, Debt to the Penny (newest row first). */
export function parseTreasuryDebt(raw: unknown): TreasuryDebt | null {
  const row = (raw as { data?: Record<string, unknown>[] } | null)?.data?.[0];
  if (!row) return null;
  const totalUsd = numStr(row.tot_pub_debt_out_amt);
  const asOf = typeof row.record_date === "string" ? isoDayOf(row.record_date) : null;
  if (totalUsd == null || totalUsd <= 0 || !asOf) return null;
  return {
    totalUsd,
    publicUsd: numStr(row.debt_held_public_amt),
    intragovUsd: numStr(row.intragov_hold_amt),
    asOf,
  };
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strategy Bitcoin Ledger table. Columns: Count | Reported | BTC Acq | Avg BTC Price |
 * Acq Cost ($M) | BTC | ... The row with the highest Count is the latest report. The totals
 * row (blank Count and Reported) carries the whole-stack average and total cost.
 */
export function parseStrategyLedger(html: string): StrategyLedger | null {
  let best: { count: number; cells: string[] } | null = null;
  let totals: string[] | null = null;
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...(m[1] ?? "").matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1] ?? ""));
    if (cells.length < 6) continue;
    if (!totals && !cells[0] && (!cells[1] || /^total$/i.test(cells[1])) && numStr(cells[5]) != null) {
      totals = cells;
      continue;
    }
    const count = Number(cells[0]);
    if (!Number.isInteger(count) || count <= 0) continue;
    if (!isoDayOf(cells[1] ?? "")) continue;
    if (!best || count > best.count) best = { count, cells };
  }
  if (!best) return null;
  const c = best.cells;
  const btc = numStr(c[5]);
  const asOf = isoDayOf(c[1] ?? "");
  if (btc == null || btc <= 0 || !asOf) return null;
  return {
    btc,
    lastBuyBtc: numStr(c[2]),
    lastBuyPriceUsd: numStr(c[3]),
    avgCostUsd: totals ? numStr(totals[3]) : null,
    totalCostUsdM: totals ? numStr(totals[4]) : null,
    asOf,
  };
}

/** Parse a CoinMarketCap v2 quote payload. Each symbol maps to an array of quote objects. */
export function parseCmcQuotes(raw: unknown): CmcQuote[] {
  const data = (raw as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== "object") return [];
  const out: CmcQuote[] = [];
  for (const [sym, v] of Object.entries(data)) {
    const first = (Array.isArray(v) ? v[0] : v) as
      | { symbol?: string; last_updated?: string; quote?: { USD?: { price?: number; percent_change_24h?: number; last_updated?: string } } }
      | undefined;
    const usd = first?.quote?.USD;
    const price = typeof usd?.price === "number" ? usd.price : NaN;
    const lastUpdated = usd?.last_updated ?? first?.last_updated ?? "";
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(Date.parse(lastUpdated))) continue;
    const pct = typeof usd?.percent_change_24h === "number" ? usd.percent_change_24h : NaN;
    out.push({
      symbol: (first?.symbol ?? sym).toUpperCase(),
      price,
      changePct24h: Number.isFinite(pct) ? pct : null,
      lastUpdated,
    });
  }
  return out;
}

/** Percent gap between two prices, or null. Display only; never used for marks or halts. */
export function gapPct(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  return ((a - b) / b) * 100;
}

function atomTag(block: string, name: "title" | "published" | "updated"): string {
  const pats = {
    title: /<title[^>]*>([\s\S]*?)<\/title>/i,
    published: /<published[^>]*>([\s\S]*?)<\/published>/i,
    updated: /<updated[^>]*>([\s\S]*?)<\/updated>/i,
  } as const;
  return (block.match(pats[name])?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}

/** Atom feed (Bitcoin Optech). Links are self-closing <link href=... rel="alternate"/>. */
export function parseAtom(xml: string, source: string, decode: (s: string) => string, limit = 4): Headline[] {
  const out: Headline[] = [];
  for (const m of xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi)) {
    if (out.length >= limit) break;
    const block = m[1] ?? "";
    const link =
      block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i)?.[1] ??
      block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ??
      "";
    const title = decode(atomTag(block, "title"));
    const published = atomTag(block, "published") || atomTag(block, "updated");
    if (!title || !/^https:\/\//.test(link)) continue;
    out.push({ source, title, url: link, published });
  }
  return out;
}

/** Yahoo v8 chart (query2) as a quote row. Replaces the v7 quote call, which now answers 401. */
export function parseYahooChartQuote(raw: unknown, symbol: string): Quote | null {
  const res = (raw as {
    chart?: {
      result?: {
        meta?: {
          symbol?: string;
          shortName?: string;
          longName?: string;
          regularMarketPrice?: number;
          regularMarketChangePercent?: number;
          regularMarketTime?: number;
        };
        indicators?: { quote?: { close?: (number | null)[] }[] };
      }[];
    };
  } | null)?.chart?.result?.[0];
  const meta = res?.meta;
  const last = typeof meta?.regularMarketPrice === "number" ? meta.regularMarketPrice : NaN;
  if (!Number.isFinite(last) || last <= 0) return null;
  const rawPct = meta?.regularMarketChangePercent;
  let changePct: number | null = typeof rawPct === "number" && Number.isFinite(rawPct) ? rawPct : null;
  if (changePct == null) {
    const closes = (res?.indicators?.quote?.[0]?.close ?? []).filter((n): n is number => n != null && Number.isFinite(n));
    const prev = closes.length >= 2 ? closes[closes.length - 2] : undefined;
    if (prev && prev > 0) changePct = ((last - prev) / prev) * 100;
  }
  const t = Number(meta?.regularMarketTime);
  return {
    symbol,
    name: meta?.shortName ?? meta?.longName ?? symbol,
    last,
    changePct,
    at: Number.isFinite(t) && t > 0 ? new Date(t * 1000).toISOString() : null,
    source: "Yahoo chart",
  };
}

/** Strategy ledger backs up the Bitbo row: only added when Bitbo has no Strategy row. */
export function withStrategyBackup(holders: BtcHolder[], ledger: StrategyLedger | null, now: number): BtcHolder[] {
  if (!ledger || isStale(ledger.asOf, now, MAX_AGE_MS.strategy)) return holders;
  if (holders.some((h) => /\b(micro)?strategy\b|\bmstr\b/i.test(h.name))) return holders;
  const row: BtcHolder = {
    rank: 0,
    name: "Strategy",
    btc: ledger.btc,
    usd: null,
    sharePct: null,
    country: "US",
    held: "Public company treasury",
    url: STRATEGY_LEDGER_URL,
  };
  return [...holders, row]
    .sort((a, b) => b.btc - a.btc)
    .slice(0, 20)
    .map((h, i) => ({ ...h, rank: i + 1 }));
}
