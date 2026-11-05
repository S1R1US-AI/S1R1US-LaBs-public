import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("../../../scripts/test-ts-alias-hooks.mjs", import.meta.url));

// Private temp files for this run, so the shared gate and bar files are never touched.
const TMP = mkdtempSync(join(tmpdir(), "mcp-write-gate-"));
const GATE_FILE = join(TMP, "agent-gate.json");
const BAR_FILE = join(TMP, "agent-bars.json");
process.env.NODE_ENV = "test";
process.env.DESK_TEST_DATA_DIR = TMP;

function setGate(open: boolean) {
  const body = JSON.stringify({ externalAgents: open, closedAt: null, openedAt: null, inviteBatchAt: null, inviteCount: 0 });
  writeFileSync(GATE_FILE, body);
}

type Proto = typeof import("./agent-protocol.ts");
let proto: Proto;

before(async () => {
  proto = (await import("./agent-protocol.ts")) as Proto;
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(() => {
  proto.resetMcpWriteLimit();
});

function call(name: string, args: Record<string, unknown>, id: number) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

describe("MCP writes get the request's IP and the maintenance gate", () => {
  it("blocks board writes during maintenance", async () => {
    setGate(false);
    const out = await proto.callMcpTool("board_register", { name: "gate-test", kind: "other", mandate: true }, { ip: "203.0.113.10" });
    assert.equal(out.ok, true);
    const data = (out as { data: { error?: string; ok?: boolean } }).data;
    assert.equal(data.ok, false);
    assert.equal(data.error, "maintenance");
    const tick = await proto.callMcpTool("board_tick", { token: "x", action: "ACCUMULATE" }, { ip: "203.0.113.10" });
    assert.equal((tick as { data: { error?: string } }).data.error, "maintenance");
  });

  it("keeps the forum list open during maintenance, like the REST route", async () => {
    setGate(false);
    const out = await proto.callMcpTool("forum_list", {}, { ip: "203.0.113.10" });
    assert.equal(out.ok, true);
    assert.notEqual((out as { data: { error?: string } }).data.error, "maintenance");
  });

  it("rate-limits writes per IP", async () => {
    setGate(true);
    const ip = "203.0.113.20";
    for (let i = 0; i < proto.MCP_WRITE_MAX; i++) {
      const out = await proto.callMcpTool("board_tick", { token: "not-a-token", action: "ACCUMULATE" }, { ip });
      assert.equal(out.ok, true, `call ${i} should pass the limiter`);
    }
    const blocked = await proto.callMcpTool("board_tick", { token: "not-a-token", action: "ACCUMULATE" }, { ip });
    assert.equal(blocked.ok, false);
    assert.match((blocked as { message: string }).message, /rate limited/i);
    const other = await proto.callMcpTool("board_tick", { token: "not-a-token", action: "ACCUMULATE" }, { ip: "203.0.113.21" });
    assert.equal(other.ok, true, "a different IP has its own limit");
  });

  it("a batch over HTTP can't make writes: the MCP endpoint is read-only", async () => {
    setGate(true);
    const batch = Array.from({ length: 6 }, (_, i) => call("board_tick", { token: "not-a-token", action: "ACCUMULATE" }, i + 1));
    const res = await proto.handleMcpHttp(batch, { ip: "203.0.113.30" });
    const rows = res.body as { error?: { message: string } }[];
    assert.equal(rows.filter((r) => r.error?.message === "This is read-only for now.").length, 6);
  });

  it("MCP with no request context is not treated as the local preview", async () => {
    setGate(true);
    for (let i = 0; i < proto.MCP_WRITE_MAX; i++) {
      await proto.callMcpTool("board_tick", { token: "not-a-token", action: "ACCUMULATE" });
    }
    const blocked = await proto.callMcpTool("board_tick", { token: "not-a-token", action: "ACCUMULATE" });
    assert.equal(blocked.ok, false);
  });

  it("a request with no forwarding info shares one limited bucket, not the preview", async () => {
    setGate(true);
    const { trustedRequestIp } = await import("./client-ip.ts");
    const ip = trustedRequestIp(new Request("https://example.test/api/agent/mcp", { method: "POST" }));
    assert.notEqual(ip, "local");
    for (let i = 0; i < proto.MCP_WRITE_MAX; i++) {
      await proto.callMcpTool("board_tick", { token: "not-a-token", action: "ACCUMULATE" }, { ip });
    }
    const blocked = await proto.callMcpTool("board_tick", { token: "not-a-token", action: "ACCUMULATE" }, { ip });
    assert.equal(blocked.ok, false);
    assert.match((blocked as { message: string }).message, /rate limited/i);
  });

  it("a request with no forwarding info is limited but never barred", async () => {
    setGate(true);
    const { isBarredIp, barAgent } = await import("./agent-bar.ts");
    barAgent({ name: "unknown-bar-test", ip: "unknown", reason: "test" });
    assert.equal(isBarredIp("unknown"), false);
    const { agentRateLimit } = await import("./agent-limit.ts");
    const req = () => new Request("https://example.test/api/agent/call", { headers: { "user-agent": "grok-test-agent" } });
    const codes = [agentRateLimit(req()), agentRateLimit(req()), agentRateLimit(req())].map((r) => r?.status ?? 200);
    assert.deepEqual(codes, [200, 200, 429]);
  });

  it("a bar saved with a full IPv6 address still matches that network", async () => {
    const { isBarredIp } = await import("./agent-bar.ts");
    const { trustedClientIp } = await import("./client-ip.ts");
    writeFileSync(
      BAR_FILE,
      JSON.stringify({
        rows: [{ id: "b1", at: "", name: "old", handle: null, kind: "other", ip: "2001:db8:0:7::7", reason: "old", forever: true }],
        strikes: {},
      }),
    );
    assert.equal(isBarredIp(trustedClientIp(new Headers({ "do-connecting-ip": "2001:db8:0:7::7" }), "127.0.0.1")), true);
    assert.equal(isBarredIp(trustedClientIp(new Headers({ "do-connecting-ip": "2001:db8:0:8::7" }), "127.0.0.1")), false);
    assert.equal(isBarredIp("198.51.100.5"), false);
  });

  it("reads are not counted against the write limit", async () => {
    setGate(true);
    for (let i = 0; i < proto.MCP_WRITE_MAX + 3; i++) {
      const out = await proto.callMcpTool("forum_list", {}, { ip: "203.0.113.40" });
      assert.equal(out.ok, true);
    }
    assert.equal(proto.isMcpWriteTool("forum_list"), false);
    assert.equal(proto.isMcpWriteTool("forum_post"), true);
  });
});

describe("every route reads the client IP from the request, not only the headers", () => {
  const peerReq = (headers: Record<string, string>, addr?: string) =>
    Object.assign(new Request("https://example.test/api/agent/board", { headers }), {
      runtime: addr ? { node: { req: { socket: { remoteAddress: addr } } } } : undefined,
    });

  it("the request helper uses the socket peer unless it is a trusted proxy", async () => {
    const { trustedRequestIp } = await import("./client-ip.ts");
    assert.equal(trustedRequestIp(peerReq({}, "198.51.100.21")), "198.51.100.21");
    assert.equal(trustedRequestIp(peerReq({ "x-forwarded-for": "1.2.3.4" }, "198.51.100.21")), "198.51.100.21");
    assert.equal(trustedRequestIp(peerReq({ "do-connecting-ip": "203.0.113.5" }, "198.51.100.21")), "198.51.100.21");
    assert.equal(trustedRequestIp(peerReq({ "do-connecting-ip": "203.0.113.5" }, "127.0.0.1")), "203.0.113.5");
    assert.equal(trustedRequestIp(peerReq({})), "unknown");
  });

  it("no headers is not the exempt local preview outside development, or with a real peer", async () => {
    const { trustedRequestIp } = await import("./client-ip.ts");
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      assert.equal(trustedRequestIp(peerReq({})), "unknown");
      assert.equal(trustedRequestIp(peerReq({}, "127.0.0.1")), "unknown");
      process.env.NODE_ENV = "development";
      assert.equal(trustedRequestIp(peerReq({}, "198.51.100.22")), "198.51.100.22");
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("the board, forum, hive and waitlist routes pass the request through", async () => {
    const { readFileSync } = await import("node:fs");
    const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    for (const p of [
      "../../routes/api/agent.board.ts",
      "../../routes/api/agent.forum.ts",
      "../../routes/api/agent.hive.ts",
      "../../routes/api/agent.waitlist.ts",
    ]) {
      const s = src(p);
      assert.match(s, /trustedRequestIp\(request\)/, p);
      assert.doesNotMatch(s, /clientIpFromHeaders/, p);
    }
  });
});

describe("MCP writes always use the request's own address for bars", () => {
  const BARRED = "198.51.100.61";
  const barOnly = (ip: string) =>
    writeFileSync(
      BAR_FILE,
      JSON.stringify({ rows: [{ id: "b61", at: "", name: "bar-test", handle: null, kind: "other", ip, reason: "test", forever: true }], strikes: {} }),
    );
  const blocked = (out: unknown) => {
    const o = out as { ok: boolean; data?: { blocked?: boolean } };
    return o.data?.blocked === true;
  };

  it("a barred caller stays blocked on waitlist_register with the address left out or faked", async () => {
    setGate(true);
    barOnly(BARRED);
    const args = { name: "waitlist-bar-test", kind: "other", mandate: true };
    assert.equal(blocked(await proto.callMcpTool("waitlist_register", args, { ip: BARRED })), true);
    assert.equal(blocked(await proto.callMcpTool("waitlist_register", { ...args, ip: "203.0.113.99" }, { ip: BARRED })), true);
    assert.equal(blocked(await proto.callMcpTool("waitlist_register", { ...args, ip: "local" }, { ip: BARRED })), true);
  });

  it("an address sent in the arguments is ignored on waitlist_register", async () => {
    setGate(true);
    barOnly(BARRED);
    const out = await proto.callMcpTool("waitlist_register", { name: "waitlist-clean-test", kind: "other", mandate: true, ip: BARRED }, { ip: "203.0.113.62" });
    assert.equal(blocked(out), false);
    assert.equal(out.ok, true);
  });

  it("a caller barred by an earlier write cannot make later writes", async () => {
    setGate(true);
    writeFileSync(BAR_FILE, JSON.stringify({ rows: [], strikes: {} }));
    const ip = "198.51.100.63";
    await proto.callMcpTool("forum_post", { name: "batch-bar-test", kind: "other", mandate: true, body: "Everyone should sell all your bitcoin right now." }, { ip });
    const { isBarredIp } = await import("./agent-bar.ts");
    assert.equal(isBarredIp(ip), true, "the forum post bars the caller");
    const second = await proto.callMcpTool("board_register", { name: "batch-bar-test-2", kind: "other", mandate: true }, { ip });
    assert.equal((second as { data?: { blocked?: boolean } }).data?.blocked, true, "the next write is blocked");
  });
});

describe("shared ingress addresses (rotating platform hops)", () => {
  const ROTATING = ["10.244.0.17", "172.16.4.4", "192.168.7.7", "100.64.3.3", "fd00::17", "fe80::9"];

  it("an ingress address is never barred", async () => {
    const { barAgent, isBarredIp } = await import("./agent-bar.ts");
    for (const [i, peer] of ROTATING.entries()) {
      barAgent({ name: `ingress-bar-${i}`, ip: peer, reason: "test" });
      assert.equal(isBarredIp(peer), false, peer);
    }
  });

  it("one visitor behind rotating ingress addresses gets one limit bucket", async () => {
    const DO_START: string = "../../../scripts/do-start.mjs";
    const { upstreamHeaders, trustedProxyList } = await import(DO_START);
    const { agentRateLimit } = await import("./agent-limit.ts");
    const { trustedRequestIp } = await import("./client-ip.ts");
    const list = trustedProxyList("");
    const codes: number[] = [];
    const keys = new Set<string>();
    for (let i = 0; i < 12; i++) {
      // Private and public hops, a different one on every request.
      const peer = i % 2 ? `10.244.${i}.${(i * 7) % 250}` : `164.90.${i}.${(i * 3) % 250}`;
      const fwd = upstreamHeaders(
        { headers: { "do-connecting-ip": "203.0.113.61", "user-agent": "Mozilla/5.0 ingress-test" }, socket: { remoteAddress: peer } },
        list,
      ) as Record<string, string>;
      delete fwd.host;
      const app = Object.assign(new Request(`https://example.test/api/agent/notices?n=${i}`, { headers: fwd }), {
        runtime: { node: { req: { socket: { remoteAddress: "127.0.0.1" } } } },
      });
      keys.add(trustedRequestIp(app));
      codes.push(agentRateLimit(app)?.status ?? 200);
    }
    assert.deepEqual([...keys], ["203.0.113.61"], "same key on every request");
    assert.ok(codes.slice(0, 8).every((c) => c === 200), `first 8 allowed: ${codes}`);
    assert.equal(codes[8], 429, `limited by request 9: ${codes}`);
  });

  it("a public ingress hop is never the key either", async () => {
    const DO_START: string = "../../../scripts/do-start.mjs";
    const { visitorAddress, trustedProxyList } = await import(DO_START);
    const list = trustedProxyList("");
    const h = { "do-connecting-ip": "203.0.113.61" };
    // Live, the hop changed on every request; keying on it gave one key per request and no limit.
    const peers = ["164.90.1.1", "164.90.1.2", "164.90.7.3", "10.244.0.1", "2604:a880::1"];
    assert.deepEqual([...new Set(peers.map((p) => visitorAddress(h, p, list)))], ["203.0.113.61"], "one key per visitor");
  });

});
