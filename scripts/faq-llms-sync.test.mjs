// Keeps the React FAQ (FAQ_ITEMS -> FAQPage JSON-LD) and every deployed llms.txt copy in sync.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isUrl, textUrls } from "./lib/html-tokens.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const nav = read("src/lib/desk/public-nav.ts");
const html = read("front-door-static/faq/index.html");

test("FAQ_ITEMS carries the new static FAQ anchors in the same leading order", () => {
  for (const id of ["meet-the-humans", "contact-team", "book-dj-mo-funky", "future", "copyright-policy", "look-who-is-woke-now", "cosmic-c0d3", "newsletter", "escape-the-matrix", "global-uprisings"]) {
    assert.match(nav, new RegExp(`id: "${id}"`), `FAQ_ITEMS missing ${id}`);
    assert.match(html, new RegExp(`class="faq-item" id="${id}"`), `static FAQ missing ${id}`);
  }
  const order = ["meet-the-humans", "book-dj-mo-funky", "future", "copyright-policy", "look-who-is-woke-now"].map((id) => nav.indexOf(`id: "${id}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("all llms.txt copies are identical to public/llms.txt and point AI crawlers to the FAQ only", () => {
  const src = read("public/llms.txt");
  for (const p of ["public/.well-known/llms.txt", ".output/public/llms.txt", ".output/public/.well-known/llms.txt"]) {
    assert.equal(read(p), src, `${p} drifted from public/llms.txt`);
  }
  assert.match(src, /^# S1R1US\.ai\n/);
  assert.ok(src.includes("SAI Citizens United LTD"), "llms.txt names the operator");
  const urls = [...src.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]);
  assert.deepEqual(urls, ["https://s1r1us.ai/faq/"], "llms.txt links only the FAQ");
  assert.doesNotMatch(src, /\.well-known|\/api\/|\/admin|mcp|a2a|openapi|api key|token|webhook/i, "llms.txt has no endpoint, key or admin wording");
  assert.doesNotMatch(src, /pineal|third eye|art of war|the wizard|SAI Citizens United, LTD/i);
});

test("public/.well-known/llms.txt exists and matches public/llms.txt", () => {
  const wk = read("public/.well-known/llms.txt");
  assert.equal(wk, read("public/llms.txt"));
  assert.ok(textUrls(wk).some((u) => isUrl(u, "s1r1us.ai", "/faq/")), ".well-known/llms.txt points to the FAQ");
});

test("SEO follow-up: per-page lastmod, branded titles, trimmed descriptions, no ops wording, home links", () => {
  assert.doesNotMatch(nav, /SITEMAP_LASTMOD\b|\?\? lastmod/, "no default sitemap date");
  for (const [p, d] of [["copyright-terms/", '"2026-10-20"'], ["newsletter/", "SITEMAP_COMMIT_DATE"], ["cosmic-c0d3/", '"2026-10-16"']]) {
    assert.ok(nav.includes(`[\`\${origin}/${p}\`]: ${d},`), `lastmod missing ${p}`);
  }
  for (const [f, t] of [["terms", "Terms and Agreements"], ["privacy", "Privacy Policy"], ["sitemap", "Sitemap"]]) {
    assert.ok(read(`front-door-static/${f}/index.html`).includes(`<title>${t} · S1R1US.ai</title>`), `${f} title`);
  }
  for (const f of ["index.html", "roadmap/index.html", "copyright-terms/index.html", "terms/index.html", "sitemap/index.html"]) {
    const h = read(`front-door-static/${f}`);
    const d = h.match(/<meta name="description" content="([^"]*)"/)[1];
    assert.ok(d.length >= 120 && d.length <= 160, `${f} description length ${d.length}`);
  }
  for (const f of ["index.html", "copyright-terms/index.html"]) {
    assert.doesNotMatch(read(`front-door-static/${f}`), /Soft locks Present|Soft-Launch PARKED|SIM-locked/, f);
  }
  for (const f of ["images/S1R1US-AI-marketing.svg", "manifesto/manifesto.css", "roadmap/index.html", "sitemap/index.html"]) {
    assert.doesNotMatch(read(`front-door-static/${f}`), /Soft locks Present/, f);
  }
  assert.doesNotMatch(read("README.md"), /Soft locks Present/, "README.md");
  const home = read("front-door-static/index.html");
  assert.ok(home.includes('href="/cosmic-c0d3/"') && home.includes('href="/copyright-terms"'));
  for (const f of ["copyright-terms", "terms", "privacy", "sitemap"]) {
    const c = read(`front-door-static/${f}/index.html`).match(/rel="canonical" href="https:\/\/s1r1us\.ai([^"]*)"/)[1];
    assert.equal(c, `/${f}/`, `${f} canonical`);
  }
});
