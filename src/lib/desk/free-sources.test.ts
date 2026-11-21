import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gapPct,
  isStale,
  isoDayOf,
  MAX_AGE_MS,
  parseAtom,
  parseCmcQuotes,
  parseStrategyLedger,
  parseTreasuryDebt,
  parseYahooChartQuote,
  stampOf,
  withStrategyBackup,
} from "./free-sources.ts";

// Fixtures are trimmed copies of live responses captured 2026-11-20. No network in tests.
const DEBT = {
  data: [
    {
      record_date: "2026-11-18",
      tot_pub_debt_out_amt: "40690769638849.95",
      debt_held_public_amt: "32886805439264.87",
      intragov_hold_amt: "7803964199585.08",
    },
  ],
};

const LEDGER_HTML = `<table><thead><tr><th>Count</th><th>Reported</th><th>BTC Acq</th><th>Avg BTC Price</th><th>Acq Cost ($M)</th><th>BTC</th><th>Avg Cost</th></tr></thead>
<tbody><tr><td></td><td></td><td>850,849</td><td>$75,452</td><td>$64,198</td><td>850,849</td><td>$75,452</td></tr>
<tr class="MuiTableRow-root"><td class="MuiTableCell-root">127</td><td class="MuiTableCell-root"><span>11 / 16 / 2026</span></td><td>485</td><td>$ 68,887</td><td>$33</td><td><div><span><svg><path d="M2 8"></path></svg></span>850,849</div></td><td>457,244</td></tr>
<tr><td>126</td><td>11 / 9 / 2026</td><td>1,036</td><td>$ 79,012</td><td>$82</td><td>850,364</td><td>455,163</td></tr></tbody></table>`;

const OPTECH_ATOM = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<title>Bitcoin Optech</title><link href="https://bitcoinops.org/feed.xml" rel="self"/>
<entry><title type="html">Bitcoin Optech Newsletter #432</title><link href="https://bitcoinops.org/en/newsletters/2026/11/20/" rel="alternate" type="text/html"/><published>2026-11-20T00:00:00+00:00</published><content>x</content></entry>
<entry><title>Bitcoin Optech Newsletter #431 &amp; recap</title><link href="https://bitcoinops.org/en/newsletters/2026/11/13/"/><updated>2026-11-13T00:00:00+00:00</updated></entry>
<entry><title>Bad link</title><link href="http://example.com/"/><published>2026-11-06T00:00:00+00:00</published></entry>
</feed>`;

const CMC = {
  status: { error_code: 0 },
  data: {
    BTC: [{ symbol: "BTC", last_updated: "2026-11-20T21:10:00.000Z", quote: { USD: { price: 85123.4, percent_change_24h: -1.25, last_updated: "2026-11-20T21:10:00.000Z" } } }],
    ETH: [{ symbol: "ETH", quote: { USD: { price: 3000.5, percent_change_24h: null, last_updated: "2026-11-20T21:09:00.000Z" } } }],
    BAD: [{ symbol: "BAD", quote: { USD: { price: null } } }],
  },
};

const YF = {
  chart: {
    result: [
      {
        meta: { symbol: "MSTR", shortName: "Strategy Inc", regularMarketPrice: 77.8, regularMarketChangePercent: -9.671, regularMarketTime: 1795208400 },
        indicators: { quote: [{ close: [90, 88, 86.13, 77.8] }] },
      },
    ],
  },
};

const NOW = Date.parse("2026-11-20T21:15:00Z");

test("isoDayOf handles the three source date styles", () => {
  assert.equal(isoDayOf("Nov 19, 2026"), "2026-11-19");
  assert.equal(isoDayOf("11/16/2026"), "2026-11-16");
  assert.equal(isoDayOf("11 / 9 / 2026"), "2026-11-09");
  assert.equal(isoDayOf("2026-11-18"), "2026-11-18");
  assert.equal(isoDayOf("soon"), null);
});

test("isStale uses the source timestamp", () => {
  assert.equal(isStale("2026-11-18", NOW, MAX_AGE_MS.fiscal), false);
  assert.equal(isStale("2026-11-01", NOW, MAX_AGE_MS.fiscal), true);
  assert.equal(isStale(null, NOW, MAX_AGE_MS.fiscal), true);
  assert.equal(isStale("2026-12-30", NOW, MAX_AGE_MS.fiscal), true, "future dates are not trusted");
  assert.equal(isStale("2026-11-20T21:10:00.000Z", NOW, MAX_AGE_MS.cmc), false);
  assert.equal(isStale("2026-11-20T20:00:00.000Z", NOW, MAX_AGE_MS.cmc), true);
  assert.equal(stampOf("fiscal", "s", "u", "2026-11-18", NOW, MAX_AGE_MS.fiscal, false).stale, true, "a failed read is stale");
});

test("Treasury Debt to the Penny parses newest row", () => {
  const d = parseTreasuryDebt(DEBT);
  assert.ok(d);
  assert.equal(d.asOf, "2026-11-18");
  assert.equal(d.totalUsd, 40690769638849.95);
  assert.equal(d.publicUsd, 32886805439264.87);
  assert.equal(parseTreasuryDebt({ data: [] }), null);
  assert.equal(parseTreasuryDebt(null), null);
});

test("Strategy ledger picks the latest numbered row", () => {
  const l = parseStrategyLedger(LEDGER_HTML);
  assert.ok(l);
  assert.equal(l.asOf, "2026-11-16");
  assert.equal(l.btc, 850849);
  assert.equal(l.lastBuyBtc, 485);
  assert.equal(l.lastBuyPriceUsd, 68887);
  assert.equal(l.avgCostUsd, 75452);
  assert.equal(l.totalCostUsdM, 64198);
  assert.equal(parseStrategyLedger("<html><body>Access Denied</body></html>"), null);
});

test("Optech Atom feed: href links, published or updated, https only", () => {
  const h = parseAtom(OPTECH_ATOM, "Bitcoin Optech", (s) => s.replace(/&amp;/g, "&"), 4);
  assert.equal(h.length, 2);
  assert.equal(h[0]!.title, "Bitcoin Optech Newsletter #432");
  assert.equal(h[0]!.url, "https://bitcoinops.org/en/newsletters/2026/11/20/");
  assert.equal(h[0]!.published, "2026-11-20T00:00:00+00:00");
  assert.equal(h[1]!.title, "Bitcoin Optech Newsletter #431 & recap");
  assert.equal(h[1]!.published, "2026-11-13T00:00:00+00:00");
  assert.equal(parseAtom(OPTECH_ATOM, "Bitcoin Optech", (s) => s, 1).length, 1);
});

test("CoinMarketCap quotes keep last_updated and drop bad rows", () => {
  const q = parseCmcQuotes(CMC);
  assert.deepEqual(q.map((x) => x.symbol), ["BTC", "ETH"]);
  assert.equal(q[0]!.lastUpdated, "2026-11-20T21:10:00.000Z");
  assert.equal(q[0]!.changePct24h, -1.25);
  assert.equal(q[1]!.changePct24h, null);
  assert.deepEqual(parseCmcQuotes({ status: { error_code: 1002, error_message: "API key missing." } }), []);
  assert.ok(Math.abs(gapPct(85123.4, 85000)! - 0.14517647) < 1e-6);
  assert.equal(gapPct(null, 85000), null);
});

test("Yahoo v8 chart quote carries market time", () => {
  const q = parseYahooChartQuote(YF, "MSTR");
  assert.ok(q);
  assert.equal(q.last, 77.8);
  assert.equal(q.changePct, -9.671);
  assert.equal(q.at, new Date(1795208400 * 1000).toISOString());
  const noPct = structuredClone(YF);
  delete (noPct.chart.result[0]!.meta as { regularMarketChangePercent?: number }).regularMarketChangePercent;
  const q2 = parseYahooChartQuote(noPct, "MSTR");
  assert.ok(Math.abs(q2!.changePct! - ((77.8 - 86.13) / 86.13) * 100) < 1e-9, "falls back to prior daily close");
  assert.equal(parseYahooChartQuote({ chart: { result: [] } }, "MSTR"), null);
});

test("Strategy ledger only backs up a missing Bitbo row", () => {
  const ledger = parseStrategyLedger(LEDGER_HTML)!;
  const base = { usd: null, sharePct: null, country: "US", held: "x", url: "https://bitbo.io/" };
  const withRow = [{ ...base, rank: 1, name: "Strategy", btc: 849000 }];
  assert.deepEqual(withStrategyBackup(withRow, ledger, NOW), withRow, "Bitbo row wins");
  const without = [
    { ...base, rank: 1, name: "MARA Holdings", btc: 60000 },
    { ...base, rank: 2, name: "Tesla", btc: 11000 },
  ];
  const out = withStrategyBackup(without, ledger, NOW);
  assert.equal(out[0]!.name, "Strategy");
  assert.equal(out[0]!.rank, 1);
  assert.equal(out[1]!.rank, 2);
  assert.equal(out.length, 3);
  assert.deepEqual(withStrategyBackup(without, { ...ledger, asOf: "2026-09-01" }, NOW), without, "stale ledger ignored");
});
