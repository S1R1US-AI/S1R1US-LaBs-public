import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deskStoreFiles } from "./data-path.ts";

register(new URL("../../../scripts/test-ts-alias-hooks.mjs", import.meta.url));

// Private temp folder for this run, so shared data files are never touched.
const TMP = mkdtempSync(join(tmpdir(), "mcp-read-only-"));
process.env.NODE_ENV = "test";
process.env.DESK_TEST_DATA_DIR = TMP;
// No network in this test: a fixed exchange price, and every other lookup fails fast.
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/products/BTC-USD/ticker")) {
    return new Response(JSON.stringify({ price: "80000.00", bid: "79999.00", ask: "80001.00", volume: "100" }));
  }
  if (url.endsWith("/products/BTC-USD/stats")) {
    return new Response(JSON.stringify({ last: "80000.00", open: "79000.00", high: "81000.00", low: "78000.00", volume: "100" }));
  }
  throw new Error("network disabled in tests");
}) as typeof fetch;
// The price feed starts a background refresh loop; a mocked interval keeps it from holding the run open.
mock.timers.enable({ apis: ["setInterval"] });

function setGate(open: boolean) {
  const body = JSON.stringify({ externalAgents: open, closedAt: null, openedAt: null, inviteBatchAt: null, inviteCount: 0 });
  writeFileSync(join(TMP, "agent-gate.json"), body);
}

/** Every file in the private data folder with its contents, to prove nothing was written. */
function dataState() {
  const out: Record<string, string> = {};
  for (const n of readdirSync(TMP).sort()) {
    const p = join(TMP, n);
    out[n] = statSync(p).isFile() ? readFileSync(p, "utf8") : "dir";
  }
  return out;
}

type Proto = typeof import("./agent-protocol.ts");
type Gate = typeof import("./mcp-read-only.ts");
let proto: Proto;
let gate: Gate;
let allTools: string[];

before(async () => {
  proto = (await import("./agent-protocol.ts")) as Proto;
  gate = (await import("./mcp-read-only.ts")) as Gate;
  allTools = [...(await import("./agent-security.ts")).MCP_TOOLS];
  setGate(true);
});

after(() => {
  mock.timers.reset();
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(() => {
  setGate(true);
  proto.resetMcpWriteLimit();
});

function call(name: string, args: Record<string, unknown>, id: number) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

const writeArgs: Record<string, unknown> = { name: "read-only-test", kind: "other", mandate: true, token: "x", action: "ACCUMULATE", body: "Accumulate bitcoin." };

describe("the MCP endpoint answers read tools only", () => {
  it("the read list is exactly the 14 read tools, and every other tool is a write", () => {
    assert.equal(gate.MCP_READ_TOOLS.length, 14);
    for (const t of gate.MCP_READ_TOOLS) {
      assert.ok(allTools.includes(t), `${t} is a real tool`);
      assert.equal(proto.isMcpWriteTool(t), false, `${t} is not a write`);
    }
    for (const t of allTools) {
      assert.ok(gate.mcpToolOpen(t) !== proto.isMcpWriteTool(t), `${t} is either a read or a write, never both or neither`);
    }
    assert.ok(Object.isFrozen(gate.MCP_READ_TOOLS));
  });

  it("closes every write tool with the one-line reply, and writes nothing", async () => {
    const writes = allTools.filter((t) => !gate.mcpToolOpen(t));
    assert.equal(writes.length, 19);
    const before = dataState();
    let id = 1;
    for (const t of writes) {
      const res = await proto.handleMcpHttp(call(t, writeArgs, id), { ip: "203.0.113.101" });
      assert.equal(res.status, 200);
      const body = res.body as { id: number; error?: { code: number; message: string; data?: unknown }; result?: unknown };
      assert.equal(body.id, id, t);
      assert.equal(body.result, undefined, `${t} has no result`);
      assert.equal(body.error?.message, gate.MCP_CLOSED_MESSAGE, t);
      assert.equal(body.error?.code, -32000);
      assert.equal(body.error?.data, undefined, "the closed reply has no extra data");
      id++;
    }
    assert.deepEqual(dataState(), before, "no data file was created or changed");
  });

  it("closes unknown, empty, padded and differently cased names too", async () => {
    for (const t of ["", "board_list ", "BOARD_LIST", "Board_Register", "new_write_tool", "admin", "board_list\u200b"]) {
      const res = await proto.handleMcpHttp(call(t, {}, 7), { ip: "203.0.113.102" });
      assert.equal((res.body as { error?: { message: string } }).error?.message, gate.MCP_CLOSED_MESSAGE, JSON.stringify(t));
    }
    assert.equal(gate.mcpToolOpen(undefined), false);
    assert.equal(gate.mcpToolOpen({ toString: () => "board_list" }), false);
  });

  it("stays closed during maintenance, with no internal details", async () => {
    setGate(false);
    const res = await proto.handleMcpHttp(call("board_register", writeArgs, 3), { ip: "203.0.113.103" });
    const err = (res.body as { error?: { message: string; data?: unknown } }).error;
    assert.equal(err?.message, gate.MCP_CLOSED_MESSAGE);
    assert.equal(err?.data, undefined);
  });

  it("the closed reply names no tool, route or method", () => {
    const line = gate.MCP_CLOSED_MESSAGE;
    assert.equal(line, "This is read-only for now.");
    assert.doesNotMatch(line, /\/api|post|get|mcp|tool|register|tick/i);
    for (const t of allTools) assert.ok(!line.includes(t));
  });

  it("reading the board keeps its daily report and wager rounds in the private folder", async () => {
    const shared = [...deskStoreFiles("board-daily.json"), ...deskStoreFiles("board-wager.json")];
    const read = () =>
      shared.map((p) => {
        try {
          return readFileSync(p, "utf8");
        } catch {
          return null;
        }
      });
    const before = read();
    const res = await proto.handleMcpHttp(call("board_list", {}, 1), { ip: "203.0.113.103" });
    assert.ok((res.body as { result?: unknown }).result, "board_list answers");
    assert.deepEqual(read(), before, "shared board files are unchanged");
    assert.ok(readdirSync(TMP).includes("board-daily.json"), "the daily report went to the private folder");
  });

  it("read tools still answer, alone and in a batch with writes", async () => {
    for (const t of ["board_list", "forum_list", "cup_list", "hive_list", "go_live_notice", "connection_test"]) {
      const res = await proto.handleMcpHttp(call(t, {}, 1), { ip: "203.0.113.104" });
      const body = res.body as { result?: unknown; error?: { message: string } };
      assert.notEqual(body.error?.message, gate.MCP_CLOSED_MESSAGE, t);
      assert.ok(body.result, `${t} answers`);
    }
    const res = await proto.handleMcpHttp(
      [
        call("board_list", {}, 1),
        call("board_register", writeArgs, 2),
        call("forum_list", {}, 3),
        call("forum_post", writeArgs, 4),
        call("board_tick", writeArgs, 5),
      ],
      { ip: "203.0.113.105" },
    );
    const rows = res.body as { id: number; result?: unknown; error?: { message: string } }[];
    assert.equal(rows.length, 5);
    for (const r of rows) {
      if (r.id === 1 || r.id === 3) assert.ok(r.result, `read ${r.id} answers`);
      else assert.equal(r.error?.message, gate.MCP_CLOSED_MESSAGE, `write ${r.id} is closed`);
    }
  });

  it("a full batch of writes is all closed and never reaches the write limit", async () => {
    const batch = Array.from({ length: 8 }, (_, i) => call("board_tick", { token: "x", action: "ACCUMULATE" }, i + 1));
    const res = await proto.handleMcpHttp(batch, { ip: "203.0.113.106" });
    const rows = res.body as { error?: { message: string } }[];
    assert.equal(rows.filter((r) => r.error?.message === gate.MCP_CLOSED_MESSAGE).length, 8);
  });

  it("other MCP methods and the tool list are unchanged", async () => {
    const init = await proto.handleMcpHttp({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, {});
    assert.ok((init.body as { result?: unknown }).result);
    const list = await proto.handleMcpHttp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, {});
    assert.deepEqual((list.body as { result: { tools: unknown[] } }).result.tools, []);
  });
});

describe("odd request shapes get a clean reply, never a crash", () => {
  it("a tool name that is not text gets a 400 and runs nothing", async () => {
    const before = dataState();
    for (const name of [{ toString: 1 }, { toString: "board_list" }, {}, ["board_list"], ["board_tick"], null, 1, true]) {
      const res = await proto.handleMcpHttp({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: writeArgs } }, { ip: "203.0.113.105" });
      assert.equal(res.status, 400, JSON.stringify(name));
      const body = res.body as { id: number; error?: { code: number; message: string; data?: unknown }; result?: unknown };
      assert.equal(body.id, 9);
      assert.equal(body.result, undefined);
      assert.equal(body.error?.code, -32602);
      assert.equal(body.error?.message, "Invalid params.");
      assert.equal(body.error?.data, undefined);
    }
    const missing = await proto.handleMcpHttp({ jsonrpc: "2.0", id: 10, method: "tools/call", params: {} }, { ip: "203.0.113.105" });
    assert.equal(missing.status, 400);
    assert.deepEqual(dataState(), before, "no data file was created or changed");
  });

  it("in a batch, a bad name only fails its own item and the read still answers", async () => {
    const res = await proto.handleMcpHttp(
      [
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: { toString: 1 } } },
        call("board_list", {}, 2),
        call("board_tick", writeArgs, 3),
      ],
      { ip: "203.0.113.106" },
    );
    assert.equal(res.status, 200);
    const out = res.body as { id: number; error?: { code: number; message: string }; result?: unknown }[];
    assert.equal(out.length, 3);
    assert.equal(out[0].error?.code, -32602);
    assert.ok(out[1].result !== undefined && out[1].error === undefined);
    assert.equal(out[2].error?.message, gate.MCP_CLOSED_MESSAGE);
  });

  it("a method or protocol version that is not text does not crash", async () => {
    for (const method of [{ toString: 1 }, ["tools/call"], { toString: "tools/call" }]) {
      const res = await proto.handleMcpHttp({ jsonrpc: "2.0", id: 4, method, params: { name: "board_tick", arguments: writeArgs } }, { ip: "203.0.113.107" });
      const body = res.body as { error?: { code: number }; result?: unknown };
      assert.equal(body.result, undefined, JSON.stringify(method));
      assert.equal(body.error?.code, -32601, JSON.stringify(method));
    }
    const init = await proto.handleMcpHttp({ jsonrpc: "2.0", id: 5, method: "initialize", params: { protocolVersion: { toString: 1 } } }, { ip: "203.0.113.107" });
    assert.equal(init.status, 200);
    assert.equal((init.body as { result?: { protocolVersion?: string } }).result?.protocolVersion, "2025-03-26");
  });

});

describe("the site's REST board and forum routes are unchanged", () => {
  const restReq = (path: string, ip: string, method: "GET" | "POST", body?: unknown, extra: Record<string, string> = {}) =>
    Object.assign(
      new Request(`https://example.test${path}`, {
        method,
        headers: {
          accept: "application/json",
          "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
          "do-connecting-ip": ip,
          ...(body ? { "content-type": "application/json" } : {}),
          ...extra,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      { runtime: { node: { req: { socket: { remoteAddress: "127.0.0.1" } } } } },
    );
  type Handlers = Record<string, (ctx: { request: Request }) => Promise<Response> | Response>;
  const handlers = async (p: string) =>
    ((await import(p)) as { Route: { options: { server: { handlers: Handlers } } } }).Route.options.server.handlers;

  it("board register, tick, profile read and list work over REST", async () => {
    const h = await handlers("../../routes/api/agent.board.ts");
    const reg = await h.POST!({ request: restReq("/api/agent/board", "198.51.100.201", "POST", { op: "register", name: "rest-board-test", kind: "other", mandate: true }) });
    const regBody = (await reg.json()) as { ok?: boolean; token?: string };
    assert.equal(reg.status, 200, JSON.stringify(regBody));
    assert.equal(typeof regBody.token, "string");
    const tick = await h.POST!({
      request: restReq("/api/agent/board", "198.51.100.202", "POST", { op: "tick", token: regBody.token, action: "ACCUMULATE" }),
    });
    const tickBody = (await tick.json()) as { ok?: boolean };
    assert.equal(tick.status, 200, JSON.stringify(tickBody));
    assert.equal(tickBody.ok, true);
    const me = await h.POST!({ request: restReq("/api/agent/board", "198.51.100.203", "POST", { op: "me", token: regBody.token }) });
    assert.equal(me.status, 200);
    const list = await h.GET!({ request: restReq("/api/agent/board", "198.51.100.204", "GET") });
    assert.equal(list.status, 200);
  });

  it("forum post and list work over REST", async () => {
    const h = await handlers("../../routes/api/agent.forum.ts");
    const post = await h.POST!({
      request: restReq("/api/agent/forum", "198.51.100.211", "POST", {
        name: "rest-forum-test",
        kind: "other",
        mandate: true,
        body: "Accumulate bitcoin. Never sell. Never short. Paper L3AD3R B0ARD.",
      }),
    });
    const postBody = (await post.json()) as { ok?: boolean };
    assert.equal(post.status, 200, JSON.stringify(postBody));
    assert.equal(postBody.ok, true);
    const list = await h.GET!({ request: restReq("/api/agent/forum", "198.51.100.212", "GET") });
    assert.equal(list.status, 200);
  });

  it("only the MCP request handler uses the read list", () => {
    const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    for (const p of [
      "../../routes/api/agent.board.ts",
      "../../routes/api/agent.forum.ts",
      "../../routes/api/agent.hive.ts",
      "../../routes/api/agent.waitlist.ts",
      "./agent-limit.ts",
      "../../components/mobile-app-page.tsx",
    ]) {
      assert.doesNotMatch(src(p), /mcp-read-only|mcpToolOpen|MCP_CLOSED_MESSAGE/, p);
    }
    const protoSrc = src("./agent-protocol.ts");
    const dispatch = protoSrc.slice(protoSrc.indexOf("export async function callMcpTool("), protoSrc.indexOf("async function handleMcpOne("));
    assert.ok(dispatch.length > 0);
    assert.doesNotMatch(dispatch, /mcpToolOpen/, "the shared tool dispatcher is not gated");
    const one = protoSrc.slice(protoSrc.indexOf("async function handleMcpOne("), protoSrc.indexOf("export async function handleMcp("));
    assert.match(one, /if \(!mcpToolOpen\(name\)\) return mcpErr\(id \?\? 0, -32000, MCP_CLOSED_MESSAGE\);\n\s+const args/);
  });
});
