// Front door: every reply carries the baseline browser safety headers; a reply's own value is kept
// only when it is the same or stronger, otherwise the baseline is sent.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import {
  canonicalRedirect,
  frontDoorHsts,
  frontDoorSecurityHeaders,
  resolveFrontDoorSecurityHeaders,
  startFrontDoor,
} from "./do-start.mjs";

/** Upstream replies that set their own safety headers (weaker and stronger). */
const UPSTREAM_HEADERS = {
  "/weak-frame": { "X-Frame-Options": "ALLOWALL" },
  "/weak-csp": { "Content-Security-Policy": "default-src 'self'" },
  "/wide-csp": { "Content-Security-Policy": "default-src 'self'; frame-ancestors *" },
  "/weak-referrer": { "Referrer-Policy": "unsafe-url" },
  "/weak-hsts": { "Strict-Transport-Security": "max-age=0" },
  "/weak-nosniff": { "X-Content-Type-Options": "sniff" },
  "/strong": {
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  },
};

let upstream;
let front;
let frontPort;

before(async () => {
  upstream = http.createServer((req, res) => {
    const own = UPSTREAM_HEADERS[req.url.split("?")[0]];
    if (req.url.startsWith("/own-referrer")) {
      res.writeHead(200, { "Content-Type": "text/plain", "referrer-policy": "no-referrer" });
    } else if (req.url.startsWith("/set-then-write")) {
      res.setHeader("X-Frame-Options", "ALLOWALL");
      res.writeHead(200, ["Content-Type", "text/plain", "Referrer-Policy", "unsafe-url"]);
    } else if (own) {
      res.writeHead(200, { "Content-Type": "text/plain", ...own });
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    }
    res.end("ok");
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  front = startFrontDoor({ port: 0, host: "127.0.0.1", nitroPort: upstream.address().port });
  await new Promise((r) => (front.listening ? r() : front.once("listening", r)));
  frontPort = front.address().port;
});

after(() => {
  front.close();
  upstream.close();
});

/** Reads a reply header by its usual written name. */
const header = (res, name) => res.headers[name.toLowerCase()];

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: frontPort, path, headers: { host: "s1r1us.ai", ...headers } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res));
      })
      .on("error", reject);
  });
}

test("baseline values", () => {
  assert.equal(frontDoorSecurityHeaders["Content-Security-Policy"], "frame-ancestors 'self'");
  assert.equal(frontDoorSecurityHeaders["X-Frame-Options"], "SAMEORIGIN");
  assert.equal(frontDoorSecurityHeaders["X-Content-Type-Options"], "nosniff");
  assert.equal(frontDoorSecurityHeaders["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(frontDoorHsts, "max-age=31536000; includeSubDomains");
});

test("proxied pages get every baseline header", async () => {
  const res = await get("/some-nitro-page-xyz");
  assert.equal(res.statusCode, 200);
  for (const [name, value] of Object.entries(frontDoorSecurityHeaders)) {
    assert.equal(header(res, name), value, name);
  }
});

test("front-door static pages and errors get the baseline headers too", async () => {
  for (const p of ["/", "/faq/", "/%00bad"]) {
    const res = await get(p);
    assert.equal(res.headers["x-frame-options"], "SAMEORIGIN", p);
    assert.equal(header(res, "Content-Security-Policy"), "frame-ancestors 'self'", p);
    assert.equal(res.headers["x-content-type-options"], "nosniff", p);
  }
});

test("HSTS only on HTTPS requests", async () => {
  const plain = await get("/some-nitro-page-xyz");
  assert.equal(header(plain, "Strict-Transport-Security"), undefined);
  const secure = await get("/some-nitro-page-xyz", { "x-forwarded-proto": "https" });
  assert.equal(header(secure, "Strict-Transport-Security"), frontDoorHsts);
});

test("a header the upstream reply sets itself is kept when stronger", async () => {
  const res = await get("/own-referrer");
  assert.equal(res.headers["referrer-policy"], "no-referrer");
  assert.equal(res.headers["x-frame-options"], "SAMEORIGIN");
});

test("weaker X-Frame-Options (ALLOWALL) is replaced by the baseline", async () => {
  const res = await get("/weak-frame");
  assert.equal(res.headers["x-frame-options"], "SAMEORIGIN");
});

test("a CSP without frame-ancestors keeps its policy and gains the baseline policy", async () => {
  const res = await get("/weak-csp");
  assert.equal(res.headers["content-security-policy"], "default-src 'self', frame-ancestors 'self'");
});

test("a CSP that allows any framer gains the baseline policy", async () => {
  const res = await get("/wide-csp");
  assert.equal(res.headers["content-security-policy"], "default-src 'self'; frame-ancestors *, frame-ancestors 'self'");
});

test("weaker Referrer-Policy (unsafe-url) is replaced by the baseline", async () => {
  const res = await get("/weak-referrer");
  assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
});

test("HSTS max-age=0 is replaced by the baseline on HTTPS", async () => {
  const res = await get("/weak-hsts", { "x-forwarded-proto": "https" });
  assert.equal(header(res, "Strict-Transport-Security"), frontDoorHsts);
});

test("a nosniff value other than nosniff is replaced by the baseline", async () => {
  const res = await get("/weak-nosniff");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
});

test("stronger upstream values are kept, including the app's longer HSTS", async () => {
  const res = await get("/strong", { "x-forwarded-proto": "https" });
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.equal(res.headers["content-security-policy"], "default-src 'self'; frame-ancestors 'none'");
  assert.equal(res.headers["referrer-policy"], "no-referrer");
  assert.equal(header(res, "Strict-Transport-Security"), "max-age=63072000; includeSubDomains");
});

test("weaker values set with setHeader or a header list are replaced too", async () => {
  const res = await get("/set-then-write");
  assert.equal(res.headers["x-frame-options"], "SAMEORIGIN");
  assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
});

test("resolve: each weaker value falls back, each same or stronger value stays", () => {
  const weak = resolveFrontDoorSecurityHeaders(
    {
      "x-frame-options": "ALLOW-FROM https://example.com",
      "content-security-policy": "frame-ancestors 'self' https://example.com",
      "referrer-policy": "no-referrer, unsafe-url",
      "strict-transport-security": "max-age=31535999",
      "x-content-type-options": ["nosniff", "nosniff"],
    },
    true,
  );
  assert.equal(weak["X-Frame-Options"], "SAMEORIGIN");
  assert.deepEqual(weak["Content-Security-Policy"], [
    "frame-ancestors 'self' https://example.com",
    "frame-ancestors 'self'",
  ]);
  assert.equal(weak["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(weak["Strict-Transport-Security"], frontDoorHsts);
  assert.equal(weak["X-Content-Type-Options"], "nosniff");

  const same = resolveFrontDoorSecurityHeaders(
    {
      "x-frame-options": "sameorigin",
      "content-security-policy": "frame-ancestors 'self'",
      "referrer-policy": "unsafe-url, strict-origin",
      "strict-transport-security": "max-age=31536000",
    },
    true,
  );
  assert.equal(same["X-Frame-Options"], "SAMEORIGIN");
  assert.equal(same["Content-Security-Policy"], "frame-ancestors 'self'");
  assert.equal(same["Referrer-Policy"], "unsafe-url, strict-origin");
  assert.equal(same["Strict-Transport-Security"], "max-age=31536000");

  const plain = resolveFrontDoorSecurityHeaders({}, false);
  assert.equal(plain["Strict-Transport-Security"], undefined);
});

test("www goes to the apex with a 301 and keeps the path", async () => {
  const res = await get("/faq/?a=1", { host: "www.s1r1us.ai" });
  assert.equal(res.statusCode, 301);
  assert.equal(res.headers.location, "https://s1r1us.ai/faq/?a=1");
  assert.equal(res.headers["x-frame-options"], "SAMEORIGIN");
});

test("plain http on the apex goes to https with a 301", async () => {
  const res = await get("/", { "x-forwarded-proto": "http" });
  assert.equal(res.statusCode, 301);
  assert.equal(res.headers.location, "https://s1r1us.ai/");
  assert.equal(header(res, "Strict-Transport-Security"), undefined);
});

test("https on the apex, other hosts and requests without a scheme header are not redirected", async () => {
  assert.equal((await get("/", { "x-forwarded-proto": "https" })).statusCode, 200);
  assert.equal((await get("/")).statusCode, 200);
  assert.equal((await get("/", { host: "127.0.0.1" })).statusCode, 200);
  assert.equal((await get("/", { host: "evil.example", "x-forwarded-proto": "http" })).statusCode, 200);
});

test("canonicalRedirect never leaves the apex", () => {
  const req = (host, proto) => ({ headers: { host, ...(proto ? { "x-forwarded-proto": proto } : {}) } });
  assert.equal(canonicalRedirect(req("WWW.S1R1US.AI:443"), "/x"), "https://s1r1us.ai/x");
  assert.equal(canonicalRedirect(req("www.s1r1us.ai."), "/x"), "https://s1r1us.ai/x");
  assert.equal(canonicalRedirect(req("www.s1r1us.ai"), "//evil.example/"), null);
  assert.equal(canonicalRedirect(req("s1r1us.ai", "https"), "/"), null);
  assert.equal(canonicalRedirect(req("s1r1us.ai", "http, https"), "/"), "https://s1r1us.ai/");
  assert.equal(canonicalRedirect(req("other.example", "http"), "/"), null);
});
