#!/usr/bin/env node
/**
 * DigitalOcean App Platform / Docker entry.
 *
 * Security path A — soft-launch front-door static overlay:
 * - External PORT (default 8080): tiny Node HTTP front door
 * - Serves front-door-static/ for home, hello-world, discord, roadmap, Research, desk overlays + shared assets
 * - Proxies everything else to Nitro on internal 8081
 *
 * Soft-launch routes (/, /hello-world, /discord, /roadmap, /r0b0ts, /h1v3, /pr3d, /faq, /compute, /gm, /f33d, /forum, /agent, /board, /labs, /owl, /app, /ios, /play, /c0ff33, /sponsor-…, /media, /b3ars, /l0ck, /bowl, /w0rld, /c0ut, /Bitcoin-Miners, /wh1t3, /s1r1us, /sitemap, /search, /terms, /privacy, /copyright-terms, /WEB-3-and-ai-future) always overlay — no env gate.
 * Does not touch Grok live preview (:8080 dev) or regenerate .output.
 */
import { createReadStream, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import http from "node:http";
import { BlockList, isIP } from "node:net";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXTERNAL_PORT = String(process.env.PORT || process.env.NITRO_PORT || "8080");
const HOST = process.env.HOST || process.env.NITRO_HOST || "0.0.0.0";
const NITRO_INTERNAL_PORT = "8081";
const STATIC_ROOT = join(ROOT, "front-door-static");

const candidates = [
  join(ROOT, ".output/server/index.mjs"),
  join(ROOT, ".output/server/index.js"),
  join(ROOT, "dist/server/index.mjs"),
];
// Only boot when run directly (node scripts/do-start.mjs); importing for tests must not spawn Nitro.
const IS_MAIN = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
const entry = candidates.find((p) => existsSync(p));
if (IS_MAIN && !entry) {
  console.error(
    "[s1r1us] no node-server build. On DigitalOcean the Docker image must run npm run build:do (NITRO_PRESET=node-server).",
  );
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** Page-code families that only the current build may serve (admin and its shared panels). */
const ADMIN_FAMILY = /^(?:admin|app_\.admin|btc-miners-panel|pdf)-[\w-]+\.js$/;
export const RETIRED_ASSET_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Baseline browser safety headers on every front-door reply (static, proxied and errors).
 * A header the reply sets itself is kept only when it is the same or stronger; a weaker one is
 * replaced by the baseline. Framing is limited to this site, not blocked outright,
 * because the admin page shows this site's own pages and files in frames.
 */
export const frontDoorSecurityHeaders = {
  "Content-Security-Policy": "frame-ancestors 'self'",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};
/** One-year HSTS for this host and its subdomains (no preload), sent only on HTTPS requests. */
export const frontDoorHsts = "max-age=31536000; includeSubDomains";

function isHttpsRequest(req) {
  if (req.socket && req.socket.encrypted) return true;
  const proto = req.headers && req.headers["x-forwarded-proto"];
  const first = String(Array.isArray(proto) ? proto[0] : proto || "").split(",")[0].trim().toLowerCase();
  return first === "https";
}

const HSTS_MIN_SECONDS = 31536000;
/** Referrer policies that send the same or less than the baseline. */
const STRONG_REFERRER = new Set(["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"]);
const KNOWN_REFERRER = new Set([
  ...STRONG_REFERRER,
  "no-referrer-when-downgrade",
  "origin",
  "origin-when-cross-origin",
  "unsafe-url",
]);

const asList = (value) => (Array.isArray(value) ? value : [value]).map((v) => String(v));

/** Frame option: only DENY or SAMEORIGIN, sent once, is the same or stronger. */
function frameOptionsValue(value) {
  const list = asList(value).map((v) => v.trim().toUpperCase());
  if (list.length === 1 && (list[0] === "DENY" || list[0] === "SAMEORIGIN")) return list[0];
  return frontDoorSecurityHeaders["X-Frame-Options"];
}

/** A policy limits framing when its frame-ancestors sources are only 'self' and/or 'none'. */
function policyLimitsFraming(policy) {
  for (const directive of policy.split(";")) {
    const parts = directive.trim().split(/\s+/);
    if (parts[0].toLowerCase() !== "frame-ancestors") continue;
    const sources = parts.slice(1).map((s) => s.toLowerCase());
    return sources.length > 0 && sources.every((s) => s === "'self'" || s === "'none'");
  }
  return false;
}

/** Keeps the reply's own policy; adds the baseline policy when none of them limits framing. */
function contentSecurityPolicyValue(value) {
  const list = asList(value).filter((v) => v.trim() !== "");
  const policies = list.flatMap((v) => v.split(","));
  if (policies.some(policyLimitsFraming)) return list.length === 1 ? list[0] : list;
  return [...list, frontDoorSecurityHeaders["Content-Security-Policy"]];
}

function contentTypeOptionsValue(value) {
  const list = asList(value).map((v) => v.trim().toLowerCase());
  return list.length === 1 && list[0] === "nosniff" ? "nosniff" : frontDoorSecurityHeaders["X-Content-Type-Options"];
}

/** The browser uses the last policy it knows, so that one decides. */
function referrerPolicyValue(value) {
  const tokens = asList(value)
    .join(",")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => KNOWN_REFERRER.has(v));
  const last = tokens[tokens.length - 1];
  return last && STRONG_REFERRER.has(last) ? asList(value).join(", ") : frontDoorSecurityHeaders["Referrer-Policy"];
}

/** Keeps the reply's HSTS when its max-age is at least the baseline (the app's longer value stays). */
function hstsValue(value) {
  const list = asList(value);
  if (list.length === 1) {
    const m = /(?:^|;)\s*max-age\s*=\s*"?(\d+)"?\s*(?:;|$)/i.exec(list[0]);
    if (m && Number(m[1]) >= HSTS_MIN_SECONDS) return list[0];
  }
  return frontDoorHsts;
}

const GUARDED = [
  ["Content-Security-Policy", contentSecurityPolicyValue],
  ["X-Frame-Options", frameOptionsValue],
  ["X-Content-Type-Options", contentTypeOptionsValue],
  ["Referrer-Policy", referrerPolicyValue],
];

/** Header object from any writeHead form: object, flat [name, value, ...] list, or [[name, value], ...]. */
function headersToObject(headers) {
  if (!Array.isArray(headers)) return { ...headers };
  const out = {};
  const pairs = headers.length && Array.isArray(headers[0]) ? headers : [];
  if (!pairs.length) for (let i = 0; i + 1 < headers.length; i += 2) pairs.push([headers[i], headers[i + 1]]);
  for (const [name, value] of pairs) {
    if (!name) continue;
    out[name] = name in out ? [...asList(out[name]), ...asList(value)] : value;
  }
  return out;
}

/** Removes a header (any letter case) from obj and returns its value, or undefined. */
function takeHeader(obj, name) {
  let found;
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() !== name.toLowerCase()) continue;
    found = obj[key];
    delete obj[key];
  }
  return found;
}

/**
 * Final value of each guarded header for one reply: the reply's own value (writeHead first, then
 * setHeader) when it is the same or stronger, otherwise the baseline. Exported for tests.
 */
export function resolveFrontDoorSecurityHeaders(own, https) {
  const out = {};
  for (const [name, pick] of GUARDED) {
    const value = own[name.toLowerCase()];
    out[name] = value == null ? frontDoorSecurityHeaders[name] : pick(value);
  }
  const hsts = own["strict-transport-security"];
  if (https) out["Strict-Transport-Security"] = hsts == null ? frontDoorHsts : hstsValue(hsts);
  else if (hsts != null) out["Strict-Transport-Security"] = hsts;
  return out;
}

/** Sets the baseline headers before any handler runs and checks the reply's own values when headers are sent. */
export function applyFrontDoorSecurityHeaders(req, res) {
  const https = isHttpsRequest(req);
  for (const [name, value] of Object.entries(frontDoorSecurityHeaders)) res.setHeader(name, value);
  if (https) res.setHeader("Strict-Transport-Security", frontDoorHsts);
  const writeHead = res.writeHead;
  res.writeHead = function guardedWriteHead(statusCode, ...rest) {
    let reason;
    let headers;
    if (typeof rest[0] === "string") [reason, headers] = rest;
    else [headers] = rest;
    const passed = headers ? headersToObject(headers) : {};
    const own = {};
    for (const name of [...GUARDED.map(([n]) => n), "Strict-Transport-Security"]) {
      const fromWriteHead = takeHeader(passed, name);
      const value = fromWriteHead !== undefined ? fromWriteHead : res.getHeader(name);
      if (value != null) own[name.toLowerCase()] = value;
    }
    const final = resolveFrontDoorSecurityHeaders(own, https);
    if (!final["Strict-Transport-Security"]) res.removeHeader("Strict-Transport-Security");
    for (const [name, value] of Object.entries(final)) res.setHeader(name, value);
    return reason === undefined ? writeHead.call(this, statusCode, passed) : writeHead.call(this, statusCode, reason, passed);
  };
}

/** Lower-cased names of the current build's files in those families (public and gated). */
export function currentAdminFamily(root = ROOT) {
  const names = new Set();
  let list = null;
  try {
    list = JSON.parse(readFileSync(join(root, ".output/server/admin-assets/admin-assets.json"), "utf8"));
  } catch {
    /* nothing gated */
  }
  for (const f of list?.files ?? []) names.add(String(f).toLowerCase());
  if (Array.isArray(list?.public)) {
    // The build's own list wins, so a stale file left on disk is still denied.
    for (const f of list.public) names.add(String(f).toLowerCase());
    return names;
  }
  try {
    for (const f of readdirSync(join(root, ".output/public/assets"))) if (ADMIN_FAMILY.test(f.toLowerCase())) names.add(f.toLowerCase());
  } catch {
    /* no build */
  }
  return names;
}

/** Lower-cased names of the gated (sign-in only) files of the current build. */
export function gatedAdminAssets(root = ROOT) {
  try {
    const list = JSON.parse(readFileSync(join(root, ".output/server/admin-assets/admin-assets.json"), "utf8"));
    return new Set((list.files ?? []).map((f) => String(f).toLowerCase()));
  } catch {
    return new Set();
  }
}

/** Gated page code must never be stored by a browser or shared cache, whatever the app answers. */
export function privateAssetHeaders(upHeaders) {
  const out = {};
  for (const [k, v] of Object.entries(upHeaders)) {
    const key = k.toLowerCase();
    if (key === "cache-control" || key === "etag" || key === "last-modified" || key === "expires" || key === "vary") continue;
    out[k] = v;
  }
  out["cache-control"] = "private, no-store";
  out.vary = "Cookie";
  return out;
}

/**
 * True when the path asks for admin-family page code that is not part of the current
 * build (a name from an older deploy, or any source map). Those get a private 404.
 */
export function isRetiredAdminAsset(pathname, current) {
  let p = String(pathname || "");
  for (let i = 0; i < 3; i += 1) {
    try {
      const d = decodeURIComponent(p);
      if (d === p) break;
      p = d;
    } catch {
      break;
    }
  }
  p = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
  if (!p.startsWith("/assets/")) return false;
  let name = p.slice(p.lastIndexOf("/") + 1);
  const isMap = name.endsWith(".map");
  if (isMap) name = name.slice(0, -4);
  if (!ADMIN_FAMILY.test(name)) return false;
  // Current names are served only at their plain path; any encoded or odd spelling is denied here.
  if (!/^\/assets\/[\w.-]+$/.test(String(pathname))) return true;
  return isMap || !current.has(name);
}
let adminFamilyCache = null;
let gatedAssetCache = null;

function safeJoin(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  const cleaned = decoded.replace(/^\/+/, "");
  if (cleaned.includes("\0") || cleaned.split(/[/\\]/).some((p) => p === "..")) {
    return null;
  }
  const target = resolve(root, cleaned);
  const rootResolved = resolve(root);
  if (target !== rootResolved && !target.startsWith(rootResolved + sep)) {
    return null;
  }
  // Explicit containment barrier (CodeQL js/path-injection recognizes this form):
  // a path that escapes root has a relative form of ".." or "../…".
  const rel = relative(rootResolved, target);
  if (rel === ".." || rel.startsWith(".." + sep)) {
    return null;
  }
  return target;
}

function fileIfExists(absPath) {
  if (!absPath || !existsSync(absPath)) return null;
  try {
    const st = statSync(absPath);
    if (st.isFile()) return absPath;
    if (st.isDirectory()) {
      const index = join(absPath, "index.html");
      if (existsSync(index) && statSync(index).isFile()) return index;
    }
  } catch {
    return null;
  }
  return null;
}

/** Map request pathname → absolute file under front-door-static, or null to proxy. */
function resolveStatic(pathname) {
  if (!existsSync(STATIC_ROOT)) return null;

  // Exact home
  if (pathname === "/" || pathname === "/index.html") {
    return fileIfExists(join(STATIC_ROOT, "index.html"));
  }

  // Root favicon aliases → pack images (only if present)
  const faviconMap = {
    "/favicon.ico": "images/favicon.ico",
    "/favicon.svg": "images/favicon.svg",
    "/apple-touch-icon.png": "images/apple-touch-icon.png",
  };
  if (Object.prototype.hasOwnProperty.call(faviconMap, pathname)) {
    return fileIfExists(join(STATIC_ROOT, faviconMap[pathname]));
  }

  // Prefix routes: hello-world, discord, roadmap, 7 desk overlays, css, js, images
  const prefixes = ["/hello-world", "/discord", "/roadmap", "/r0b0ts", "/h1v3", "/pr3d", "/faq", "/compute", "/gm", "/f33d", "/forum", "/agent", "/board", "/labs", "/owl", "/app", "/ios", "/play", "/c0ff33", "/sponsor-ai-bitcoin-trading-bot", "/media", "/b3ars", "/l0ck", "/bowl", "/w0rld", "/c0ut", "/Bitcoin-Miners", "/wh1t3", "/s1r1us", "/sitemap", "/search", "/terms", "/privacy", "/copyright-terms", "/WEB-3-and-ai-future", "/sense1-engineering", "/sai-citizens-united", "/manifesto", "/oss-marketing", "/newsletter", "/escape-the-matrix", "/global-uprisings", "/future", "/cosmic-c0d3", "/blast-off", "/book-dj-mo-funky", "/dmt", "/dripped-out-matrix", "/hindu-teachings", "/what-inspired-us", "/css", "/js", "/images"];
  const hit = prefixes.find(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (!hit) return null;

  const abs = safeJoin(STATIC_ROOT, pathname);
  if (!abs) return null; // traversal → treat as miss (will 404 via missing file or proxy)

  // Directory without trailing slash: serve index if present
  const asFile = fileIfExists(abs);
  if (asFile) return asFile;

  // /hello-world → /hello-world/index.html etc.
  if (pathname === hit || pathname === hit + "/") {
    return fileIfExists(join(STATIC_ROOT, hit.slice(1), "index.html"));
  }

  return null;
}

/** Weak validator from size + mtime; used for ETag and If-Range matching. */
export function staticValidators(st) {
  return {
    etag: `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
    lastModified: new Date(Math.floor(st.mtimeMs / 1000) * 1000).toUTCString(),
  };
}

/**
 * If-Range: a partial response is allowed only when the validator matches the
 * current representation. Weak ETags are not strong validators per RFC 9110,
 * but this server's W/"size-mtime" is stable for an unchanged file, so we accept
 * an exact match (as Express/send does). HTTP-date must equal Last-Modified.
 */
function ifRangeMatches(ifRange, v) {
  const val = String(ifRange).trim();
  if (val.startsWith('"') || val.startsWith("W/")) return val === v.etag;
  const t = Date.parse(val);
  return !Number.isNaN(t) && t === Date.parse(v.lastModified);
}

export async function serveStatic(res, absPath, req) {
  const type = MIME[extname(absPath).toLowerCase()] || "application/octet-stream";
  const st = statSync(absPath);
  const size = st.size;
  const v = staticValidators(st);
  const method = (req && req.method) || "GET";
  const base = {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=60",
    "Accept-Ranges": "bytes",
    ETag: v.etag,
    "Last-Modified": v.lastModified,
  };
  const headers = (req && req.headers) || {};
  // Ranges apply only to GET; HEAD gets full 200 headers. Unmatched If-Range → full 200.
  const range =
    method === "GET" && headers.range && (headers["if-range"] == null || ifRangeMatches(headers["if-range"], v))
      ? headers.range
      : null;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    let start = m && m[1] !== "" ? Number(m[1]) : NaN;
    let end = m && m[2] !== "" ? Number(m[2]) : NaN;
    if (m && m[1] === "" && m[2] !== "") {
      start = Math.max(0, size - end);
      end = size - 1;
      if (Number(m[2]) === 0) start = size; // bytes=-0 is unsatisfiable
    } else if (m && !Number.isNaN(start) && Number.isNaN(end)) {
      end = size - 1;
    }
    if (!m || Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      res.writeHead(416, { ...base, "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    end = Math.min(end, size - 1);
    res.writeHead(206, {
      ...base,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    });
    await pipeline(createReadStream(absPath, { start, end }), res);
    return;
  }
  res.writeHead(200, { ...base, "Content-Length": String(size) });
  if (method === "HEAD") return void res.end();
  await pipeline(createReadStream(absPath), res);
}

// Upstream port for the proxy; startFrontDoor() may override it (tests use a stub upstream).
let upstreamPort = NITRO_INTERNAL_PORT;

// Addresses that are never a visitor: loopback, plus the private and shared
// ranges that DigitalOcean App Platform's own ingress can connect from. A
// platform header holding one of these is not used. The TCP peer is never the
// visitor at all (see visitorAddress). S1R1US_TRUSTED_PROXIES adds more
// (comma-separated IPs or CIDRs); the app behind us reads the same setting.
export const TRUSTED_PROXIES_ENV = "S1R1US_TRUSTED_PROXIES";
/** Private and shared ingress ranges (same list as INGRESS_RANGES in the app). */
export const INGRESS_RANGES = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "169.254.0.0/16",
  "fc00::/7",
  "fe80::/10",
];
export const FRONT_DOOR_TRUSTED_DEFAULT = ["127.0.0.0/8", "::1/128", ...INGRESS_RANGES];
const PLATFORM_IP_HEADER = "do-connecting-ip";
/** Headers that claim a visitor address. Replaced, never passed through. */
const CLIENT_ADDRESS_HEADERS = [PLATFORM_IP_HEADER, "x-forwarded-for", "x-real-ip"];

/** Shortest proxy prefix allowed (matches the app). Wider entries are bad entries. */
export const MIN_PROXY_PREFIX = { v4: 8, v6: 32 };

/** Plain IP (no brackets, port or IPv4-mapped prefix), or "" when invalid. Zone ids are rejected. */
export function plainIp(raw) {
  let t = String(raw ?? "").trim();
  if (t.includes("%")) return "";
  if (t.startsWith("[")) t = t.slice(1, t.indexOf("]") > 0 ? t.indexOf("]") : undefined);
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(t)) t = t.slice(0, t.lastIndexOf(":"));
  t = t.toLowerCase();
  if (/^::ffff:\d{1,3}(\.\d{1,3}){3}$/.test(t)) t = t.slice(7);
  return isIP(t) ? t : "";
}

const MAPPED = new BlockList();
MAPPED.addSubnet("::ffff:0:0", 96, "ipv6");

let warnedTrustedFor = null;
/**
 * Build the trusted proxy list. Invalid entries (including prefixes shorter
 * than MIN_PROXY_PREFIX) are ignored and logged once. IPv4 and IPv6 are kept
 * apart, so an IPv6 range never trusts an IPv4 peer.
 */
export function trustedProxyList(envValue = process.env[TRUSTED_PROXIES_ENV] || "", defaults = FRONT_DOOR_TRUSTED_DEFAULT) {
  const v4 = new BlockList();
  const v6 = new BlockList();
  const bad = [];
  // Built-in entries skip the shortest-prefix rule (fc00::/7 is wider than /32); the setting never does.
  const add = (entry, builtIn = false) => {
    const [addr, len, extra] = entry.split("/");
    const ip = plainIp(addr);
    const family = isIP(ip);
    // IPv4-mapped IPv6 (::ffff:a.b.c.d, ::ffff:0:0/96) is a bad entry, as in the app: write the IPv4 range.
    if ((family === 4 && String(addr).includes(":")) || (family === 6 && MAPPED.check(ip, "ipv6"))) return false;
    const max = family === 6 ? 128 : 32;
    if (!ip || extra !== undefined || (len !== undefined && (!/^\d{1,3}$/.test(len) || Number(len) > max))) return false;
    const bits = len === undefined ? max : Number(len);
    if (!builtIn && bits < (family === 6 ? MIN_PROXY_PREFIX.v6 : MIN_PROXY_PREFIX.v4)) return false;
    if (family === 6) v6.addSubnet(ip, bits, "ipv6");
    else v4.addSubnet(ip, bits, "ipv4");
    return true;
  };
  for (const d of defaults) add(d, true);
  for (const entry of String(envValue).split(",").map((x) => x.trim()).filter(Boolean)) {
    if (!add(entry)) bad.push(entry.slice(0, 64));
  }
  if (bad.length && warnedTrustedFor !== envValue) {
    warnedTrustedFor = envValue;
    console.warn(`[s1r1us] ignored ${bad.length} invalid trusted proxy entr${bad.length === 1 ? "y" : "ies"}: ${bad.join(", ")}`);
  }
  return {
    /** True when `ip` (already plain) is inside a trusted range of its own family. */
    check(ip) {
      const family = isIP(ip);
      if (family === 4) return v4.check(ip, "ipv4");
      if (family === 6) return v6.check(ip, "ipv6");
      return false;
    },
  };
}

function headerValue(v) {
  return Array.isArray(v) ? v.join(",") : typeof v === "string" ? v : "";
}

/**
 * The visitor address for a request, or "" when it is unknown.
 *
 * The front door only runs behind the hosting platform's ingress: the app's port
 * can't be reached any other way. So the TCP peer is always an ingress hop, and its
 * address can change on every request. It is never the visitor, whatever range it
 * is in, so one visitor can't get a new limit per request and a ban can't land on a
 * shared hop.
 *
 * The visitor is the platform header's last entry (the platform adds its own value
 * last), when it is a valid address that is not loopback, an ingress range or a
 * trusted proxy. Forwarded-for and x-real-ip are never used. Otherwise the visitor
 * is unknown: one shared, rate-limited bucket that is never barred.
 */
export function visitorAddress(headers, _peerRaw, trusted) {
  const entries = headerValue(headers?.[PLATFORM_IP_HEADER]).split(",");
  const platform = plainIp(entries[entries.length - 1]);
  if (platform && !trusted.check(platform)) return platform;
  noteNoPlatformAddress();
  return "";
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

let trustedProxies = null;

/**
 * Headers for the app: visitor-address claims removed, then our own answer
 * added, in the platform header and as a single fresh forwarded-for entry
 * (which the sign-in library reads for its own limits). When the visitor is
 * unknown nothing is added, and the app puts the request in its shared,
 * rate-limited, never-barred bucket.
 */
export function upstreamHeaders(req, trusted = trustedProxies || trustedProxyList()) {
  const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}` };
  const visitor = visitorAddress(req.headers, req.socket?.remoteAddress, trusted);
  for (const h of CLIENT_ADDRESS_HEADERS) delete headers[h];
  if (visitor) {
    headers[PLATFORM_IP_HEADER] = visitor;
    headers["x-forwarded-for"] = visitor;
  }
  return headers;
}

// Our own public hosts (mirrors PUBLIC_SITE_HOSTS in src/lib/auth/server.ts).
export const OWN_HOSTS = new Set(["s1r1us.ai", "www.s1r1us.ai"]);
// External https hosts an upstream redirect may point to: native X OAuth only (Better Auth
// `twitter` provider, https://x.com/i/oauth2/authorize). The Grok broker is off in production.
// Kept in sync by a front-proxy location test.
export const TRUSTED_REDIRECT_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "api.x.com",
  "twitter.com",
  "www.twitter.com",
  "api.twitter.com",
]);

/** True for loopback / unspecified hosts as WHATWG URL serializes them (case-insensitive). */
export function isInternalHost(hostname) {
  let h = String(hostname || "").toLowerCase();
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || /^0\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h === "::1" || h === "::") return true;
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:XXXX:XXXX): loopback 127/8 or 0/8
  const mapped = /^::ffff:(?:(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}|([0-9a-f]{1,4}):[0-9a-f]{1,4})$/.exec(h);
  if (mapped) {
    const first = mapped[1] != null ? Number(mapped[1]) : parseInt(mapped[2], 16) >> 8;
    return first === 127 || first === 0;
  }
  return false;
}

/** Drop ASCII tab/CR/LF/NUL anywhere and leading whitespace/control chars (browsers ignore them). */
function stripIgnorable(value) {
  const s = String(value).replace(/[\t\r\n]/g, "").split("\0").join("");
  let i = 0;
  while (i < s.length && s.charCodeAt(i) <= 0x20) i++;
  return s.slice(i);
}

/** Collapse leading slashes/backslashes so a path can never be read as another host. */
function singleLeadingSlash(path) {
  return "/" + String(path).replace(/^[/\\]+/, "");
}

/**
 * Upstream Location → safe value for the browser (allowlist):
 * - https on a TRUSTED_REDIRECT_HOSTS host (no credentials, default port) passes through;
 * - our own host or a loopback/internal host → same-origin relative path;
 * - any other absolute URL → "/";
 * - relative paths keep exactly one leading slash.
 */
export function safeLocation(loc) {
  if (loc == null) return loc;
  const s = stripIgnorable(Array.isArray(loc) ? loc[0] : loc);
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    let u;
    try {
      u = new URL(s);
    } catch {
      return "/";
    }
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    if (u.protocol === "https:" && TRUSTED_REDIRECT_HOSTS.has(host) && !u.username && !u.password && !u.port) {
      return u.href;
    }
    if (OWN_HOSTS.has(host) || isInternalHost(host)) {
      return singleLeadingSlash(u.pathname) + u.search + u.hash;
    }
    return "/";
  }
  if (s.startsWith("/") || s.startsWith("\\")) return singleLeadingSlash(s);
  return s;
}

/**
 * True only for a same-origin path: one leading slash not followed by a slash or
 * backslash (which a browser could read as another host), and no control characters.
 */
export function isLocalUrl(loc) {
  if (typeof loc !== "string" || !loc.startsWith("/") || /^\/[/\\]/.test(loc)) return false;
  for (let i = 0; i < loc.length; i++) {
    const c = loc.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false;
  }
  return true;
}

/**
 * Request target → origin-form. Returns { url } to continue, { status: 400 } to reject,
 * or { status: 308, location } for a same-origin redirect. Tab/CR/LF and leading whitespace
 * are dropped; backslashes (raw or %5C) are rejected; absolute-form targets drop their
 * authority; repeated leading slashes collapse.
 */
export function normalizeRequestTarget(raw) {
  let target = String(raw || "/");
  if (target.includes("\0")) return { status: 400 };
  target = stripIgnorable(target);
  if (!target.startsWith("/")) {
    if (target === "*" || target === "") return { status: 400 };
    try {
      const u = new URL(target);
      target = (u.pathname || "/") + u.search;
    } catch {
      return { status: 400 };
    }
  }
  const qAt = target.indexOf("?");
  const path = qAt === -1 ? target : target.slice(0, qAt);
  const query = qAt === -1 ? "" : target.slice(qAt);
  if (/\\|%5c/i.test(path)) return { status: 400 };
  if (/^\/{2,}/.test(path)) return { status: 308, location: singleLeadingSlash(path) + query };
  return { url: target };
}

export const APEX_HOST = "s1r1us.ai";

/**
 * Permanent redirect target for a request on the wrong host or scheme, or null to continue:
 * www.s1r1us.ai goes to the apex, and plain http on the apex goes to https. `target` is the
 * normalized origin-form path (one leading slash), so the Location always stays on the apex.
 */
export function canonicalRedirect(req, target) {
  const rawHost = req.headers && req.headers.host;
  const host = String(Array.isArray(rawHost) ? rawHost[0] : rawHost || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  if (!OWN_HOSTS.has(host) || !isLocalUrl(target)) return null;
  const proto = req.headers["x-forwarded-proto"];
  const first = String(Array.isArray(proto) ? proto[0] : proto || "").split(",")[0].trim().toLowerCase();
  if (host !== APEX_HOST || first === "http") return `https://${APEX_HOST}${target}`;
  return null;
}

/**
 * Strip CR, LF, and other control characters (C0, DEL, C1 0x80-0x9f, and the
 * Unicode line and paragraph separators) so request-controlled text cannot wrap
 * log lines or send terminal control sequences.
 */
export function logSafe(value) {
  return String(value ?? "")
    .replace(/[\r\n]/g, "")
    .replace(/[\s\S]/g, (ch) => {
      const code = ch.charCodeAt(0);
      if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f) || code === 0x2028 || code === 0x2029) return "";
      return ch;
    });
}

/** Data replies under /api/ are for programs, not search results: ask crawlers not to index them. */
export function isApiPath(url) {
  const path = String(url || "").split(/[?#]/, 1)[0];
  return path === "/api" || path.startsWith("/api/");
}

function proxyToNitro(req, res, { privateAsset = false } = {}) {
  const headers = upstreamHeaders(req);
  const opts = {
    hostname: "127.0.0.1",
    port: Number(upstreamPort),
    path: req.url,
    method: req.method,
    headers,
  };
  res.on("error", (err) => console.error("[s1r1us] client response error:", logSafe(err.message)));
  const upstream = http.request(opts, (up) => {
    up.on("error", () => res.destroy());
    const outHeaders = privateAsset ? privateAssetHeaders(up.headers) : { ...up.headers };
    if (outHeaders.location != null) outHeaders.location = safeLocation(outHeaders.location);
    if (isApiPath(req.url)) outHeaders["x-robots-tag"] = "noindex";
    res.writeHead(up.statusCode || 502, outHeaders);
    up.pipe(res);
  });
  upstream.on("error", (err) => {
    console.error("[s1r1us] nitro proxy error:", logSafe(err.message));
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad Gateway");
    } else {
      res.destroy();
    }
  });
  req.pipe(upstream);
}

export function startFrontDoor({
  port = EXTERNAL_PORT,
  host = HOST,
  nitroPort = NITRO_INTERNAL_PORT,
  trustedProxyEnv = process.env[TRUSTED_PROXIES_ENV] || "",
  trustedDefaults = FRONT_DOOR_TRUSTED_DEFAULT,
} = {}) {
  upstreamPort = String(nitroPort);
  trustedProxies = trustedProxyList(trustedProxyEnv, trustedDefaults);
  const handleRequest = async (req, res) => {
    // Normalize the request target before any routing or proxying.
    const target = normalizeRequestTarget(req.url);
    if (target.status === 400) {
      console.log(`[s1r1us] front-door 400 request target`);
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad Request");
      return;
    }
    if (target.status === 308) {
      const location = target.location;
      if (!isLocalUrl(location)) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Bad Request");
        return;
      }
      // Fixed "/./" prefix keeps the redirect on this site; browsers resolve it to the same path.
      res.writeHead(308, { Location: "/./" + location.slice(1), "Cache-Control": "public, max-age=60" });
      res.end();
      return;
    }
    const canonical = canonicalRedirect(req, target.url);
    if (canonical) {
      res.writeHead(301, { Location: canonical, "Cache-Control": "public, max-age=3600" });
      res.end();
      return;
    }
    req.url = target.url;
    const url = req.url;
    let pathname = "/";
    try {
      pathname = new URL(url, "http://localhost").pathname;
    } catch {
      pathname = "/";
    }

    // Sensei HOLD fix: GET /search?q= must reach Nitro desk search — do not swallow with static overlay.
    // Bare /search (no q) still serves soft-launch marketing shell.
    try {
      const u = new URL(url, "http://localhost");
      const q = u.searchParams.get("q");
      if ((u.pathname === "/search" || u.pathname === "/search/") && q != null && String(q).length > 0) {
        console.log(`[s1r1us] front-door proxy Nitro search q ${logSafe(req.method)} ${logSafe(u.pathname)}`);
        return proxyToNitro(req, res);
      }
    } catch {
      /* fall through */
    }

    // Belt-and-suspenders: /roadmap → /roadmap/ etc. Absolute CSS is the real fix for theme-css-miss.
    const dirExact = [      "/hello-world",
      "/discord",
      "/roadmap",
      "/r0b0ts",
      "/h1v3",
      "/pr3d",
      "/faq",
      "/compute",
      "/gm",
      "/f33d",
      "/forum",
      "/agent",
      "/board",
      "/labs",
      "/owl",
      "/app",
      "/ios",
      "/play",
      "/c0ff33",
      "/sponsor-ai-bitcoin-trading-bot",
      "/media",
      "/b3ars",
      "/l0ck",
      "/bowl",
      "/w0rld",
      "/c0ut",
      "/Bitcoin-Miners",
      "/wh1t3",
      "/s1r1us",
      "/sitemap",
      "/search",
      "/terms",
      "/privacy",
      "/copyright-terms",
      "/WEB-3-and-ai-future",
      "/sense1-engineering",
      "/sai-citizens-united",
      "/manifesto",
      "/oss-marketing",
      "/newsletter",
      "/escape-the-matrix",
      "/global-uprisings",
      "/future",
      "/cosmic-c0d3",
      "/blast-off",
      "/book-dj-mo-funky",
      "/dmt",
      "/dripped-out-matrix",
      "/hindu-teachings",
      "/what-inspired-us",
    ];
    if (dirExact.includes(pathname)) {
      const q = (url.includes("?") ? url.slice(url.indexOf("?")) : "");
      const loc = pathname + "/" + q;
      console.log(`[s1r1us] front-door static overlay 308 ${logSafe(pathname)} → ${logSafe(pathname)}/`);
      res.writeHead(308, { Location: loc, "Cache-Control": "public, max-age=60" });
      res.end();
      return;
    }

    // Malformed percent-encoding in the path → 400 (never reaches static resolve or Nitro)
    try {
      decodeURIComponent(pathname);
    } catch {
      console.log(`[s1r1us] front-door 400 malformed path encoding`);
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad Request");
      return;
    }

    // Reject obvious traversal in path before static resolve
    if (pathname.includes("..") || pathname.includes("%2e%2e") || pathname.includes("%2E%2E")) {
      console.log(`[s1r1us] front-door static overlay 400 ${logSafe(pathname)}`);
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad Request");
      return;
    }

    // Admin-family page code: only the current build's names. Older names get a private 404.
    adminFamilyCache ??= currentAdminFamily();
    if (isRetiredAdminAsset(pathname, adminFamilyCache)) {
      res.writeHead(404, RETIRED_ASSET_HEADERS);
      res.end(req.method === "HEAD" ? undefined : "Not Found");
      return;
    }
    gatedAssetCache ??= gatedAdminAssets();
    if (pathname.startsWith("/assets/") && gatedAssetCache.has(pathname.slice(8).toLowerCase())) {
      proxyToNitro(req, res, { privateAsset: true });
      return;
    }

    const abs = resolveStatic(pathname);
    if (abs) {
      console.log(`[s1r1us] front-door static overlay ${logSafe(req.method)} ${logSafe(pathname)}`);
      try {
        await serveStatic(res, abs, req);
      } catch (err) {
        console.error("[s1r1us] static serve error:", logSafe(err.message));
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        }
        res.end("Internal Server Error");
      }
      return;
    }

    // Prefix claimed but file missing under front-door-static → 404 (do not fall through to Nitro for css/js/images ship paths that 404 today)
    const staticOnlyPrefixes = ["/css/", "/js/", "/images/", "/hello-world/", "/discord/", "/roadmap/", "/r0b0ts/", "/h1v3/", "/pr3d/", "/faq/", "/compute/", "/gm/", "/f33d/", "/forum/", "/agent/", "/board/", "/labs/", "/owl/", "/app/", "/ios/", "/play/", "/c0ff33/", "/sponsor-ai-bitcoin-trading-bot/", "/media/", "/b3ars/", "/l0ck/", "/bowl/", "/w0rld/", "/c0ut/", "/Bitcoin-Miners/", "/wh1t3/", "/s1r1us/", "/sitemap/", "/search/", "/terms/", "/privacy/", "/copyright-terms/", "/WEB-3-and-ai-future/", "/sense1-engineering/", "/sai-citizens-united/", "/manifesto/", "/oss-marketing/", "/newsletter/", "/escape-the-matrix/", "/global-uprisings/", "/future/", "/cosmic-c0d3/", "/blast-off/", "/book-dj-mo-funky/", "/dmt/", "/dripped-out-matrix/", "/hindu-teachings/", "/what-inspired-us/"];
    const staticOnlyExact = ["/hello-world", "/discord", "/roadmap", "/r0b0ts", "/h1v3", "/pr3d", "/faq", "/compute", "/gm", "/f33d", "/forum", "/agent", "/board", "/labs", "/owl", "/app", "/ios", "/play", "/c0ff33", "/sponsor-ai-bitcoin-trading-bot", "/media", "/b3ars", "/l0ck", "/bowl", "/w0rld", "/c0ut", "/Bitcoin-Miners", "/wh1t3", "/s1r1us", "/sitemap", "/search", "/terms", "/privacy", "/copyright-terms", "/WEB-3-and-ai-future", "/sense1-engineering", "/sai-citizens-united", "/manifesto", "/oss-marketing", "/newsletter", "/escape-the-matrix", "/global-uprisings", "/future", "/cosmic-c0d3", "/blast-off", "/book-dj-mo-funky", "/dmt", "/dripped-out-matrix", "/hindu-teachings", "/what-inspired-us", "/css", "/js", "/images"];
    const claimed =
      staticOnlyExact.includes(pathname) ||
      staticOnlyPrefixes.some((p) => pathname.startsWith(p)) ||
      pathname === "/" ||
      pathname === "/index.html";
    if (claimed && pathname !== "/" && pathname !== "/index.html") {
      // /css /js /images without file: 404 as task says these 404 on live today when missing
      // For hello-world/discord if resolve missed, also 404
      if (
        pathname.startsWith("/css") ||
        pathname.startsWith("/js") ||
        pathname.startsWith("/images") ||
        pathname.startsWith("/hello-world") ||
        pathname.startsWith("/discord") ||
        pathname.startsWith("/roadmap") ||
        pathname.startsWith("/r0b0ts") ||
        pathname.startsWith("/h1v3") ||
        pathname.startsWith("/pr3d") ||
        pathname.startsWith("/faq") ||
        pathname.startsWith("/forum") ||
        pathname.startsWith("/agent") ||
        pathname.startsWith("/board") ||
        pathname.startsWith("/labs") ||
        pathname.startsWith("/owl") ||
        pathname.startsWith("/app") ||
        pathname.startsWith("/ios") ||
        pathname.startsWith("/play") ||
        pathname.startsWith("/c0ff33") ||
        pathname.startsWith("/sponsor-ai-bitcoin-trading-bot") ||
        pathname.startsWith("/media") ||
        pathname.startsWith("/b3ars") ||
        pathname.startsWith("/l0ck") ||
        pathname.startsWith("/bowl") ||
        pathname.startsWith("/w0rld") ||
        pathname.startsWith("/c0ut") ||
        pathname.startsWith("/Bitcoin-Miners") ||
        pathname.startsWith("/wh1t3") ||
        pathname.startsWith("/s1r1us") ||
        (pathname === "/sitemap" || pathname.startsWith("/sitemap/")) ||
        (pathname === "/search" || pathname.startsWith("/search/")) ||
        pathname.startsWith("/terms") ||
        pathname.startsWith("/privacy") ||
        pathname.startsWith("/copyright-terms") ||
        pathname.startsWith("/WEB-3-and-ai-future") ||
        pathname === "/sense1-engineering" || pathname.startsWith("/sense1-engineering/") ||
        pathname === "/sai-citizens-united" || pathname.startsWith("/sai-citizens-united/") ||
        pathname === "/manifesto" || pathname.startsWith("/manifesto/") ||
        pathname === "/oss-marketing" || pathname.startsWith("/oss-marketing/") ||
        pathname === "/newsletter" || pathname.startsWith("/newsletter/") ||
        pathname === "/escape-the-matrix" || pathname.startsWith("/escape-the-matrix/") ||
        pathname === "/global-uprisings" || pathname.startsWith("/global-uprisings/") ||
        pathname === "/future" || pathname.startsWith("/future/") ||
        pathname === "/cosmic-c0d3" || pathname.startsWith("/cosmic-c0d3/") ||
        pathname === "/blast-off" || pathname.startsWith("/blast-off/") ||
        pathname === "/book-dj-mo-funky" || pathname.startsWith("/book-dj-mo-funky/") ||
        pathname === "/dmt" || pathname.startsWith("/dmt/") ||
        pathname === "/dripped-out-matrix" || pathname.startsWith("/dripped-out-matrix/") ||
        pathname === "/hindu-teachings" || pathname.startsWith("/hindu-teachings/") ||
        pathname === "/what-inspired-us" || pathname.startsWith("/what-inspired-us/") ||
        pathname.startsWith("/compute") ||
        pathname.startsWith("/gm") ||
        pathname.startsWith("/f33d")
      ) {
        console.log(`[s1r1us] front-door static overlay 404 ${logSafe(pathname)}`);
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }
    }

    console.log(`[s1r1us] nitro proxy ${logSafe(req.method)} ${logSafe(pathname)}`);
    proxyToNitro(req, res);
  };

  const server = http.createServer(async (req, res) => {
    try {
      applyFrontDoorSecurityHeaders(req, res);
      await handleRequest(req, res);
    } catch (err) {
      console.error("[s1r1us] front-door handler error:", logSafe(err && err.message));
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal Server Error");
      } else {
        res.destroy();
      }
    }
  });

  server.listen(Number(port), host, () => {
    console.log(
      `[s1r1us] front-door listening on ${host}:${port}; nitro internal :${upstreamPort}; static=${STATIC_ROOT}`,
    );
  });

  return server;
}

/**
 * Required deploy secret for the admin YubiKey tap limiter (see src/lib/desk/yubi-limit.ts).
 * At boot we only check that it is present and at least 32 UTF-8 bytes after trim, and warn by
 * NAME when it is not. The value is never read into a log line. Taps fail closed; the server still starts.
 */
export const YUBI_TAP_SETTING_NAME = "S1R1US_YUBI_TAP_KEY";
export function yubiTapSecretWarning(env = process.env) {
  const v = typeof env[YUBI_TAP_SETTING_NAME] === "string" ? env[YUBI_TAP_SETTING_NAME].trim() : "";
  if (Buffer.byteLength(v, "utf8") >= 32) return null;
  return `[s1r1us] ${YUBI_TAP_SETTING_NAME} is missing or shorter than 32 bytes; admin YubiKey taps are refused until it is set (run-time deploy secret). Taps fail closed; the server still starts.`;
}

// Spawn Nitro on internal 8081 (do not bind external PORT)
const nitroEnv = {
  ...process.env,
  PORT: NITRO_INTERNAL_PORT,
  NITRO_PORT: NITRO_INTERNAL_PORT,
  HOST: "127.0.0.1",
  NITRO_HOST: "127.0.0.1",
  NODE_ENV: process.env.NODE_ENV || "production",
};

if (IS_MAIN) {
const yubiTapWarning = yubiTapSecretWarning();
if (yubiTapWarning) console.warn(yubiTapWarning);
const child = spawn(process.execPath, [entry], {
  cwd: ROOT,
  env: nitroEnv,
  stdio: "inherit",
});

child.on("spawn", () => {
  console.log(`[s1r1us] nitro spawned on 127.0.0.1:${NITRO_INTERNAL_PORT} (${entry})`);
  startFrontDoor();
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

child.on("error", (err) => {
  console.error("[s1r1us] failed to spawn nitro:", err.message);
  process.exit(1);
});
}
