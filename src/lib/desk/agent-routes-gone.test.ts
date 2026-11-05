import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const at = (p: string) => join(ROOT, p);

const GONE_AGENT = ["app", "apple", "google", "siri", "a2a", "card", "claude", "openai", "grok", "openapi", "webmcp"];
const GONE_FILES = [
  ...GONE_AGENT.map((n) => `src/routes/api/agent.${n}.ts`),
  "src/routes/[.]well-known/apple-app-site-association.ts",
  "src/routes/[.]well-known/assetlinks[.]json.ts",
  "src/lib/desk/app-gateway.ts",
  "src/components/webmcp-bridge.tsx",
];
const GONE_PATH = new RegExp(`/api/agent/(?:${GONE_AGENT.join("|")})(?![\\w-])|apple-app-site-association|assetlinks`);

// Older prose and historical link lists that only mention the old paths as text.
const PROSE_ONLY = new Set([
  "src/lib/desk/guide.ts",
  "src/lib/launch/model.ts",
  "src/lib/desk/morning-ops.ts",
  "src/lib/desk/agent-routes-gone.test.ts",
]);
const TEXT = /\.(?:ts|tsx|js|mjs|cjs|json|html|txt|xml|md|webmanifest|css|sh|yml|yaml|sql|svg|toml)$/;
/** Folders walked for references (code, pages, static files, CI, migrations, docs). */
const TOPS = ["src", "server", "public", "front-door-static", "scripts", "docs", ".github", "migrations"];

/** True when the first bytes hold no NUL, so a file with no known extension is read as text. */
function looksLikeText(p: string): boolean {
  return !readFileSync(p).subarray(0, 8192).includes(0);
}

/**
 * Every text file at the repo root, with or without an extension (README, Dockerfile, startup.sh, LICENSE,
 * dotfiles, package files and so on); folders are walked separately.
 */
function rootFiles(): string[] {
  return readdirSync(ROOT)
    .map((name) => join(ROOT, name))
    .filter((p) => statSync(p).isFile() && looksLikeText(p));
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (TEXT.test(name) || (!/\.[^./]+$/.test(name.replace(/^\./, "")) && looksLikeText(p))) out.push(p);
  }
  return out;
}

describe("removed agent routes stay gone", () => {
  it("the route and helper files do not exist", () => {
    for (const f of GONE_FILES) assert.equal(existsSync(at(f)), false, f);
  });

  it("the generated route tree has none of the removed paths", () => {
    const tree = readFileSync(at("src/routeTree.gen.ts"), "utf8");
    assert.doesNotMatch(tree, GONE_PATH);
    assert.doesNotMatch(tree, /agent\.(?:app|apple|google|siri|a2a|card|claude|openai|grok|openapi|webmcp)['"]/);
  });

  it("no code, page, static file or crawler list links to a removed path", () => {
    const hits: string[] = [];
    for (const top of TOPS) {
      for (const p of walk(at(top))) {
        const rel = relative(ROOT, p).split("\\").join("/");
        if (rel === "src/routeTree.gen.ts" || PROSE_ONLY.has(rel)) continue;
        if (GONE_PATH.test(readFileSync(p, "utf8"))) hits.push(rel);
      }
    }
    for (const p of rootFiles()) {
      const rel = relative(ROOT, p);
      if (PROSE_ONLY.has(rel)) continue;
      if (GONE_PATH.test(readFileSync(p, "utf8"))) hits.push(rel);
    }
    assert.deepEqual(hits, []);
  });

  it("the main agent, MCP, board, forum, hive, waitlist and ping routes are still here", () => {
    assert.ok(existsSync(at("src/routes/api.agent.ts")), "api.agent");
    for (const n of ["agent.mcp", "agent.board", "agent.forum", "agent.hive", "agent.waitlist", "agent.ping"]) {
      assert.ok(existsSync(at(`src/routes/api/${n}.ts`)), n);
    }
  });
});

describe("the third-party transcript copies and the cost pack stay removed", () => {
  const GONE = [
    "src/lib/paper.ts",
    "src/components/report-app.tsx",
    ...[1, 2, 3].flatMap((n) => [`public/paper/page-${n}.jpg`, `public/paper/page-${n}-thumb.jpg`]),
    "public/video/ai-trading-bot-cost-library.zip",
    "public/video/ai-trading-bot-cost-rumble-split.mp4",
    "public/video/ai-trading-bot-cost-tiktok-desk.mp4",
    "public/video/ai-trading-bot-cost-tiktok-hud.mp4",
  ];
  const REF = /@\/lib\/paper["']|lib\/paper\.ts|report-app|ReportApp|\/paper\/page-\d|ai-trading-bot-cost|AI Trading Bot Cost|Institutional headcount stack/;
  const SELF = "src/lib/desk/agent-routes-gone.test.ts";

  it("the guard walks CI, migrations and every root text file", () => {
    const rels = new Set([...TOPS.flatMap((t) => walk(at(t))), ...rootFiles()].map((p) => relative(ROOT, p).split("\\").join("/")));
    for (const f of [".github/workflows/ci.yml", "Dockerfile", "startup.sh", "LICENSE"]) {
      if (existsSync(at(f))) assert.ok(rels.has(f), `${f} is checked`);
    }
    assert.ok([...rels].some((r) => r.startsWith("migrations/")), "migrations are checked");
  });

  it("the files do not exist and the original note keeps the route", () => {
    for (const f of GONE) assert.equal(existsSync(at(f)), false, f);
    assert.equal(existsSync(at("public/field-report.md")), true);
  });

  it("no code, page, sitemap, crawler list or test refers to them", () => {
    const hits: string[] = [];
    for (const top of TOPS) {
      for (const p of walk(at(top))) {
        const rel = relative(ROOT, p).split("\\").join("/");
        if (rel === SELF) continue;
        if (REF.test(readFileSync(p, "utf8"))) hits.push(rel);
      }
    }
    for (const p of rootFiles()) {
      if (REF.test(readFileSync(p, "utf8"))) hits.push(relative(ROOT, p));
    }
    assert.deepEqual(hits, []);
  });
});
