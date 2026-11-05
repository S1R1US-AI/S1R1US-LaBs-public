import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../../scripts/test-ts-alias-hooks.mjs", import.meta.url));

type Mod = typeof import("./agent-write-switch.ts");
const mod = (await import("./agent-write-switch.ts")) as Mod;
const middleware = (await import("../../../server/middleware/agent-writes.ts")).default as (
  event: unknown,
  next: () => unknown,
) => Promise<unknown>;

const ENV = mod.AGENT_WRITES_ENV;
const WRITE_CASES: Array<[string, string, string?]> = [
  ["POST", "/api/agent/board"],
  ["POST", "/api/agent/forum"],
  ["POST", "/api/agent/hive"],
  ["POST", "/api/agent/waitlist"],
  ["POST", "/api/agent/mcp"],
  ["DELETE", "/api/agent/mcp"],
  ["PUT", "/api/agent/board"],
  ["PATCH", "/api/agent/forum"],
  ["POST", "/api/agent"],
  ["GET", "/api/agent/ping"],
  ["HEAD", "/api/agent/ping"],
  ["GET", "/api/agent/ping", "?peek=0"],
];
const READ_CASES: Array<[string, string, string?]> = [
  ["GET", "/api/agent"],
  ["GET", "/api/agent/call"],
  ["GET", "/api/agent/board"],
  ["GET", "/api/agent/forum"],
  ["GET", "/api/agent/mcp"],
  ["GET", "/api/agent/ping", "?peek=1"],
  ["OPTIONS", "/api/agent/board"],
  ["POST", "/search"],
  ["POST", "/api/auth/sign-in"],
  ["POST", "/api/agentx"],
];

describe("agent write switch: env parsing", () => {
  it("missing env is OFF", () => assert.equal(mod.agentWritesEnabled({}), false));
  it("'false' is OFF", () => assert.equal(mod.agentWritesEnabled({ [ENV]: "false" }), false));
  for (const bad of ["", " true", "true ", "TRUE", "True", "1", "yes", "on", "true\n", "\"true\""]) {
    it(`malformed ${JSON.stringify(bad)} is OFF`, () => assert.equal(mod.agentWritesEnabled({ [ENV]: bad }), false));
  }
  it("exactly 'true' is ON", () => assert.equal(mod.agentWritesEnabled({ [ENV]: "true" }), true));
  it("a throwing env reader is OFF", () => {
    const env = new Proxy({}, { get: () => { throw new Error("boom"); } }) as Record<string, string>;
    assert.equal(mod.agentWritesEnabled(env), false);
  });
});

describe("agent write switch: which requests are writes", () => {
  for (const [m, p, q] of WRITE_CASES) {
    it(`${m} ${p}${q ?? ""} is a write`, () => assert.equal(mod.isAgentWriteRequest(m, p, q ?? ""), true));
  }
  for (const [m, p, q] of READ_CASES) {
    it(`${m} ${p}${q ?? ""} is not gated`, () => assert.equal(mod.isAgentWriteRequest(m, p, q ?? ""), false));
  }
  for (const p of ["/API/Agent/Board", "//api//agent/board/", "/api/%61gent/board", "/api\\agent\\board"]) {
    it(`path variant ${p} still matches`, () => assert.equal(mod.isAgentWriteRequest("POST", p), true));
  }
});

describe("agent write switch: gate", () => {
  it("missing env blocks writes with 404", () => {
    assert.equal(mod.agentWriteGate("POST", "/api/agent/board", "", {})?.status, 404);
  });
  it("malformed env blocks writes with 404", () => {
    assert.equal(mod.agentWriteGate("POST", "/api/agent/forum", "", { [ENV]: "yes" })?.status, 404);
  });
  it("'false' blocks writes with 404", () => {
    assert.equal(mod.agentWriteGate("POST", "/api/agent/hive", "", { [ENV]: "false" })?.status, 404);
  });
  it("'true' lets writes through", () => {
    assert.equal(mod.agentWriteGate("POST", "/api/agent/board", "", { [ENV]: "true" }), null);
  });
  it("reads pass while off", () => {
    for (const [m, p, q] of READ_CASES) assert.equal(mod.agentWriteGate(m, p, q ?? "", {}), null);
  });
  it("404 body leaks nothing", async () => {
    const res = mod.agentWriteOffResponse();
    assert.equal(res.status, 404);
    const body = await res.text();
    assert.equal(body, "Not Found");
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    for (const h of res.headers.keys()) assert.ok(!/agent|write|switch|s1r1us/i.test(h), h);
    for (const word of [ENV, "agent", "write", "switch", "disabled", "enable", "env", "token", "auth", "403"]) {
      assert.ok(!body.toLowerCase().includes(word.toLowerCase()), word);
    }
  });
});

describe("agent write switch: CORS", () => {
  it("off: GET only", () => {
    assert.equal(mod.agentCorsMethods({}), "GET, OPTIONS");
    assert.equal(mod.agentCorsMethods({ [ENV]: "false" }), "GET, OPTIONS");
  });
  it("on: write methods allowed", () => {
    assert.match(mod.agentCorsMethods({ [ENV]: "true" }), /POST/);
  });
});

describe("agent write switch: middleware runs before auth and body parsing", () => {
  function trapEvent(method: string, url: string) {
    const touched: string[] = [];
    const headers = new Proxy(new Headers({ authorization: "Bearer x", "x-s1r1us-agent": "t" }), {
      get(target, prop) {
        touched.push(`headers.${String(prop)}`);
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const req = {
      method,
      headers,
      get body() {
        touched.push("body");
        throw new Error("body read");
      },
      json() {
        touched.push("json");
        throw new Error("json read");
      },
      text() {
        touched.push("text");
        throw new Error("text read");
      },
    };
    return { event: { url: new URL(url), req }, touched };
  }

  it("blocked write: 404, no handler, no header or body access", async () => {
    const prev = process.env[ENV];
    delete process.env[ENV];
    try {
      const { event, touched } = trapEvent("POST", "https://example.test/api/agent/board");
      let called = false;
      const out = await middleware(event, () => {
        called = true;
        return new Response("handler");
      });
      assert.ok(out instanceof Response);
      assert.equal((out as Response).status, 404);
      assert.equal(called, false);
      assert.deepEqual(touched, []);
    } finally {
      if (prev === undefined) delete process.env[ENV];
      else process.env[ENV] = prev;
    }
  });

  it("read passes through to the handler", async () => {
    const prev = process.env[ENV];
    delete process.env[ENV];
    try {
      const { event } = trapEvent("GET", "https://example.test/api/agent/call");
      const out = await middleware(event, () => new Response("handler"));
      assert.equal(await (out as Response).text(), "handler");
    } finally {
      if (prev === undefined) delete process.env[ENV];
      else process.env[ENV] = prev;
    }
  });

  it("'true' passes writes through to the handler", async () => {
    const prev = process.env[ENV];
    process.env[ENV] = "true";
    try {
      const { event } = trapEvent("POST", "https://example.test/api/agent/board");
      const out = await middleware(event, () => new Response("handler"));
      assert.equal(await (out as Response).text(), "handler");
    } finally {
      if (prev === undefined) delete process.env[ENV];
      else process.env[ENV] = prev;
    }
  });
});
