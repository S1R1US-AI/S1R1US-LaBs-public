import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ARD_CATALOG_PATH,
  INSTRUCTIONS_MODULE,
  MCP_CARD_PATH,
  MCP_SERVER_CARD_PATH,
  ardCatalog,
  mcpServerCard,
} from "./agent-discovery.ts";
import { MCP_TOOLS } from "./agent-security.ts";

const llms = readFileSync(new URL("../../../public/llms.txt", import.meta.url), "utf8");
const robots = readFileSync(new URL("../../../public/robots.txt", import.meta.url), "utf8");
const faq = readFileSync(new URL("./public-nav.ts", import.meta.url), "utf8");
const sitemap = readFileSync(new URL("../../components/sitemap-page.tsx", import.meta.url), "utf8");
const graph = readFileSync(new URL("./search-graph.ts", import.meta.url), "utf8");
const thesis = readFileSync(new URL("./thesis.ts", import.meta.url), "utf8");
const legal = readFileSync(new URL("../../lib/legal.ts", import.meta.url), "utf8");

describe("agent discovery + instructions module", { concurrency: false }, () => {
  it("the public catalog and card give only name, read-only status, FAQ link, and mandate", () => {
    for (const out of [ardCatalog(), mcpServerCard()]) {
      assert.deepEqual(Object.keys(out).sort(), ["docs", "mandate", "name", "status"]);
      assert.equal(out.status, "read-only");
      assert.equal(out.docs, "https://s1r1us.ai/faq/");
      assert.match(out.mandate, /Paper simulation only/);
      assert.match(out.mandate, /Never sells bitcoin/);
      assert.match(out.mandate, /Never shorts bitcoin/);
      // No tool names, never-list, paths, header names, limits, or live state.
      assert.doesNotMatch(JSON.stringify(out), /_list|_call|lock_|orders|withdraw|\/api\/|\.well-known|x-s1r1us|rate|paused|gate|ops/i);
    }
    assert.equal(ARD_CATALOG_PATH, "/.well-known/ai-catalog.json");
    assert.equal(MCP_CARD_PATH, "/.well-known/mcp.json");
    assert.equal(MCP_SERVER_CARD_PATH, "/.well-known/mcp/server-card.json");
    // The read-only tool set itself is unchanged (still enforced server-side).
    assert.equal(MCP_TOOLS.has("lock_set"), false);
    assert.equal(MCP_TOOLS.has("orders_create"), false);
  });

  it("instructions module is public llms.txt, not /guide", () => {
    assert.equal(INSTRUCTIONS_MODULE.path, "/llms.txt");
    assert.equal(INSTRUCTIONS_MODULE.notGuide, true);
    assert.equal(INSTRUCTIONS_MODULE.googleSearchUsesLlmsTxt, false);
    assert.equal(INSTRUCTIONS_MODULE.googleSearchUsesSchemaOrg, true);
    // llms.txt is FAQ-only for AI crawlers: the site name, one line, and the FAQ link.
    assert.match(llms, /^# S1R1US\.ai\n/);
    assert.deepEqual([...llms.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]), ["https://s1r1us.ai/faq/"]);
    assert.doesNotMatch(llms, /\.well-known|\/api\/|\/guide|\/admin/);
  });

  it("robots.txt: search engines get the full site, AI crawlers get the FAQ only", () => {
    const groups: { agents: string[]; lines: string[] }[] = [];
    let cur: { agents: string[]; lines: string[] } | null = null;
    let lastAgent = false;
    for (const raw of robots.split("\n")) {
      const line = raw.replace(/#.*/, "").trim();
      if (!line) continue;
      const [k, ...v] = line.split(":");
      const key = k.trim().toLowerCase();
      const val = v.join(":").trim();
      if (key === "user-agent") {
        if (!lastAgent) groups.push((cur = { agents: [], lines: [] }));
        cur!.agents.push(val);
        lastAgent = true;
      } else {
        lastAgent = false;
        if (cur && (key === "allow" || key === "disallow")) cur.lines.push(`${key === "allow" ? "Allow" : "Disallow"}: ${val}`);
      }
    }
    const group = (ua: string) => groups.find((g) => g.agents.includes(ua));
    for (const ua of ["*", "Googlebot", "Bingbot"]) {
      const g = group(ua);
      assert.ok(g, `robots.txt has a ${ua} group`);
      assert.ok(g.lines.includes("Allow: /"), `${ua} keeps full access`);
      assert.ok(!g.lines.includes("Disallow: /"), `${ua} is not blocked`);
    }
    const ai = group("GPTBot");
    assert.ok(ai);
    for (const ua of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-Web", "Claude-User", "Claude-SearchBot", "anthropic-ai", "PerplexityBot", "Perplexity-User", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider", "Meta-ExternalAgent", "Meta-ExternalFetcher", "Meta-WebIndexer", "Amazonbot", "cohere-ai", "YouBot", "DuckAssistBot", "MistralAI-User", "MistralAI-Index", "MistralAI-Training", "Diffbot"]) {
      assert.ok(ai.agents.includes(ua), `${ua} is in the AI crawler group`);
    }
    assert.deepEqual(ai.lines, ["Allow: /faq$", "Allow: /faq/", "Allow: /llms.txt", "Disallow: /"]);
    assert.match(robots, /^Sitemap: https:\/\/s1r1us\.ai\/sitemap\.xml$/m);
    // robots.txt is public: it must not list private paths.
    assert.doesNotMatch(robots, /\/(admin|login|source|guide|security|launch|theme|renew|api\/auth)\b/);
  });

  it("FAQ, sitemap, schema, paper, thesis, and Terms fold discovery + sim", () => {
    assert.match(faq, /id: "instructions"/);
    assert.match(faq, /id: "live-sim"/);
    assert.match(faq, /id: "how-to-use"/);
    // sitemap.xml lists human pages only: no agent, API, card, or catalog URLs.
    const sitemapSrc = faq.slice(faq.indexOf("export const SITEMAP_PAGE_LASTMOD"), faq.indexOf("export const FAQ_ITEMS"));
    assert.ok(sitemapSrc.length > 0);
    assert.doesNotMatch(sitemapSrc, /SITEMAP_MACHINE|\/api\/agent|\.well-known|ai-catalog|llms\.txt|mcp|agent-card/);
    // The human sitemap lists human pages only, no agent or machine links.
    assert.doesNotMatch(sitemap, /SITEMAP_MACHINE|ai-catalog|mcp\.json|agent-card|llms\.txt/);
    assert.match(graph, /llms\.txt#instructions/);
    assert.match(graph, /llms\.txt#howto/);
    assert.match(graph, /TechArticle/);
    assert.match(thesis, /Agentic Resource Discovery/);
    assert.match(thesis, /as-live G M0D3 AUTO/);
    assert.match(thesis, /As-live G M0D3 AUTO/);
    assert.match(thesis, /Alignment Score/);
    assert.match(legal, /instructions module/);
    assert.match(legal, /as-live simulation/);
  });
});
