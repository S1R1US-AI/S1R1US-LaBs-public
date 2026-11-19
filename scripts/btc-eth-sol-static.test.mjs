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

function attr(tag, name) {
  const needle = name + '="';
  let from = 0;
  while (from < tag.length) {
    const start = tag.indexOf(needle, from);
    if (start < 0) return undefined;
    if (start === 0 || /\s/.test(tag[start - 1])) {
      const open = start + needle.length;
      const end = tag.indexOf('"', open);
      if (end < 0) return undefined;
      return tag.slice(open, end);
    }
    from = start + 1;
  }
  return undefined;
}
function tags(html, name) {
  const open = "<" + name;
  const out = [];
  let i = 0;
  while (i < html.length) {
    const start = html.indexOf(open, i);
    if (start < 0) break;
    const after = html[start + open.length] || "";
    if (after && after !== " " && after !== "\t" && after !== "\n" && after !== "/" && after !== ">") {
      i = start + open.length;
      continue;
    }
    const end = html.indexOf(">", start);
    if (end < 0) break;
    out.push(html.slice(start, end + 1));
    i = end + 1;
  }
  return out;
}

function num(v) {
  var n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function closes(rows, days) {
  if (!Array.isArray(rows) || days < 1) return [];
  var pts = rows
    .filter(function (r) { return Array.isArray(r) && num(r[0]) && num(r[4]); })
    .map(function (r) { return { t: Number(r[0]), c: Number(r[4]) }; })
    .sort(function (a, b) { return a.t - b.t; });
  if (pts.length < 2) return [];
  var newest = pts[pts.length - 1];
  var need = days * 86400;
  var slack = 86400;
  var target = newest.t - need;
  var start = null;
  var i;
  for (i = 0; i < pts.length - 1; i++) {
    var p = pts[i];
    var off = p.t - target;
    if (off < -slack || off > slack) continue;
    if (!start) {
      start = p;
      continue;
    }
    var startOff = start.t - target;
    var closer = Math.abs(off) < Math.abs(startOff);
    var sameAndLater = Math.abs(off) === Math.abs(startOff) && p.t > start.t;
    if (closer || sameAndLater) start = p;
  }
  if (!start) return [];
  var span = newest.t - start.t;
  if (span < need - slack || span > need + slack) return [];
  var out = [];
  for (i = 0; i < pts.length; i++) {
    if (pts[i].t >= start.t && pts[i].t <= newest.t) out.push(pts[i].c);
  }
  return out.length >= 2 ? out : [];
}
function squash(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").replace(/\s+/g, " ").trim();
}
function extractFn(src, name) {
  const begin = "function " + name + "(";
  const start = src.indexOf(begin);
  assert.ok(start >= 0, name + " present");
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  assert.fail("unterminated " + name);
}


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
  assert.equal(ld["@type"], "SatiricalArticle");
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
  assert.match(js, /AbortController/);
  assert.match(js, /signal: ac\.signal/);
  assert.match(js, /REQUEST_MS/);
  assert.match(js, /days \* 86400/);
  assert.match(js, /var slack = 86400/);
  assert.doesNotMatch(js, /newest - need - slack/);
  assert.match(js, /ethbtc-history/);
  assert.match(js, /soleth-history/);
});

test("closes() compares the last close to the close 30 days earlier, and slack never widens a complete history", () => {
  assert.equal(squash(extractFn(js, "num")), squash(num.toString()));
  assert.equal(squash(extractFn(js, "closes")), squash(closes.toString()));
  assert.match(js, /var slack = 86400/);
  assert.doesNotMatch(js, /newest - need - slack/);

  const newest = 1700000000;
  const step = 86400;
  const long = [];
  let d;
  for (d = 0; d <= 40; d++) long.push(100 + d);

  function rowsFrom(values, skipDaysAgo) {
    const out = [];
    let i;
    for (i = 0; i < values.length; i++) {
      const daysAgo = values.length - 1 - i;
      if (skipDaysAgo != null && daysAgo === skipDaysAgo) continue;
      const t = newest - daysAgo * step;
      const c = values[i];
      out.push([t, c, c, c, c, 1]);
    }
    return out;
  }

  const full = closes(rowsFrom(long), 30);
  assert.equal(full.length, 31);
  assert.equal(full[0], long[long.length - 1 - 30]);
  assert.equal(full[full.length - 1], long[long.length - 1]);

  const exact = long.slice(10);
  assert.deepEqual(closes(rowsFrom(exact), 30), exact);

  const missing30 = closes(rowsFrom(long, 30), 30);
  assert.equal(missing30[0], long[long.length - 1 - 29]);
  assert.equal(missing30[missing30.length - 1], long[long.length - 1]);

  const only31 = [];
  for (d = 40; d >= 0; d--) {
    if (d === 30 || d === 29) continue;
    const t = newest - d * step;
    const c = 200 + d;
    only31.push([t, c, c, c, c, 1]);
  }
  const got31 = closes(only31, 30);
  assert.equal(got31[0], 231);
  assert.equal(got31[got31.length - 1], 200);

  const only28 = [];
  for (d = 28; d >= 0; d--) {
    const t = newest - d * step;
    const c = 50 + d;
    only28.push([t, c, c, c, c, 1]);
  }
  assert.deepEqual(closes(only28, 30), []);
  assert.deepEqual(closes(rowsFrom(long.slice(-16)), 30), []);
  assert.deepEqual(closes([], 30), []);
  assert.deepEqual(closes([[newest, 1, 1, 1, 10, 1]], 30), []);
  assert.deepEqual(closes(rowsFrom(long), 0), []);
});


test("served by the front door with a slash redirect, listed in the sitemap with its own lastmod", () => {
  assert.ok(start.includes('"/btc-eth-sol"'));
  assert.ok(start.includes('"/btc-eth-sol/"'));
  assert.ok(start.includes('pathname === "/btc-eth-sol" || pathname.startsWith("/btc-eth-sol/")'));
  assert.match(nav, /path: "\/btc-eth-sol",\n {4}loc: `\$\{origin\}\/btc-eth-sol\/`,/);
  assert.ok(nav.includes('[`${origin}/btc-eth-sol/`]: "2026-11-18",'));
  assert.ok(read("front-door-static/sitemap/index.html").includes('<a href="/btc-eth-sol/"><strong>BTC vs ETH vs SOL</strong></a>'));
});

test("the page does not link to a Solana flip FAQ answer that is not on this site", () => {
  assert.doesNotMatch(page, /faq-sol-flip-eth/);
});

test("hero image (webp with jpg fallback) and the page's own share image, with the approved alt text", () => {
  const alt = "BTC vs ETH vs SOL: Bitcoin, Ethereum and Solana coins linked on a trading desk with price charts.";
  const og = "https://s1r1us.ai/images/btc-eth-sol/btc-vs-eth-vs-sol-og.jpg";
  const source = tags(page, "source").find((t) => attr(t, "srcset") === "/images/btc-eth-sol/btc-vs-eth-vs-sol-hero.webp");
  assert.ok(source, "hero webp source");
  assert.equal(attr(source, "type"), "image/webp");
  const img = tags(page, "img").find((t) => attr(t, "src") === "/images/btc-eth-sol/btc-vs-eth-vs-sol-hero.jpg");
  assert.ok(img, "hero jpg img");
  assert.equal(attr(img, "width"), "1600");
  assert.equal(attr(img, "height"), "900");
  assert.equal(attr(img, "alt"), alt);
  const metas = tags(page, "meta");
  const meta = (key, value) =>
    metas.find((t) => (attr(t, "property") === key || attr(t, "name") === key) && attr(t, "content") === value);
  assert.ok(meta("og:image", og), "og:image");
  assert.ok(meta("twitter:image", og), "twitter:image");
  assert.ok(meta("og:image:alt", alt), "og:image:alt");
  assert.ok(meta("twitter:image:alt", alt), "twitter:image:alt");
  assert.doesNotMatch(page, /sai-citizens-united-faq-og/);
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.image.url, og);
  for (const n of ["btc-vs-eth-vs-sol-hero.webp", "btc-vs-eth-vs-sol-hero.jpg", "btc-vs-eth-vs-sol-og.jpg"]) {
    assert.ok(readFileSync(new URL(`../front-door-static/images/btc-eth-sol/${n}`, import.meta.url)).length > 0, n);
  }
});

test("satire label is visible near the top and in the not-advice copy, and Bitcoin is king", () => {
  const main = page.split('<main class="bes">')[1];
  assert.ok(main.indexOf('class="bes-satire"') >= 0 && main.indexOf('class="bes-satire"') < main.indexOf("<h1"));
  assert.match(page, /This page is satire, because Bitcoin is king\./);
  assert.match(page, /This page is also satire: Bitcoin is king/);
  assert.match(page, /"genre": "Satire"/);
});

test("Vitalik Buterin quotes: each links to his blog, verbatim lines kept, and no endorsement is implied", () => {
  const sec = page.split('id="vitalik-buterin-quotes"')[1].split("</section>")[0];
  const quotes = sec.split('<blockquote class="bes-quote"').slice(1);
  assert.equal(quotes.length, 11);
  for (const q of quotes) {
    assert.match(q, /cite="https:\/\/vitalik\.eth\.limo\/general\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9_]+\.html"/);
    assert.match(q, /<footer>Vitalik Buterin, <a href="https:\/\/vitalik\.eth\.limo\/general\//);
  }
  assert.ok(sec.includes("Bitcoin is trying to solve one problem, or at most two or three. Ethereum, on the other hand, has lots of sub-communities with lots of different focuses. There is no single dominant narrative."));
  assert.ok(sec.includes("The profound benefit of the Ethereum rollup-centric roadmap is that it means that Ethereum is open to all of the futures, and does not have to commit to an opinion about which one will necessarily win."));
  assert.match(sec, /He has no connection to S1R1US\.ai and does not endorse this page or our opinions\./);
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  for (const c of ld.citation) assert.ok(sec.includes(c.url), c.url);
});

test("Br0k3n S0ft on Vitalik keeps the opinion framing and the page closes on a Br0k3n S0ft line", () => {
  const sec = page.split('id="br0k3n-s0ft-on-vitalik"')[1].split("</section>")[0];
  assert.ok(sec.includes("The ETH roadmap, as we see it, is literal spaghetti code, and there is no end in sight to the circular nature of ETH development."));
  assert.ok(sec.includes("On Vitalik Buterin: in our view, he lacked the leadership and vision of a true warrior in an arena of gladiators."));
  const main = page.split('<main class="bes">')[1].split("</main>")[0];
  const last = main.slice(main.lastIndexOf("<section"));
  assert.match(last, /id="bitcoin-is-king"/);
  assert.match(last, /<footer>Br0k3n S0ft, November 17, 2026<\/footer>/);
});

test("flippening tracker reads the same CoinGecko market values and fails honestly", () => {
  assert.match(page, /<meter id="bes-flip-meter" min="0" max="100" value="0"/);
  assert.match(js, /function flip\(eth, btc\)/);
  assert.match(js, /flip\(eth, btc\);/);
  assert.match(js, /set\("bes-flip-share", "Live data unavailable"\)/);
});

test("earlier FAQ snapshots are kept with their dates and sources", () => {
  assert.ok(page.includes("11:07 AM ET, October 30, 2026: Ethereum's market value was about 4.9 times Solana's, so Solana was worth roughly 20% of Ethereum (CoinGecko data)."));
});
