/**
 * One trusted way to read the client IP. Server-only.
 *
 * Forwarding headers are only believed when the request came straight from a
 * trusted proxy. By default that is loopback: the front door in
 * scripts/do-start.mjs, which talks to the app on 127.0.0.1 and passes on the
 * visitor address it worked out itself. More proxies can be added with the
 * S1R1US_TRUSTED_PROXIES setting (comma-separated IPs or CIDRs).
 *
 * From a trusted proxy, only a valid `do-connecting-ip` is used. Without one
 * (missing, empty, junk, or another proxy's address) the visitor is unknown:
 * there is no `x-forwarded-for` or peer fallback, so a proxy's own address is
 * never a visitor key and one ban can't block everyone behind it. From anyone
 * else, the socket peer itself is the client, whatever headers it sends.
 * `x-forwarded-for`, `x-real-ip` and `cf-connecting-ip` are never used as the key.
 *
 * Proxy entries must be at least a /8 (IPv4) or a /32 (IPv6), so a typo can't
 * trust the whole internet. Octets with leading zeros, IPv6 zone ids and
 * IPv4-mapped IPv6 entries are rejected, the same as the front door.
 *
 * "local" is only returned in local development. Outside development, a
 * request with nothing usable shares one rate-limited bucket, which is never
 * barred. A forwarded value that claims to be loopback is ignored,
 * so nobody can opt out of limits by sending 127.0.0.1.
 */

export const PLATFORM_IP_HEADER = "do-connecting-ip";

type HeaderBag = { get?: (n: string) => string | null; [k: string]: unknown };

function readHeader(headers: unknown, name: string): string {
  if (!headers || typeof headers !== "object") return "";
  const rec = headers as HeaderBag;
  if (typeof rec.get === "function") return rec.get(name) ?? "";
  const v = rec[name] ?? rec[name.toLowerCase()];
  if (Array.isArray(v)) return v.map((x) => String(x ?? "")).join(",");
  return typeof v === "string" ? v : "";
}

/** Strip a port and brackets, and keep only characters an IP address can have. */
export function normalizeIp(raw: string): string {
  let t = String(raw ?? "").trim();
  if (!t) return "";
  if (t.startsWith("[")) {
    const end = t.indexOf("]");
    t = end > 0 ? t.slice(1, end) : t.slice(1);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(t)) {
    t = t.slice(0, t.lastIndexOf(":"));
  }
  t = t.toLowerCase();
  if (t.length > 64) return "";
  if (!/^[0-9a-f:.]+$/.test(t)) return "";
  if (!t.includes(".") && !t.includes(":")) return "";
  return t;
}

function loopbackLike(ip: string) {
  return (
    ip === "::1" ||
    ip === "0.0.0.0" ||
    ip === "::" ||
    ip.startsWith("127.") ||
    ip.startsWith("::ffff:127.")
  );
}

function usable(raw: string): string {
  const ip = normalizeIp(raw);
  if (!ip || loopbackLike(ip)) return "";
  return ip;
}

/** Dotted IPv4 octets, or null when any is above 255 or has a leading zero (as Node's isIP). */
function v4Octets(parts: string[]): number[] | null {
  if (parts.some((p) => p.length > 1 && p.startsWith("0"))) return null;
  const b = parts.map(Number);
  return b.some((n) => n > 255) ? null : b;
}

/** Expand an IPv6 address to 8 hextets, or null when it isn't valid IPv6. */
function ipv6Hextets(ip: string): number[] | null {
  let t = ip;
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(t);
  if (v4) {
    const b = v4Octets(v4.slice(1));
    if (!b) return null;
    t = t.slice(0, v4.index) + ((b[0]! << 8) | b[1]!).toString(16) + ":" + ((b[2]! << 8) | b[3]!).toString(16);
  }
  const parts = t.split("::");
  if (parts.length > 2) return null;
  const side = (x: string) => (x ? x.split(":") : []);
  const head = side(parts[0] ?? "");
  const rest = parts.length === 2 ? side(parts[1] ?? "") : [];
  const have = head.length + rest.length;
  if (parts.length === 1 ? have !== 8 : have > 7) return null;
  const all = [...head, ...Array.from({ length: 8 - have }, () => "0"), ...rest];
  if (all.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => parseInt(h, 16));
}

/**
 * Key used for limits and bans. IPv4 stays as is. IPv6 is grouped by its /64,
 * since one home or server usually gets a whole /64 and can rotate inside it.
 */
export function limitKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const h = ipv6Hextets(ip);
  if (!h) return "";
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    return `${h[6]! >> 8}.${h[6]! & 255}.${h[7]! >> 8}.${h[7]! & 255}`;
  }
  return `${h.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

function keyed(raw: string): string {
  const ip = usable(raw);
  if (!ip) return "";
  const key = limitKey(ip);
  return key && !loopbackLike(key) ? key : "";
}

/** True only when the server is explicitly running in local development. */
function devPreview(): boolean {
  return typeof process !== "undefined" && process.env?.NODE_ENV === "development";
}

/** The raw TCP peer of a request, when the server exposes it. Never a header. */
export function socketPeer(request: unknown): string {
  const r = request as { runtime?: { node?: { req?: { socket?: { remoteAddress?: unknown } } } } } | null;
  const addr = r?.runtime?.node?.req?.socket?.remoteAddress;
  return typeof addr === "string" ? addr : "";
}

/** Shared bucket for requests with nothing usable. It is rate-limited and can be barred. */
export const UNKNOWN_CLIENT = "unknown";

/** Setting that adds trusted proxies (comma-separated IPs or CIDRs). */
export const TRUSTED_PROXIES_ENV = "S1R1US_TRUSTED_PROXIES";
/** Loopback only: the front door on the same machine. */
const DEFAULT_TRUSTED_PROXIES = ["127.0.0.0/8", "::1/128"];

type Cidr = { v6: boolean; base: bigint; bits: number };

/** Shortest proxy prefix allowed. Anything wider (0.0.0.0/0, ::/0, /1...) is a bad entry. */
export const MIN_PROXY_PREFIX = { v4: 8, v6: 32 } as const;

/** An IP as a number, with IPv4-mapped IPv6 treated as IPv4. */
function ipValue(raw: string): { v6: boolean; n: bigint } | null {
  const ip = normalizeIp(raw);
  if (!ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const b = v4Octets(v4.slice(1));
    if (!b) return null;
    return { v6: false, n: BigInt(((b[0]! << 24) >>> 0) + (b[1]! << 16) + (b[2]! << 8) + b[3]!) };
  }
  if (!ip.includes(":")) return null;
  const h = ipv6Hextets(ip);
  if (!h) return null;
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return { v6: false, n: (BigInt(h[6]!) << 16n) | BigInt(h[7]!) };
  }
  return { v6: true, n: h.reduce((acc, x) => (acc << 16n) | BigInt(x), 0n) };
}

/**
 * Parse "1.2.3.4", "10.0.0.0/8" or "2001:db8::/32". Null when invalid, when
 * it has a zone id, when it is IPv4-mapped IPv6, or when the prefix is
 * shorter than MIN_PROXY_PREFIX.
 */
export function parseCidr(raw: string): Cidr | null {
  return parseRange(raw, true);
}

function parseRange(raw: string, enforceMinPrefix: boolean): Cidr | null {
  const t = String(raw ?? "").trim();
  if (!t || t.includes("%")) return null;
  const [addr, len, extra] = t.split("/");
  if (extra !== undefined || !addr) return null;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d, ::ffff:0:0/96): write the IPv4 range instead.
  const plain = normalizeIp(addr);
  if (plain.includes(":")) {
    const h = ipv6Hextets(plain);
    if (h && h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return null;
  }
  const v = ipValue(addr);
  if (!v) return null;
  const max = v.v6 ? 128 : 32;
  let bits = max;
  if (len !== undefined) {
    if (!/^\d{1,3}$/.test(len)) return null;
    bits = Number(len);
    if (bits > max) return null;
  }
  if (enforceMinPrefix && bits < (v.v6 ? MIN_PROXY_PREFIX.v6 : MIN_PROXY_PREFIX.v4)) return null;
  const shift = BigInt(max - bits);
  return { v6: v.v6, base: (v.n >> shift) << shift, bits };
}

let proxyCache: { env: string; list: Cidr[] } | null = null;
let warnedFor: string | null = null;

/** Trusted proxies: loopback plus any valid entries from the setting. Bad entries are ignored and logged once. */
export function trustedProxies(envValue?: string): Cidr[] {
  const env = envValue ?? (typeof process !== "undefined" ? (process.env?.[TRUSTED_PROXIES_ENV] ?? "") : "");
  if (proxyCache && proxyCache.env === env) return proxyCache.list;
  const list = DEFAULT_TRUSTED_PROXIES.map((c) => parseCidr(c)!);
  const bad: string[] = [];
  for (const entry of env.split(",").map((x) => x.trim()).filter(Boolean)) {
    const c = parseCidr(entry);
    if (c) list.push(c);
    else bad.push(entry.slice(0, 64));
  }
  if (bad.length && warnedFor !== env) {
    warnedFor = env;
    console.warn(`[s1r1us] ignored ${bad.length} invalid trusted proxy entr${bad.length === 1 ? "y" : "ies"}: ${bad.join(", ")}`);
  }
  proxyCache = { env, list };
  return list;
}

function inCidr(v: { v6: boolean; n: bigint }, c: Cidr): boolean {
  if (c.v6 !== v.v6) return false;
  const shift = BigInt((c.v6 ? 128 : 32) - c.bits);
  return (v.n >> shift) << shift === c.base;
}

/** True when the socket peer is a trusted proxy. */
export function isTrustedProxy(peer: string, envValue?: string): boolean {
  const v = ipValue(peer);
  if (!v) return false;
  return trustedProxies(envValue).some((c) => inCidr(v, c));
}

/**
 * Private and shared ranges. The hosting platform's ingress reaches the front door
 * from one of these, and its address can change on every request, so none of them
 * is ever a visitor: they are never keyed or barred. A visitor on the
 * internet can't connect from one of these. Same list as the front door.
 */
export const INGRESS_RANGES = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "169.254.0.0/16",
  "fc00::/7",
  "fe80::/10",
] as const;
const INGRESS = INGRESS_RANGES.map((r) => parseRange(r, false)!);

/** True for an address in a private or shared ingress range. */
export function isIngressAddress(ip: string): boolean {
  const v = ipValue(ip);
  return Boolean(v && INGRESS.some((c) => inCidr(v, c)));
}

/** True for any proxy address: a trusted proxy here, or an ingress range. Never barred. */
export function isProxyAddress(ip: string): boolean {
  return isIngressAddress(ip) || isTrustedProxy(ip);
}

let noPlatformCount = 0;
let noPlatformLoggedAt = 0;
/** Count-only, rate-limited log (at most once a minute). No addresses or header values. */
function noteNoPlatformAddress(now = Date.now()) {
  noPlatformCount++;
  if (now - noPlatformLoggedAt < 60_000) return;
  console.warn(`[s1r1us] ${noPlatformCount} request(s) without a platform address`);
  noPlatformCount = 0;
  noPlatformLoggedAt = now;
}

/**
 * Client IP for rate limits, bans and bars.
 * `socketIp` is the TCP peer, when the caller has it. Headers are only used
 * when that peer is a trusted proxy; with no peer they are ignored.
 * "local" (the exempt preview) is only returned in local development, with no
 * forwarding headers, and when the peer, if known, is loopback.
 */
export function trustedClientIp(headers: unknown, socketIp?: string | null): string {
  const rawPeer = normalizeIp(socketIp ?? "");
  if (rawPeer && isTrustedProxy(rawPeer)) {
    // Only a valid platform address, never the proxy itself or another proxy, so one ban can't block everyone.
    // The last entry: the front door sends one, and a platform that appends adds its own value last.
    const raw = readHeader(headers, PLATFORM_IP_HEADER).split(",").pop() ?? "";
    const platform = isProxyAddress(raw) ? "" : keyed(raw);
    if (platform) return platform;
    if (!(devPreview() && loopbackLike(rawPeer))) noteNoPlatformAddress();
  } else if (!isIngressAddress(rawPeer)) {
    // A private or shared peer is an ingress hop, never a visitor, so it is never a key.
    const peer = keyed(socketIp ?? "");
    if (peer) return peer;
  }
  const forwarded =
    readHeader(headers, PLATFORM_IP_HEADER) || readHeader(headers, "x-forwarded-for") || readHeader(headers, "x-real-ip");
  const peerIsLocal = !socketIp || (rawPeer !== "" && loopbackLike(rawPeer));
  if (devPreview() && !forwarded.trim() && peerIsLocal) return "local";
  return UNKNOWN_CLIENT;
}

export function trustedRequestIp(request: { headers: unknown }): string {
  return trustedClientIp(request.headers, socketPeer(request));
}
