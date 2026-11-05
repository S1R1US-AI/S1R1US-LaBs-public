import { describe, it } from "node:test";
import http from "node:http";
import { networkInterfaces } from "node:os";
import assert from "node:assert/strict";
import {
  isTrustedProxy,
  limitKey,
  normalizeIp,
  parseCidr,
  socketPeer,
  TRUSTED_PROXIES_ENV,
  trustedClientIp,
  trustedRequestIp,
} from "./client-ip.ts";
import { banKey, canBan, isLoopback } from "./ip-key.ts";
import { dataPath, dataPaths } from "./data-path.ts";

const H = (o: Record<string, string>) => new Headers(o);
/** The front door, which reaches the app over loopback. */
const FRONT = "127.0.0.1";

describe("trusted client IP", () => {
  it("uses the platform header, not the first x-forwarded-for entry", () => {
    const ip = trustedClientIp(H({ "do-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 10.0.0.2" }), FRONT);
    assert.equal(ip, "203.0.113.7");
  });

  it("a spoofed x-forwarded-for can't change the derived IP", () => {
    const real = trustedClientIp(H({ "do-connecting-ip": "203.0.113.7", "x-forwarded-for": "100.127.0.9" }), FRONT);
    for (const fake of ["1.1.1.1", "127.0.0.1", "local", "8.8.8.8, 9.9.9.9"]) {
      const ip = trustedClientIp(H({ "do-connecting-ip": "203.0.113.7", "x-forwarded-for": `${fake}, 100.127.0.9` }), FRONT);
      assert.equal(ip, real);
    }
  });

  it("without the platform header, x-forwarded-for is never used: the visitor is unknown", () => {
    assert.equal(trustedClientIp(H({ "x-forwarded-for": "198.51.100.4" }), FRONT), "unknown");
    assert.equal(trustedClientIp(H({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 198.51.100.4" }), FRONT), "unknown");
  });

  it("ignores x-real-ip and cf-connecting-ip, which clients can set", () => {
    const ip = trustedClientIp(H({ "do-connecting-ip": "203.0.113.7", "x-real-ip": "5.5.5.5", "cf-connecting-ip": "6.6.6.6" }), FRONT);
    assert.equal(ip, "203.0.113.7");
    const onlySpoof = trustedClientIp(H({ "x-real-ip": "5.5.5.5", "cf-connecting-ip": "6.6.6.6" }), FRONT);
    assert.equal(onlySpoof, "unknown");
  });

  it("forwarded loopback or junk never becomes the exempt local preview", () => {
    assert.equal(trustedClientIp(H({ "do-connecting-ip": "127.0.0.1" }), FRONT), "unknown");
    assert.equal(trustedClientIp(H({ "x-forwarded-for": "local" }), FRONT), "unknown");
    assert.equal(trustedClientIp(H({ "x-forwarded-for": "::1" }), FRONT), "unknown");
    assert.equal(trustedClientIp(H({ "do-connecting-ip": "<script>" }), FRONT), "unknown");
  });

  it("no forwarding info is never the exempt preview outside development", () => {
    const prev = process.env.NODE_ENV;
    try {
      for (const mode of [undefined, "production", "test"]) {
        if (mode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = mode;
        assert.equal(trustedClientIp(H({})), "unknown");
        assert.equal(trustedClientIp(undefined), "unknown");
        assert.equal(trustedClientIp(H({}), "127.0.0.1"), "unknown");
      }
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("only local development with a loopback peer and no forwarding info is the preview", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      assert.equal(trustedClientIp(H({})), "local");
      assert.equal(trustedClientIp(H({}), "127.0.0.1"), "local");
      assert.equal(trustedClientIp(H({}), "198.51.100.9"), "198.51.100.9");
      assert.equal(trustedClientIp(H({ "x-forwarded-for": "127.0.0.1" }), "127.0.0.1"), "unknown");
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("an untrusted peer is keyed by its own address, whatever it claims", () => {
    assert.equal(trustedClientIp(H({}), "198.51.100.9"), "198.51.100.9");
    assert.equal(trustedClientIp(H({ "x-forwarded-for": "6.6.6.6" }), "198.51.100.9"), "198.51.100.9");
    assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "198.51.100.9"), "198.51.100.9");
    assert.equal(
      trustedClientIp(H({ "do-connecting-ip": "203.0.113.7", "x-forwarded-for": "6.6.6.6" }), "::ffff:198.51.100.9"),
      "198.51.100.9",
    );
    assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "2001:db8:0:3::9"), "2001:db8:0:3::/64");
  });

  it("a trusted loopback peer passes on the platform address only", () => {
    assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "127.0.0.1"), "203.0.113.7");
    assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "::1"), "203.0.113.7");
    assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "::ffff:127.0.0.1"), "203.0.113.7");
    assert.equal(trustedClientIp(H({ "x-forwarded-for": "198.51.100.4" }), "127.0.0.1"), "unknown");
  });

  it("with no peer, forwarding headers are not believed", () => {
    assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" })), "unknown");
    assert.equal(trustedClientIp(H({ "x-forwarded-for": "198.51.100.4" })), "unknown");
    assert.equal(trustedClientIp({ "do-connecting-ip": "203.0.113.7" }, ""), "unknown");
  });

  it("the trusted proxy setting adds IPs and CIDRs", () => {
    const prev = process.env[TRUSTED_PROXIES_ENV];
    try {
      process.env[TRUSTED_PROXIES_ENV] = " 10.20.0.0/16 , 192.0.2.10, 2001:db8:ff::/48 ";
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "10.20.5.6"), "203.0.113.7");
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "192.0.2.10"), "203.0.113.7");
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "2001:db8:ff:1::2"), "203.0.113.7");
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "198.51.100.21"), "198.51.100.21");
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "192.0.2.11"), "192.0.2.11");
      delete process.env[TRUSTED_PROXIES_ENV];
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "192.0.2.10"), "192.0.2.10");
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "10.20.5.6"), "unknown", "an ingress peer is never a key");
    } finally {
      if (prev === undefined) delete process.env[TRUSTED_PROXIES_ENV];
      else process.env[TRUSTED_PROXIES_ENV] = prev;
    }
  });

  it("bad trusted proxy entries are ignored and logged once", () => {
    const prev = process.env[TRUSTED_PROXIES_ENV];
    const warn = console.warn;
    const logged: string[] = [];
    console.warn = (...a: unknown[]) => void logged.push(a.join(" "));
    try {
      for (const bad of ["10.0.0.0/33", "300.1.1.1", "example.com", "10.0.0.1/8/2", "::1/129", "0/0", "/8", "10.0.0.0/-1"]) {
        assert.equal(parseCidr(bad), null, bad);
      }
      process.env[TRUSTED_PROXIES_ENV] = "not-an-ip, 10.0.0.0/33, 192.0.2.10";
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "192.0.2.10"), "203.0.113.7");
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "198.51.100.5"), "198.51.100.5");
      assert.equal(isTrustedProxy("198.51.100.5"), false);
      assert.equal(logged.length, 1, "logged once");
      assert.match(logged[0]!, /ignored 2 invalid trusted proxy entries/);
    } finally {
      console.warn = warn;
      if (prev === undefined) delete process.env[TRUSTED_PROXIES_ENV];
      else process.env[TRUSTED_PROXIES_ENV] = prev;
    }
  });

  it("short prefixes can't trust the whole internet: /0, /1 and anything wider than /8 or /32 are bad entries", () => {
    for (const bad of [
      "0.0.0.0/0",
      "::/0",
      "0.0.0.0/1",
      "128.0.0.0/1",
      "8.0.0.0/7",
      "0.0.0.0/00",
      "::/1",
      "2000::/3",
      "2001:db8::/31",
      "::ffff:0.0.0.0/0",
      "::ffff:0:0/96",
      "::ffff:10.0.0.0/104",
      "::ffff:10.0.0.1",
      "0:0:0:0:0:ffff:a00:0/104",
    ]) {
      assert.equal(parseCidr(bad), null, bad);
    }
    for (const good of ["100.64.0.0/10", "10.0.0.0/8", "192.0.2.10", "2001:db8::/32", "::1/128"]) {
      assert.notEqual(parseCidr(good), null, good);
    }
    const prev = process.env[TRUSTED_PROXIES_ENV];
    const warn = console.warn;
    const logged: string[] = [];
    console.warn = (...a: unknown[]) => void logged.push(a.join(" "));
    try {
      process.env[TRUSTED_PROXIES_ENV] = "0.0.0.0/0, ::/0, 0.0.0.0/1, 128.0.0.0/1, 8.0.0.0/7";
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "9.9.9.9" }), "8.8.8.8"), "8.8.8.8", "no IPv4 spoof");
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "9.9.9.9" }), "2001:db8:0:3::9"), "2001:db8:0:3::/64", "no IPv6 spoof");
      assert.equal(isTrustedProxy("8.8.8.8"), false);
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "9.9.9.9" }), "8.8.8.8"), "8.8.8.8");
      assert.equal(logged.length, 1, "logged once");
      assert.match(logged[0]!, /ignored 5 invalid trusted proxy entries/);
      process.env[TRUSTED_PROXIES_ENV] = "100.64.0.0/10";
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "9.9.9.9" }), "100.127.4.5"), "9.9.9.9", "100.64.0.0/10 still works");
    } finally {
      console.warn = warn;
      if (prev === undefined) delete process.env[TRUSTED_PROXIES_ENV];
      else process.env[TRUSTED_PROXIES_ENV] = prev;
    }
  });

  it("leading-zero octets and IPv6 zone ids are bad entries, as at the front door", () => {
    for (const bad of ["01.2.3.4", "10.0.0.01", "010.0.0.0/8", "::ffff:01.2.3.4", "fe80::1%eth0", "fe80::%eth0/64", "fe80::1%1/128"]) {
      assert.equal(parseCidr(bad), null, bad);
    }
    assert.notEqual(parseCidr("10.0.0.0/8"), null);
    assert.notEqual(parseCidr("fe80::/64"), null);
  });

  it("a trusted proxy's own address is never a visitor key or barred", () => {
    const prev = process.env[TRUSTED_PROXIES_ENV];
    try {
      process.env[TRUSTED_PROXIES_ENV] = "192.0.2.10, 100.64.0.0/10";
      assert.equal(trustedClientIp(H({}), "192.0.2.10"), "unknown", "no header: unknown, not the proxy");
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "junk" }), "192.0.2.10"), "unknown");
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "100.127.4.5" }), "192.0.2.10"), "unknown", "another proxy is not a visitor");
      assert.equal(trustedClientIp(H({ "x-forwarded-for": "203.0.113.7, 100.127.4.5" }), "192.0.2.10"), "unknown");
      // None, empty, junk, "unknown" and forwarded-for only: always the unknown bucket, never the proxy.
      for (const h of [{}, { "do-connecting-ip": "" }, { "do-connecting-ip": "garbage" }, { "do-connecting-ip": "unknown" }, { "x-forwarded-for": "198.51.100.4" }, { "x-forwarded-for": "203.0.113.7, 100.127.9.9" }]) {
        for (const peer of ["192.0.2.10", "10.20.0.1", FRONT]) {
          const key = trustedClientIp(H(h as Record<string, string>), peer === "10.20.0.1" ? "192.0.2.10" : peer);
          assert.equal(key, "unknown", JSON.stringify(h));
          assert.equal(canBan(key), false);
        }
      }
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.7" }), "192.0.2.10"), "203.0.113.7");
      assert.equal(canBan("192.0.2.10"), false);
      assert.equal(canBan("100.127.4.5"), false);
      delete process.env[TRUSTED_PROXIES_ENV];
      assert.equal(canBan("100.64.0.1"), false, "the ingress range is never barred, even when not configured");
      assert.equal(canBan("100.127.255.254"), false);
      assert.equal(canBan("100.128.0.1"), true);
      process.env[TRUSTED_PROXIES_ENV] = "192.0.2.10, 100.64.0.0/10";
      assert.equal(canBan("203.0.113.7"), true);
    } finally {
      if (prev === undefined) delete process.env[TRUSTED_PROXIES_ENV];
      else process.env[TRUSTED_PROXIES_ENV] = prev;
    }
  });

  it("reads the peer from the server request, never from a header", () => {
    const req = { headers: H({}), runtime: { node: { req: { socket: { remoteAddress: "198.51.100.9" } } } } };
    assert.equal(socketPeer(req), "198.51.100.9");
    assert.equal(trustedRequestIp(req), "198.51.100.9");
    assert.equal(socketPeer(new Request("https://example.test/", { headers: { "x-forwarded-for": "1.2.3.4" } })), "");
  });

  it("a request with no forwarding info is never barred", () => {
    const ip = trustedRequestIp(new Request("https://example.test/api/agent/call"));
    assert.equal(ip, "unknown");
    assert.equal(isLoopback(ip), false, "the shared bucket still gets rate limits");
  });

  it("saved keys with a full IPv6 address match the /64 key, IPv4 unchanged", () => {
    const k = (ip: string) => banKey(trustedClientIp(H({ "do-connecting-ip": ip }), FRONT));
    assert.equal(banKey("2001:db8:0:5::7"), k("2001:db8:0:5::7"));
    assert.equal(k("2001:db8:0:5:1:2:3:4"), banKey("2001:db8:0:5::7"), "same /64");
    assert.notEqual(k("2001:db8:0:6::7"), banKey("2001:db8:0:5::7"));
    assert.equal(k("2001:db8:0:9::1"), banKey("2001:db8:0:9::/64"));
    assert.equal(banKey("198.51.100.77"), k("198.51.100.77"));
    assert.notEqual(banKey("198.51.100.78"), banKey("198.51.100.77"));
    assert.equal(banKey("unknown"), "");
  });

  it("loopback is never barred, checked before grouping", () => {
    for (const ip of ["::1", "::", "::ffff:127.0.0.1", "0:0:0:0:0:0:0:1", "127.0.0.1", "local", "unknown"]) {
      assert.equal(canBan(ip), false, ip);
    }
    assert.equal(canBan("2001:db8::1"), true);
    assert.equal(canBan("203.0.113.5"), true);
  });

  it("test-only file redirect is ignored outside test mode", () => {
    const prev = { env: process.env.NODE_ENV, dir: process.env.DESK_TEST_DATA_DIR };
    try {
      process.env.DESK_TEST_DATA_DIR = "/private/run";
      process.env.NODE_ENV = "production";
      assert.deepEqual(dataPaths(["/tmp/x.json", "/srv/fake-desk-data/x.json"]), ["/tmp/x.json", "/srv/fake-desk-data/x.json"]);
      process.env.NODE_ENV = "test";
      assert.deepEqual(dataPaths(["/tmp/x.json", "/srv/fake-desk-data/x.json"]), ["/private/run/x.json"]);
      assert.equal(dataPath("/tmp/desk-bars.json"), "/private/run/desk-bars.json");
    } finally {
      if (prev.env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev.env;
      if (prev.dir === undefined) delete process.env.DESK_TEST_DATA_DIR;
      else process.env.DESK_TEST_DATA_DIR = prev.dir;
    }
  });

  it("groups IPv6 by /64 so rotating inside one network gets one limit", () => {
    const a = trustedClientIp(H({ "do-connecting-ip": "2001:db8:0:1::5" }), FRONT);
    const b = trustedClientIp(H({ "do-connecting-ip": "2001:db8:0:1:ffff:1:2:3" }), FRONT);
    const c = trustedClientIp(H({ "do-connecting-ip": "2001:db8:0:2::5" }), FRONT);
    assert.equal(a, "2001:db8:0:1::/64");
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(limitKey("::ffff:203.0.113.9"), "203.0.113.9");
    assert.equal(limitKey("203.0.113.9"), "203.0.113.9");
    assert.equal(limitKey("1:2:3:4:5:6:7:8:9"), "");
    assert.equal(trustedClientIp(H({ "do-connecting-ip": "::ffff:127.0.0.1" }), FRONT), "unknown");
  });

  it("reads plain header objects (node IncomingMessage style)", () => {
    assert.equal(trustedClientIp({ "do-connecting-ip": "2001:db8::1", "x-forwarded-for": "1.2.3.4" }, FRONT), "2001:db8:0:0::/64");
    assert.equal(trustedClientIp({ "do-connecting-ip": ["9.9.9.9", "198.51.100.4"] }, FRONT), "198.51.100.4", "the last entry");
    assert.equal(trustedClientIp({ "x-forwarded-for": ["9.9.9.9", "198.51.100.4"] }, FRONT), "unknown");
  });

  it("normalizes ports and brackets", () => {
    assert.equal(normalizeIp("203.0.113.7:443"), "203.0.113.7");
    assert.equal(normalizeIp("[2001:db8::1]:443"), "2001:db8::1");
    assert.equal(normalizeIp("not-an-ip"), "");
  });

});

/** Loaded at run time: plain JS with no type declarations. */
const DO_START: string = "../../../scripts/do-start.mjs";

describe("front door to app, end to end", () => {
  type Seen = { headers: http.IncomingHttpHeaders; peer: string };
  // Stub app: records what the front door sends it, and from which address.
  async function withFrontDoor(opts: Record<string, unknown>, run: (port: number, seen: Seen[]) => Promise<void>) {
    const { startFrontDoor } = await import(DO_START);
    const seen: Seen[] = [];
    const app = http.createServer((req, res) => {
      seen.push({ headers: req.headers, peer: req.socket.remoteAddress ?? "" });
      res.end("ok");
    });
    await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
    const front = startFrontDoor({ port: 0, host: "0.0.0.0", nitroPort: (app.address() as { port: number }).port, ...opts });
    await new Promise<void>((r) => (front.listening ? r() : front.once("listening", () => r())));
    try {
      await run(front.address().port, seen);
    } finally {
      front.close();
      app.close();
    }
  }
  function get(port: number, from: string, headers: Record<string, string>) {
    return new Promise<number>((resolve, reject) => {
      const req = http.get({ host: from, port, path: "/api/agent/echo", localAddress: from, headers }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      });
      req.on("error", reject);
    });
  }
  const forged = { "do-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.4", "x-real-ip": "6.6.6.6" };
  const appSees = (s: Seen) => trustedClientIp(s.headers, s.peer);
  const SIGN_IN_IP: string = "@better-auth/core/utils/ip";
  // The address the sign-in library takes from the headers. With no address header it returns null in
  // production (its shared bucket); under NODE_ENV=test it falls back to its own local address instead,
  // so that fallback is reported as null here too.
  const signInSees = async (s: Seen) => {
    const { getIP } = await import(SIGN_IN_IP);
    const h = new Headers();
    for (const [k, v] of Object.entries(s.headers)) if (typeof v === "string") h.set(k, v);
    const ip = getIP({ headers: h }, {});
    return ip === "127.0.0.1" && process.env.NODE_ENV === "test" ? null : ip;
  };

  it("only the platform header names the visitor; other address headers are dropped", async () => {
    // No built-in list at all: the peer still never counts, only the platform header does.
    await withFrontDoor({ trustedDefaults: [], trustedProxyEnv: "" }, async (port, seen) => {
      assert.equal(await get(port, "127.0.0.1", forged), 200);
      const s = seen[0]!;
      assert.equal(s.headers["do-connecting-ip"], "203.0.113.7");
      assert.equal(s.headers["x-forwarded-for"], "203.0.113.7", "one fresh entry, the forwarded-for value is dropped");
      assert.equal(s.headers["x-real-ip"], undefined);
      assert.equal(appSees(s), "203.0.113.7");
    });
  });

  it("the peer's own address is never the visitor, whatever range it is in", async (t) => {
    const outside = Object.values(networkInterfaces())
      .flat()
      .find((a) => a && a.family === "IPv4" && !a.internal);
    if (!outside) return t.skip("no non-loopback address on this machine");
    const warn = console.warn;
    console.warn = () => {};
    try {
      await withFrontDoor({ trustedProxyEnv: "", trustedDefaults: ["127.0.0.0/8", "::1/128"] }, async (port, seen) => {
        assert.equal(await get(port, outside.address, { "x-forwarded-for": "198.51.100.4", "x-real-ip": "6.6.6.6" }), 200);
        assert.equal(await get(port, outside.address, { "do-connecting-ip": "203.0.113.9" }), 200);
        assert.equal(seen[0]!.headers["do-connecting-ip"], undefined, "no platform header: nothing is added");
        assert.equal(seen[0]!.headers["x-forwarded-for"], undefined);
        assert.equal(appSees(seen[0]!), "unknown");
        assert.equal(await signInSees(seen[0]!), null, "the sign-in library uses its shared bucket");
        assert.equal(appSees(seen[1]!), "203.0.113.9");
        assert.equal(await signInSees(seen[1]!), "203.0.113.9");
      });
    } finally {
      console.warn = warn;
    }
  });

  it("the platform address from a trusted proxy reaches the app per visitor", async () => {
    // Loopback stands in for the platform's ingress here.
    await withFrontDoor({ trustedProxyEnv: "" }, async (port, seen) => {
      assert.equal(await get(port, "127.0.0.1", { "do-connecting-ip": "203.0.113.7", "x-forwarded-for": "10.0.0.1" }), 200);
      assert.equal(await get(port, "127.0.0.1", { "do-connecting-ip": "203.0.113.8" }), 200);
      assert.deepEqual(seen.map(appSees), ["203.0.113.7", "203.0.113.8"]);
      assert.deepEqual(
        seen.map((s) => s.headers["x-forwarded-for"]),
        ["203.0.113.7", "203.0.113.8"],
        "one fresh entry, nothing passed through",
      );
      // The sign-in library keys its own limits on these headers: two visitors stay separate.
      assert.deepEqual(await Promise.all(seen.map(signInSees)), ["203.0.113.7", "203.0.113.8"]);
    });
  });

  it("the visitor comes from the platform header whatever the peer, and the setting adds proxy addresses", async () => {
    const { trustedProxyList, visitorAddress } = await import(DO_START);
    const h = { "do-connecting-ip": "203.0.113.7" };
    for (const peer of ["100.127.4.5", "::ffff:100.127.4.5", "198.51.100.9", "8.8.8.8", "10.244.0.1", ""]) {
      assert.equal(visitorAddress(h, peer, trustedProxyList("")), "203.0.113.7", peer || "(no peer)");
    }
    assert.equal(visitorAddress({ "do-connecting-ip": "junk" }, "100.127.4.5", trustedProxyList("")), "", "never the proxy itself");
    const warn = console.warn;
    const logged: string[] = [];
    console.warn = (...a: unknown[]) => void logged.push(a.join(" "));
    try {
      const list = trustedProxyList("bogus, 198.51.100.0/40, 198.51.100.9");
      trustedProxyList("bogus, 198.51.100.0/40, 198.51.100.9");
      assert.equal(logged.length, 1, "bad entries are logged once");
      assert.equal(visitorAddress({ "do-connecting-ip": "198.51.100.9" }, "10.0.0.1", list), "", "a configured proxy is not a visitor");
      assert.equal(visitorAddress({ "do-connecting-ip": "198.51.100.10" }, "10.0.0.1", list), "198.51.100.10");
    } finally {
      console.warn = warn;
    }
  });

  it("the platform header's last entry is used, so a value a client put first can't win", async () => {
    const { trustedProxyList, visitorAddress } = await import(DO_START);
    const list = trustedProxyList("");
    assert.equal(visitorAddress({ "do-connecting-ip": "6.6.6.6, 203.0.113.7" }, "10.0.0.1", list), "203.0.113.7");
    assert.equal(visitorAddress({ "do-connecting-ip": ["6.6.6.6", "203.0.113.7"] }, "10.0.0.1", list), "203.0.113.7");
    assert.equal(trustedClientIp(H({ "do-connecting-ip": "6.6.6.6, 203.0.113.7" }), "127.0.0.1"), "203.0.113.7");
  });

  it("the front door never uses a trusted proxy's own address as the visitor", async () => {
    const { trustedProxyList, visitorAddress } = await import(DO_START);
    const list = trustedProxyList("");
    const warn = console.warn;
    const logged: string[] = [];
    console.warn = (...a: unknown[]) => void logged.push(a.join(" "));
    try {
      for (const h of [{}, { "do-connecting-ip": "" }, { "do-connecting-ip": "garbage" }, { "do-connecting-ip": "unknown" }, { "x-forwarded-for": "203.0.113.7, 100.127.9.9" }]) {
        assert.equal(visitorAddress(h, "100.127.4.5", list), "", JSON.stringify(h));
      }
    } finally {
      console.warn = warn;
    }
    for (const line of logged) {
      assert.match(line, /^\[s1r1us\] \d+ request\(s\) without a platform address$/, "count only");
      assert.doesNotMatch(line, /\d+\.\d+\.\d+\.\d+|:/, "no addresses in the log");
    }
    assert.equal(visitorAddress({}, "100.127.4.5", list), "");
    assert.equal(visitorAddress({ "x-forwarded-for": "203.0.113.7, 100.127.4.5" }, "100.127.4.5", list), "", "only the platform header counts");
    assert.equal(visitorAddress({ "x-forwarded-for": "203.0.113.7" }, "100.127.4.5", list), "");
    assert.equal(visitorAddress({ "do-connecting-ip": "100.64.0.9" }, "100.127.4.5", list), "", "another proxy is not a visitor");
    assert.equal(visitorAddress({ "do-connecting-ip": "203.0.113.7" }, "100.127.4.5", list), "203.0.113.7");
    // End to end: loopback is a trusted proxy by default; with no platform header the app sees an unknown visitor.
    await withFrontDoor({ trustedProxyEnv: "" }, async (port, seen) => {
      assert.equal(await get(port, "127.0.0.1", { "x-forwarded-for": "198.51.100.4", "x-real-ip": "6.6.6.6" }), 200);
      const s = seen[0]!;
      assert.equal(s.headers["do-connecting-ip"], undefined);
      assert.equal(s.headers["x-forwarded-for"], undefined);
      assert.equal(s.headers["x-real-ip"], undefined);
      assert.equal(appSees(s), "unknown");
      assert.equal(canBan(appSees(s)), false);
      assert.equal(await signInSees(s), null, "the sign-in library uses its shared bucket");
    });
  });

  it("the front door rejects the same proxy entries as the app, by family", async () => {
    const { trustedProxyList, visitorAddress } = await import(DO_START);
    const warn = console.warn;
    console.warn = () => {};
    try {
      // A too-wide entry is ignored, so it can't turn every visitor into a proxy (and the shared bucket).
      for (const entry of ["0.0.0.0/0", "::/0", "0.0.0.0/1,128.0.0.0/1", "8.0.0.0/7", "::/1", "2001:db8::/31", "::ffff:0.0.0.0/0", "::ffff:0:0/96", "::ffff:8.0.0.0/104"]) {
        const list = trustedProxyList(entry, []);
        assert.equal(visitorAddress({ "do-connecting-ip": "9.9.9.9" }, "10.0.0.1", list), "9.9.9.9", `${entry}: IPv4 visitor kept`);
        assert.equal(visitorAddress({ "do-connecting-ip": "2001:db8:0:3::9" }, "10.0.0.1", list), "2001:db8:0:3::9", `${entry}: IPv6 visitor kept`);
      }
      // A valid IPv6 range never matches an IPv4 value (Node's BlockList would match IPv4 inside ::/32).
      const v6only = trustedProxyList("::/32", []);
      assert.equal(visitorAddress({ "do-connecting-ip": "8.8.8.8" }, "10.0.0.1", v6only), "8.8.8.8");
      assert.equal(visitorAddress({ "do-connecting-ip": "::ffff:8.8.8.8" }, "10.0.0.1", v6only), "8.8.8.8");
    } finally {
      console.warn = warn;
    }
    const logged: string[] = [];
    console.warn = (...a: unknown[]) => void logged.push(a.join(" "));
    try {
      const entries = [
        "0.0.0.0/0",
        "::/0",
        "0.0.0.0/1",
        "8.0.0.0/7",
        "2001:db8::/31",
        "01.2.3.4",
        "10.0.0.01/32",
        "::ffff:01.2.3.4",
        "fe80::1%eth0",
        "fe80::%eth0/64",
        "::ffff:0:0/96",
        "::ffff:10.0.0.0/104",
        "::ffff:10.0.0.1",
        "0:0:0:0:0:ffff:a00:0/104",
        "100.64.0.0/10",
        "10.0.0.0/8",
        "2001:db8::/32",
        "192.0.2.10",
        "fe80::/64",
      ];
      for (const e of entries) {
        logged.length = 0;
        trustedProxyList(`${e}, parity-${entries.indexOf(e)}`, []);
        const frontBad = /ignored 2 /.test(logged[0] ?? "");
        assert.equal(frontBad, parseCidr(e) === null, `front door and app agree on ${e}`);
      }
    } finally {
      console.warn = warn;
    }
    assert.equal(visitorAddress({ "do-connecting-ip": "9.9.9.9" }, "100.127.4.5", trustedProxyList("")), "9.9.9.9", "100.64.0.0/10 default still works");
  });
});

describe("shared ingress addresses are never a visitor key", () => {
  // Live, the platform's ingress reached the front door from an address that changed on
  // every request, so limits never fired and a ban could land on a shared address.
  const ROTATING = ["10.244.0.17", "10.244.3.9", "10.245.1.200", "172.16.4.4", "172.31.255.1", "192.168.7.7", "169.254.1.1", "fd00::17", "fe80::9"];

  it("private and shared ingress ranges are never a visitor, and the key ignores the hop", async () => {
    const { trustedProxyList, visitorAddress, INGRESS_RANGES, FRONT_DOOR_TRUSTED_DEFAULT } = await import(DO_START);
    const { INGRESS_RANGES: APP_RANGES } = await import("./client-ip.ts");
    assert.deepEqual([...INGRESS_RANGES], [...APP_RANGES], "front door and app use the same list");
    for (const r of INGRESS_RANGES) assert.ok(FRONT_DOOR_TRUSTED_DEFAULT.includes(r), r);
    const list = trustedProxyList("");
    for (const peer of ROTATING) {
      assert.equal(visitorAddress({ "do-connecting-ip": "203.0.113.50" }, peer, list), "203.0.113.50", peer);
    }
    const warn = console.warn;
    console.warn = () => {};
    try {
      for (const peer of ROTATING) assert.equal(visitorAddress({}, peer, list), "", `${peer}: no header means unknown, never the peer`);
      assert.equal(visitorAddress({ "do-connecting-ip": "10.9.9.9" }, "10.244.0.17", list), "", "a private platform value is not a visitor");
    } finally {
      console.warn = warn;
    }
    // A public ingress hop is never the visitor either: the key stays the visitor's own.
    for (const peer of ["172.32.0.1", "8.8.8.8", "164.90.1.1", "164.90.1.2", "2604:a880::1"]) {
      assert.equal(visitorAddress({ "do-connecting-ip": "203.0.113.50" }, peer, list), "203.0.113.50", peer);
    }
  });

  it("the setting still can't trust a range wider than the minimum", async () => {
    const { trustedProxyList, visitorAddress } = await import(DO_START);
    const warn = console.warn;
    console.warn = () => {};
    try {
      const list = trustedProxyList("fc00::/7, 8.0.0.0/7", []);
      assert.equal(visitorAddress({ "do-connecting-ip": "fd00::9" }, "10.0.0.1", list), "fd00::9", "the too-wide setting is ignored");
      assert.equal(visitorAddress({ "do-connecting-ip": "9.9.9.9" }, "10.0.0.1", list), "9.9.9.9");
    } finally {
      console.warn = warn;
    }
    assert.equal(parseCidr("fc00::/7"), null);
  });

  it("ingress addresses are never keyed or barred in the app", () => {
    for (const peer of ROTATING) {
      assert.equal(trustedClientIp(H({ "do-connecting-ip": "203.0.113.50" }), peer), "unknown", `${peer} is not a key`);
      assert.equal(canBan(peer), false, peer);
    }
    assert.equal(canBan("172.32.0.1"), true);
    assert.equal(canBan("203.0.113.50"), true);
  });

  it("saved IPv6 /64 keys inside an ingress range are never barred either", () => {
    for (const key of ["fd00:0:0:0::/64", "fe80:0:0:0::/64", "fc00:1:2:3::/64"]) {
      assert.equal(canBan(key), false, key);
    }
    assert.equal(canBan("2001:db8:1:2::/64"), true, "a public /64 key can still be barred");
  });

  it("a saved /64 key in short form matches a visitor in that network", () => {
    assert.equal(banKey("2001:db8::/64"), banKey("2001:db8::1234"));
    assert.equal(banKey("2001:DB8:0:0::/64"), banKey("2001:db8::1234"));
    assert.equal(banKey("2001:db8:77::/64"), banKey("2001:db8:77::1234"));
    assert.notEqual(banKey("2001:db8:77::/64"), banKey("2001:db8:78::1234"));
  });
});
