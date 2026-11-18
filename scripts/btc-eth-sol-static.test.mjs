// /btc-eth-sol/: BTC vs ETH vs SOL page. SEO placement, dated market-data snapshot with sources, the owner's
// quotes kept word for word, official Robinhood and Solana links, risk and not-advice copy, and safe client fetches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const page = read("front-door-static/btc-eth-sol/index.html");
const js = read("front-door-static/btc-eth-sol/btc-eth-sol.js");
const nav = read("src/lib/desk/public-nav.ts");
const start = read("scripts/do-start.mjs");

test("one H1, title, description, canonical and schema carry BTC vs ETH vs SOL", () => {
  assert.equal((page.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(page, /<h1 id="btc-eth-sol-h1">BTC vs ETH vs SOL:/);
  const title = page.match(/<title>([^<]*)<\/title>/)[1];
  assert.ok(title.startsWith("BTC vs ETH vs SOL") && title.endsWith("· S1R1US.ai") && title.length <= 60, title);
  const d = page.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.ok(d.length >= 120 && d.length <= 160, `description ${d.length}`);
  assert.match(d, /Not financial advice/);
  assert.match(page, /<link rel="canonical" href="https:\/\/s1r1us\.ai\/btc-eth-sol\/" \/>/);
  assert.match(page, /<meta property="og:url" content="https:\/\/s1r1us\.ai\/btc-eth-sol\/" \/>/);
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld["@type"], "Article");
  assert.equal(ld.url, "https://s1r1us.ai/btc-eth-sol/");
  assert.equal(ld.publisher.name, "SAI Citizens United LTD");
});

test("market data cards: ETH price, ETH/BTC, ETH/SOL and dominance keep a dated snapshot; market values are live only", () => {
  for (const id of ["card-eth-usd", "card-eth-btc", "card-eth-sol", "card-cap-eth-sol", "card-cap-eth-btc", "card-dominance"]) {
    const card = page.split('<li id="').find((c) => c.startsWith(id + '"')).split("</li>")[0];
    assert.match(card, /<span class="src">(Share of total crypto market value · )?Source: (Coinbase|CoinGecko)/, id);
  }
  assert.match(page, /Dated snapshot<\/strong> · <span id="bes-status-time">about 8:09 AM ET, November 18, 2026<\/span>/);
  assert.match(page, /four cards keep the dated snapshot, and the two market-value cards say live data is unavailable\./);
  for (const id of ["card-cap-eth-sol", "card-cap-eth-btc"]) {
    const card = page.split('<li id="').find((c) => c.startsWith(id + '"')).split("</li>")[0];
    assert.match(card, /<span class="value" id="[^"]+">—<\/span>/, id);
    assert.doesNotMatch(card.replace(/id="[^"]*"/g, ""), /\d/, id);
  }
  assert.match(page, /These are market\s+data, not buy or sell signals\./);
});

test("the owner's quotes stay word for word", () => {
  assert.ok(page.includes("ETH is spaghetti code. ETH is poorly designed and haphazardly redesigned to the point of lowering the full potential of ETH. Also the layer 2 chains on ETH have taken ETH’s LUNCH Money - hard core. ETH devs do not prioritize VALUE accretion to MAIN = Layer 1 = ETH."));
  assert.ok(page.includes("In our opinion, Solana (SOL) is Ethereum's top competitor.  Many other ALTS demonstrate a significant challenge to Ethereum's dominance. At 6:28 PM ET on November 1, 2026, Ethereum held about 10.6% of the total crypto market value (CoinGecko data)."));
  assert.ok(page.includes("All users MUST DO their OWN research.  All users should consider ALT Coins as speculative and consider any ALT Coin as capable of losing all funds."));
  assert.ok(page.includes("There is only one BITCOIN."));
});

test("official sources only for Robinhood Chain and the Solana posts; every new tab is noopener noreferrer", () => {
  assert.ok(page.includes('href="https://robinhood.com/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/"'));
  const xAccounts = [...new Set([...page.matchAll(/x\.com\/([A-Za-z0-9_]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(xAccounts, ["S1R1US_AI", "solana"]);
  for (const a of page.matchAll(/<a [^>]*target="_blank"[^>]*>/g)) assert.match(a[0], /rel="noopener noreferrer"/);
});

test("opinion and paper-only framing; no trading-signal, coming-soon or wallet wording", () => {
  assert.match(page, /We never sell and we never short\./);
  assert.match(page, /not financial, legal or tax advice/);
  assert.doesNotMatch(page, /coming soon|price target|buy signal|sell now|go short|\bshort ETH\b/i);
  assert.doesNotMatch(page, /\b(bc1|0x)[0-9a-z]{20,}/i);
  assert.doesNotMatch(page, /\/admin|\/api\/|desk-|github\.com\/S1R1US-AI\/(?!S1R1US-LaBs-public")/);
});

test("client script: read-only GETs to public market data, no cookies, text only, honest failure text", () => {
  const hosts = [...new Set([...js.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]))].sort();
  assert.deepEqual(hosts, ["api.coingecko.com", "api.exchange.coinbase.com"]);
  assert.match(js, /credentials: "omit"/);
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|method:\s*"(POST|PUT|DELETE)"/);
  assert.match(js, /dated snapshot/);
  assert.match(js, /live data unavailable/);
});

test("served by the front door with a slash redirect, listed in the sitemap with its own lastmod", () => {
  assert.ok(start.includes('"/btc-eth-sol"'));
  assert.ok(start.includes('"/btc-eth-sol/"'));
  assert.ok(start.includes('pathname === "/btc-eth-sol" || pathname.startsWith("/btc-eth-sol/")'));
  assert.match(nav, /path: "\/btc-eth-sol",\n {4}loc: `\$\{origin\}\/btc-eth-sol\/`,/);
  assert.ok(nav.includes('[`${origin}/btc-eth-sol/`]: "2026-11-18",'));
  assert.ok(read("front-door-static/sitemap/index.html").includes('<a href="/btc-eth-sol/"><strong>BTC vs ETH vs SOL</strong></a>'));
});
