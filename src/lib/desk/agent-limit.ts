import { agentCorsHeaders } from "./agent-feed";
import { feedKeyAccepted } from "./feed-key";
import { agentBarResponse, agentOpsPublic } from "./agent-notice";
import { agentGatePublic, isAgentCommOpen } from "./agent-gate";
import { trustedRequestIp } from "./client-ip";

type Hit = { at: number };
const buckets = new Map<string, Hit[]>();

function clientIp(request: Request) {
  return trustedRequestIp(request);
}

function uaClass(ua: string) {
  const u = ua.toLowerCase();
  if (!u || u === "-" || u.length < 4) return "empty";
  if (/(scrapy|python-requests|go-http-client|libwww)/i.test(ua) && !/grok|claude|gpt|openai|mcp/i.test(ua)) {
    return "scrape";
  }
  return "bot";
}

function pathClass(request: Request) {
  try {
    const p = new URL(request.url).pathname;
    if (/\/api\/agent\/call\/?$/.test(p) || /\/api\/agent\/mcp\/?$/.test(p) || /\/api\/agent\/a2a\/?$/.test(p)) return "heavy";
    return "light";
  } catch {
    return "light";
  }
}

function prune(hits: Hit[], since: number) {
  while (hits.length && hits[0]!.at < since) hits.shift();
}

function agentPath(request: Request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "";
  }
}

/** Ping, waitlist, notices and forum stay up so bots learn about maintenance. MCP stays up, but it answers read tools only. */
function openDuringMaintenance(path: string) {
  return /\/api\/agent\/(ping|waitlist|notices|forum)\/?$/.test(path) || /\/api\/agent\/mcp\/?$/.test(path);
}

function maintenanceResponse(): Response {
  const ops = agentOpsPublic();
  const gate = agentGatePublic();
  const body = {
    ...ops,
    ok: false as const,
    error: "maintenance" as const,
    pong: false as const,
    live: false as const,
    paused: ops.paused,
    status: ops.status.toLowerCase(),
    ops,
    gate,
  };
  const headers = agentCorsHeaders({
    "content-type": "application/json; charset=utf-8",
    "retry-after": String(ops.retryAfterSec || 300),
    "cache-control": "no-store",
  });
  return new Response(JSON.stringify(body), { status: 503, headers });
}

function agentMaintenance(request: Request): Response | null {
  if (isAgentCommOpen()) return null;
  if (openDuringMaintenance(agentPath(request))) return null;
  return maintenanceResponse();
}

/** Free /call: 1 / 25s (poll 300s). Light discovery: 8 / 30s. SaaS key: 1 / 5s on /call. Scrapers: 1 / 60s. */
export function agentRateLimit(request: Request): Response | null {
  const paid = feedKeyAccepted(request);
  const ua = request.headers.get("user-agent") ?? "";
  const kind = uaClass(ua);
  const weight = pathClass(request);
  const ip = clientIp(request);
  const bucketKey = `${ip}|${kind}|${weight}|${paid ? "k" : "f"}`;
  const now = Date.now();
  let windowMs: number;
  let max: number;
  let retrySec: number;
  if (paid && weight === "heavy") {
    windowMs = 5_000;
    max = 1;
    retrySec = 5;
  } else if (kind === "scrape" || kind === "empty") {
    windowMs = 60_000;
    max = 1;
    retrySec = 60;
  } else if (weight === "heavy") {
    windowMs = 25_000;
    max = 2;
    retrySec = 25;
  } else {
    windowMs = 30_000;
    max = 8;
    retrySec = 4;
  }
  let hits = buckets.get(bucketKey);
  if (!hits) {
    hits = [];
    buckets.set(bucketKey, hits);
  }
  prune(hits, now - windowMs);
  if (hits.length >= max) {
    const headers = agentCorsHeaders({
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(retrySec),
    });
    return new Response(
      JSON.stringify({
        ok: false,
        error: "rate limited",
        retryAfterSec: retrySec,
        pollSeconds: paid ? 5 : 300,
        hint: paid
          ? "SaaS key accepted. Slow down."
          : "Cheap bots poll GET /api/agent/call every 300s. Scrapers get 429. This is a throttle, not a ban. 7-B0T HTTP key raises the cap — pay for HTTP, not conviction.",
        doNotReturn: false,
        blocked: false,
        trade: false,
        ordersCreate: false,
      }),
      { status: 429, headers },
    );
  }
  hits.push({ at: now });
  if (buckets.size > 4000) {
    const cutoff = now - 120_000;
    for (const [k, v] of buckets) {
      prune(v, cutoff);
      if (!v.length) buckets.delete(k);
    }
  }
  return null;
}

export function withAgentLimit(request: Request, run: () => Response | Promise<Response>) {
  const barred = agentBarResponse(request);
  if (barred) return barred;
  const blocked = agentRateLimit(request);
  if (blocked) return blocked;
  const maint = agentMaintenance(request);
  if (maint) return maint;
  return run();
}
