import { test } from "node:test";
import assert from "node:assert/strict";
import { guardedFetch } from "./net-guard.ts";
import { CMC_HEADER } from "./free-sources.ts";

type Call = { url: string; headerNames: string[] };

function headerNames(init?: RequestInit): string[] {
  if (!init?.headers) return [];
  return [...new Headers(init.headers).keys()];
}

async function withMockedFetch<T>(
  handler: (input: string, init?: RequestInit) => Response,
  fn: () => Promise<T>,
): Promise<{ calls: Call[]; value: T }> {
  const calls: Call[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, headerNames: headerNames(init) });
    return handler(url, init);
  }) as typeof fetch;
  try {
    const value = await fn();
    return { calls, value };
  } finally {
    globalThis.fetch = orig;
  }
}

test("guardedFetch does not forward the CoinMarketCap key header to a different host", async () => {
  const { calls, value } = await withMockedFetch(
    (url) => {
      if (url.startsWith("https://pro-api.coinmarketcap.com/")) {
        return new Response(null, { status: 302, headers: { location: "https://bitcoinops.org/elsewhere" } });
      }
      return new Response("ok", { status: 200 });
    },
    () =>
      guardedFetch("https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=BTC", {
        headers: { [CMC_HEADER]: "dummy-value", Accept: "application/json" },
      }),
  );
  assert.equal(value.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url.startsWith("https://pro-api.coinmarketcap.com/"), true);
  assert.equal(calls[0]!.headerNames.includes(CMC_HEADER.toLowerCase()), true);
  assert.equal(calls[1]!.url, "https://bitcoinops.org/elsewhere");
  assert.equal(calls[1]!.headerNames.includes(CMC_HEADER.toLowerCase()), false);
  assert.equal(calls[1]!.headerNames.length, 0);
});

test("guardedFetch keeps the CoinMarketCap key header on a same-host redirect", async () => {
  const { calls, value } = await withMockedFetch(
    (url) => {
      if (url.endsWith("/from")) {
        return new Response(null, { status: 302, headers: { location: "https://pro-api.coinmarketcap.com/to" } });
      }
      return new Response("ok", { status: 200 });
    },
    () =>
      guardedFetch("https://pro-api.coinmarketcap.com/from", {
        headers: { [CMC_HEADER]: "dummy-value" },
      }),
  );
  assert.equal(value.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.url, "https://pro-api.coinmarketcap.com/to");
  assert.equal(calls[1]!.headerNames.includes(CMC_HEADER.toLowerCase()), true);
});
