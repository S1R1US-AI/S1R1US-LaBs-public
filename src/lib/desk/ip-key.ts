/**
 * One key per visitor network for bars and limits: IPv6 by its /64, IPv4 as is.
 * Loopback, the unknown bucket, trusted proxies and shared ingress ranges are never keyed for a bar.
 */
import { isProxyAddress, limitKey, normalizeIp, UNKNOWN_CLIENT } from "./client-ip.ts";

const LOOPBACK = new Set(["local", "127.0.0.1", "::1", "0.0.0.0", "::ffff:127.0.0.1"]);

export function isLoopback(ip: string) {
  const t = ip.trim().toLowerCase();
  if (LOOPBACK.has(t)) return true;
  if (t.startsWith("127.") || t.startsWith("::ffff:127.")) return true;
  return false;
}

/**
 * One form for every stored and checked bar: IPv6 by its /64, IPv4 as is.
 * Older saved rows with a full IPv6 address still match. Returns "" for the
 * shared unknown bucket, which is rate-limited but never barred.
 */
export function banKey(ip: string | null | undefined): string {
  const t = String(ip ?? "").trim().toLowerCase();
  if (!t || t === UNKNOWN_CLIENT) return "";
  if (t.endsWith("/64")) {
    // A saved /64 key: write its network address the same way a full address is keyed,
    // so "2001:db8::/64" and a visitor from "2001:db8::1234" share one key.
    const n = normalizeIp(t.slice(0, -3));
    return (n && n.includes(":") && limitKey(n)) || t;
  }
  if (!t.includes(":")) return t;
  const n = normalizeIp(t);
  return (n && limitKey(n)) || t;
}

/** The all-zero /64 holds :: and ::1 and is never a real visitor network. */
const ZERO_64 = "0:0:0:0::/64";

/**
 * Loopback (checked on the raw address first), the unknown bucket, trusted
 * proxies and the private and shared ingress ranges are never barred, so one bar can't block everyone behind a proxy.
 */
export function canBan(ip: string | null | undefined): boolean {
  const raw = String(ip ?? "").trim().toLowerCase();
  if (!raw || isLoopback(raw) || raw === "::") return false;
  // A saved IPv6 key ends in /64. Check the network's own address, so a saved key inside an
  // ingress or trusted proxy range is never barred either.
  const n = normalizeIp(raw.endsWith("/64") ? raw.slice(0, -3) : raw);
  if (n && (isLoopback(n) || n === "::" || isProxyAddress(n))) return false;
  const k = banKey(raw);
  return Boolean(k) && k !== ZERO_64 && !isLoopback(k);
}
