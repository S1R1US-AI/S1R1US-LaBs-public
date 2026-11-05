// Front door: every /api/ reply carries X-Robots-Tag: noindex; pages do not.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { isApiPath, startFrontDoor } from "./do-start.mjs";

let upstream;
let front;
let frontPort;

before(async () => {
  upstream = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
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

function get(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: frontPort, path, headers: { host: "s1r1us.ai" } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res));
      })
      .on("error", reject);
  });
}

test("isApiPath matches /api and /api/* only", () => {
  for (const p of ["/api", "/api/", "/api/x", "/api/x?y=1"]) assert.equal(isApiPath(p), true, p);
  for (const p of ["/", "/apix", "/faq/", "/app", "/x/api/"]) assert.equal(isApiPath(p), false, p);
});

test("proxied /api/ replies carry X-Robots-Tag: noindex", async () => {
  for (const p of ["/api/x", "/api/x/y?z=1"]) {
    const res = await get(p);
    assert.equal(res.headers["x-robots-tag"], "noindex", p);
  }
});

test("proxied non-API replies do not get the header", async () => {
  const res = await get("/some-nitro-page-xyz");
  assert.equal(res.headers["x-robots-tag"], undefined);
});
