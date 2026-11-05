import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MCP_TOOLS } from "./agent-security.ts";

const legalSrc = readFileSync(new URL("../../lib/legal.ts", import.meta.url), "utf8");
const thesisSrc = readFileSync(new URL("./thesis.ts", import.meta.url), "utf8");
const llms = readFileSync(new URL("../../../public/llms.txt", import.meta.url), "utf8");
// The public FAQ page AI crawlers are allowed to read (llms.txt now points only here).
const staticFaq = readFileSync(new URL("../../../front-door-static/faq/index.html", import.meta.url), "utf8");
const faqSrc = readFileSync(new URL("./public-nav.ts", import.meta.url), "utf8");

const termIds = new Set([...legalSrc.matchAll(/\bid: "([^"]+)"/g)].map((m) => m[1]));

describe("Terms and Privacy cover every public function", { concurrency: false }, () => {
  it("names championship, hive, lock, tape, agents, saas, FinCEN, WAF, morning, mandate, sim, lab", () => {
    for (const id of [
      "desk",
      "wager",
      "callout",
      "hive",
      "byo",
      "lock3d",
      "roadmap",
      "wallet",
      "bowl",
      "cup",
      "forum",
      "tape",
      "pred",
      "pred-book",
      "pred-live",
      "agents-api",
      "saas",
      "fincen",
      "waf",
      "morning",
      "edu",
      "mandate",
      "sim",
      "lab",
      "gifts",
      "store",
      "twofa",
      "cookies",
      "ugc",
      "children",
      "retention",
      "white-label",
    ]) {
      assert.equal(termIds.has(id), true, `missing legal section ${id}`);
    }
  });

  it("FAQ #terms and #privacy exist", () => {
    assert.match(faqSrc, /id: "terms"/);
    assert.match(faqSrc, /id: "privacy"/);
    assert.match(faqSrc, /id: "disclaimer"/);
    assert.match(faqSrc, /NO LEGAL FEES/);
  });

  it("never offers a security, never hive withdraw, never lock_set, never Coinbase create on this host", () => {
    assert.match(legalSrc, /offer to sell/);
    assert.match(legalSrc, /No offer of securities/);
    assert.match(legalSrc, /step s8/);
    assert.match(legalSrc, /LOCKED/);
    assert.match(legalSrc, /there is no lock_set/);
    assert.match(legalSrc, /Practice never arms Coinbase/);
    assert.match(legalSrc, /never sell bitcoin/i);
    assert.equal(MCP_TOOLS.has("hive_withdraw"), false);
    assert.equal(MCP_TOOLS.has("lock_set"), false);
    assert.equal(MCP_TOOLS.has("orders_create"), false);
  });

  it("spells Quant correctly in legal, thesis, and the public FAQ", () => {
    for (const [name, src] of [
      ["legal.ts", legalSrc],
      ["thesis.ts", thesisSrc],
      ["faq/index.html", staticFaq],
    ] as const) {
      assert.equal(/Qunat|quan t|Quantsy/i.test(src), false, name);
      assert.match(src, /Quant/);
    }
  });

  it("thesis and the public FAQ fold the legal update", () => {
    assert.match(thesisSrc, /Terms, Privacy, and operator-facing functions/);
    assert.match(thesisSrc, /Terms and Agreements \(\/terms\)/);
    assert.match(staticFaq, /id="terms"/);
    assert.match(staticFaq, /id="privacy"/);
    assert.match(staticFaq, /id="disclaimer"/);
    assert.match(staticFaq, /NO LEGAL FEES/);
    assert.match(llms, /https:\/\/s1r1us\.ai\/faq\//);
  });

  it("banner disclaimer uses unified LEGAL_DISCLAIMER; Terms and Privacy pages stay as published", () => {
    const discSrc = readFileSync(new URL("./disclaimer.ts", import.meta.url), "utf8");
    const shellSrc = readFileSync(new URL("../../components/shell.tsx", import.meta.url), "utf8");
    const barSrc = readFileSync(new URL("../../components/legal-bar.tsx", import.meta.url), "utf8");
    assert.match(legalSrc, /LEGAL_DISCLAIMER/);
    assert.match(discSrc, /NO LEGAL FEES/);
    assert.doesNotMatch(discSrc, /ZERO legal fees/);
    assert.match(shellSrc, /id="disclaimer"/);
    assert.match(shellSrc, /DisclaimerExpandBody/);
    assert.doesNotMatch(shellSrc, /LEGAL_NFA/);
    assert.doesNotMatch(shellSrc, /LEGAL_OWN_RISK/);
    assert.doesNotMatch(shellSrc, /LEGAL_BOTS/);
    assert.doesNotMatch(barSrc, /ZERO legal fees/);
    assert.match(barSrc, /LEGAL_DISCLAIMER_PARAS/);
    const termsStart = legalSrc.indexOf("export const TERMS_SECTIONS");
    const termsBlock = legalSrc.slice(termsStart);
    assert.doesNotMatch(termsBlock, /LEGAL_DISCLAIMER/);
    assert.doesNotMatch(termsBlock, /NO LEGAL FEES/);
  });
});
