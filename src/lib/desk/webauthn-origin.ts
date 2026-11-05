/**
 * Which page origins may use the admin security key, and which site name
 * (relying party id) the key is bound to.
 *
 * The answer never depends on request headers. A forwarded or faked Host
 * header cannot add a new allowed origin or change the site name, so a key
 * can only be used on the real site (or on a local dev server).
 * Local dev hosts are allowed only when NODE_ENV is not "production".
 */

const SITE = "s1r1us.ai";
const SITE_HOSTS = new Set([SITE, `www.${SITE}`]);
const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Read on every call so the live server (NODE_ENV=production) never accepts a dev host. */
function devHostsAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

function isDevHost(host: string): boolean {
  return devHostsAllowed() && DEV_HOSTS.has(host);
}

function hostOf(origin: string): { host: string; protocol: string } | null {
  try {
    const u = new URL(origin);
    return { host: u.hostname.toLowerCase(), protocol: u.protocol };
  } catch {
    return null;
  }
}

/**
 * True when a security-key ceremony may run for this page origin.
 * The second argument is accepted for older callers and ignored on purpose.
 */
export function originAllowed(origin: string, _requestHost?: string): boolean {
  const o = hostOf(origin);
  if (!o) return false;
  if (SITE_HOSTS.has(o.host)) return o.protocol === "https:";
  if (isDevHost(o.host)) return o.protocol === "https:" || o.protocol === "http:";
  return false;
}

/** The fixed site name a key is bound to: the real site, or the dev host when running locally (not in production). */
export function rpIdOf(origin: string): string {
  const o = hostOf(origin);
  if (o && isDevHost(o.host)) return o.host;
  return SITE;
}
