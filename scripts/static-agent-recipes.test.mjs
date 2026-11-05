import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Public static pages must not publish agent API routes or call recipes.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC_ROOT = join(ROOT, "front-door-static");
const TEXT_EXT = new Set([".html", ".htm", ".js", ".mjs", ".css", ".json", ".txt", ".xml", ".md", ".svg", ".webmanifest"]);

const BANNED = [
  { name: "agent API route", re: /\/api\/agent\b/i },
  { name: "well-known agent file", re: /\/\.well-known\/(?!llms\.txt\b|security\.txt\b)[\w.-]/i },
  { name: "agent header name", re: /\bx-s1r1us-[a-z-]+/i },
  { name: "board token prefix", re: /\bgb_/i },
  // Page copy only: client scripts use their own UPPER_CASE constants.
  { name: "server env var name", skipExt: [".js", ".mjs"], re: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:KEY|KEYS|KEY_HASHES|HASHES|TOKEN|TOKENS|SECRET|SECRETS)\b/ },
  { name: "agent tool name", re: /\b(?:board_register|bot7_call|forum_post|byo_connect|lock_status|lock_set)\b/i },
  { name: "request body field", re: /["']?mandate["']?\s*:\s*true\b|\{\s*["']?op["']?\s*:/i },
  { name: "write request recipe", re: /\b(?:POST|PUT|PATCH|DELETE)\s+(?:https?:\/\/\S+)?\/api\//i },
  { name: "curl write recipe", re: /\bcurl\b[^\n]*-X\s*(?:POST|PUT|PATCH|DELETE)\b/i },
];

function walk(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (TEXT_EXT.has(extname(ent.name).toLowerCase())) out.push(p);
  }
  return out;
}

// Scan whole file text so a request body split across lines is still caught.
export function scanText(text, ext = ".html") {
  const hits = [];
  for (const { name, re, skipExt } of BANNED) {
    if (skipExt?.includes(ext.toLowerCase())) continue;
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(g)) {
      const line = text.slice(0, m.index).split("\n").length;
      hits.push({ line, name });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

const files = walk(STATIC_ROOT);

test("front-door-static has text files to scan", () => {
  assert.ok(files.some((f) => f.endsWith("index.html")), "no static pages found");
});

test("front-door-static publishes no agent API routes or call recipes", () => {
  const hits = [];
  for (const file of files) {
    for (const h of scanText(readFileSync(file, "utf8"), extname(file))) hits.push(`${relative(ROOT, file)}:${h.line} ${h.name}`);
  }
  assert.deepEqual(hits, [], `agent recipes found on public static pages:\n${hits.join("\n")}`);
});

test("the scan catches known recipe shapes", () => {
  const samples = [
    "GET /api/agent/call",
    '<a href="https://s1r1us.ai/.well-known/mcp.json">',
    "-H \"x-s1r1us-agent: $TOKEN\"",
    "TOKEN=gb_your_token",
    "a hashed gb_ desk token",
    "A key in BOT7_FEED_KEY_HASHES",
    '{ "tool": "board_register" }',
    '{ "name": "a", "mandate": true }',
    "{op:join, token, ths}",
    "POST https://s1r1us.ai/api/other",
    "curl -sS -X POST https://example.test/x",
  ];
  for (const s of samples) assert.ok(scanText(s).length > 0, s);
  for (const ok of ["/.well-known/llms.txt", "Accept the mandate.", "API keys stay with you.", "/llms.txt"]) {
    assert.deepEqual(scanText(ok), [], ok);
  }
});

test("the scan catches a request body split across lines and reports its line", () => {
  const page = '<p>intro</p>\n<pre>{\n  "op": "join",\n  "ths": 1\n}</pre>\n<pre>{\n  "name": "a",\n  "mandate":\n    true\n}</pre>\n';
  const hits = scanText(page).filter((h) => h.name === "request body field");
  assert.deepEqual(hits.map((h) => h.line), [2, 8]);
});

test("client script constants are not flagged as server setting names", () => {
  assert.deepEqual(scanText("var INTRO_KEY = 'x';", ".js"), []);
  assert.ok(scanText("var INTRO_KEY = 'x';", ".html").length > 0);
});
