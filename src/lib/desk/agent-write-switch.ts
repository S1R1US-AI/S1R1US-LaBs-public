/**
 * One server-side switch for the /api/agent write surface.
 *
 * Writes are OFF unless AGENT_WRITES_ENABLED is exactly the string "true".
 * Missing, empty, malformed or any other value keeps them off (fail closed).
 * While off, a write request gets a bare 404 before any auth or body parsing,
 * and agent CORS only allows GET. Reads stay up.
 */

export const AGENT_WRITES_ENV = "AGENT_WRITES_ENABLED";

type EnvLike = Record<string, string | undefined>;

function currentEnv(): EnvLike {
  return typeof process !== "undefined" && process.env ? (process.env as EnvLike) : {};
}

/** True only when the env value is exactly "true". */
export function agentWritesEnabled(env: EnvLike = currentEnv()): boolean {
  try {
    return env[AGENT_WRITES_ENV] === "true";
  } catch {
    return false;
  }
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Normalize a request path for matching: decode, collapse slashes, drop trailing slash, lower-case. */
export function normalizeAgentPath(pathname: string): string {
  let p = String(pathname || "/");
  try {
    p = decodeURIComponent(p);
  } catch {
    // keep the raw path; matching below still applies
  }
  p = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
  return p.toLowerCase();
}

export function isAgentApiPath(pathname: string): boolean {
  const p = normalizeAgentPath(pathname);
  return p === "/api/agent" || p.startsWith("/api/agent/");
}

/**
 * True when this request would write state on the agent API:
 * any non-read method, any method on an app-gateway route, or a ping GET
 * that records counters (anything other than ?peek=1).
 */
export function isAgentWriteRequest(method: string, pathname: string, search = ""): boolean {
  if (!isAgentApiPath(pathname)) return false;
  const m = String(method || "GET").toUpperCase();
  const p = normalizeAgentPath(pathname);
  if (!READ_METHODS.has(m)) return true;
  if (m === "OPTIONS") return false;
  if (p === "/api/agent/ping") {
    const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    return q.get("peek") !== "1";
  }
  return false;
}

/** Bare 404. Same shape for every blocked write; names no switch, env or route. */
export function agentWriteOffResponse(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Returns the 404 when the switch is off and the request is a write; otherwise null. */
export function agentWriteGate(
  method: string,
  pathname: string,
  search = "",
  env: EnvLike = currentEnv(),
): Response | null {
  if (!isAgentWriteRequest(method, pathname, search)) return null;
  if (agentWritesEnabled(env)) return null;
  return agentWriteOffResponse();
}

/** CORS methods for agent routes: GET only while writes are off. */
export function agentCorsMethods(env: EnvLike = currentEnv()): string {
  return agentWritesEnabled(env) ? "GET, POST, OPTIONS, DELETE" : "GET, OPTIONS";
}
