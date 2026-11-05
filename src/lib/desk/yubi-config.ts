/**
 * YubiCloud client settings and reply checks. Fail closed:
 * - no shared demo client fallback: without our own numeric client ID, taps are refused;
 * - YUBICO_API_SECRET is required: without a valid key, taps are refused;
 * - every request is signed and every reply signature is checked (missing or wrong = rejected).
 * Official: developers.yubico.com/OTP/Specifications/OTP_validation_protocol.html
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const YUBI_UNCONFIGURED = "YubiKey sign-in is not set up on this server.";

/** The only YubiCloud verify URL. api2..api5 were retired by Yubico on 2020-07-01. */
export const YUBICLOUD_VERIFY_URL = "https://api.yubico.com/wsapi/2.0/verify";

const MODHEX_PUBLIC_ID = /^[cbdefghijklnrtuv]{12}$/;

/** A Yubico OTP: 44 modhex characters (12-char public ID + 32-char token). */
export const YUBI_OTP_RE = /^[cbdefghijklnrtuv]{44}$/;

/**
 * One refusal text for every YubiKey tap refusal (format, unknown key, replay, YubiCloud
 * failure, bad signature or status), so the reply never tells which check failed.
 */
export const YUBI_REFUSED = "YubiKey tap not accepted.";

/** Shown only when no key is enrolled at all (does not depend on the tap). */
export const YUBI_NONE_ENROLLED = "Enroll two admin YubiKeys in Admin before approving outgoing BTC or USDC.";

/**
 * Every refusal takes at least this long. It covers a normal YubiCloud round trip (one HTTPS
 * call to api.yubico.com), so a refusal made before the network call (unknown key, replay)
 * takes the same time as one made after it (bad OTP).
 */
export const YUBI_REFUSAL_FLOOR_MS = 1500;

/**
 * Longest wait for one YubiCloud reply. A slower call is aborted and counts as a refusal, so a
 * slow or hung YubiCloud can never push a refusal past the floor (or hold a request open).
 */
export const YUBICLOUD_TIMEOUT_MS = 1200;

/** Time kept back from the floor for the abort to settle; the cloud budget never eats into it. */
export const YUBI_CLOUD_HEADROOM_MS = 200;

/** Shown when one admin has too many failed taps (still padded like every refusal). */
export const YUBI_TOO_MANY = "Too many attempts. Wait a while and try again.";

/** True only when the OTP's public ID (first 12 modhex chars) is one of the enrolled IDs. */
export function yubiPublicIdEnrolled(otp: string, enrolled: readonly string[]): boolean {
  const pid = otp.slice(0, 12);
  if (!MODHEX_PUBLIC_ID.test(pid)) return false;
  return enrolled.some((id) => MODHEX_PUBLIC_ID.test(id) && id === pid);
}

type Env = Record<string, string | undefined>;

export function yubicoClientId(env: Env = process.env): string | null {
  const id = env.YUBICO_CLIENT_ID?.trim() ?? "";
  return /^[1-9]\d{0,9}$/.test(id) ? id : null;
}

/** Strict base64 API key that decodes to 16-64 bytes. Anything else counts as unset. */
export function yubicoApiSecret(env: Env = process.env): string | null {
  const s = env.YUBICO_API_SECRET?.trim() ?? "";
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s) || !s) return null;
  const n = Buffer.from(s, "base64").length;
  return n >= 16 && n <= 64 ? s : null;
}

/** Both settings, or null (refuse before any network call). */
export function yubicoConfig(env: Env = process.env): { id: string; secret: string } | null {
  const id = yubicoClientId(env);
  const secret = yubicoApiSecret(env);
  return id && secret ? { id, secret } : null;
}

/** Yubico OTP Validation Protocol 2.0 HMAC-SHA1 over the sorted key=value pairs, h excluded. */
export function yubiCloudHmac(params: Record<string, string>, secretB64: string) {
  const line = Object.keys(params)
    .filter((k) => k !== "h")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHmac("sha1", Buffer.from(secretB64, "base64")).update(line).digest("base64");
}

/** Reply lines to a prototype-free map. A repeated key makes the whole reply invalid (null). */
export function parseYubiKv(body: string): Record<string, string> | null {
  const out: Record<string, string> = Object.create(null);
  for (const line of body.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1) continue;
    const k = line.slice(0, i);
    if (Object.hasOwn(out, k)) return null;
    out[k] = line.slice(i + 1);
  }
  return out;
}

/** True only when the reply carries a signature that matches. Missing signature = false. */
export function yubiHmacOk(kv: Record<string, string>, secretB64: string) {
  const got = kv.h;
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(yubiCloudHmac(kv, secretB64));
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Checked reply status, or null when the reply must be ignored:
 * bad or missing signature, repeated key, wrong nonce, a different OTP echoed back, or no status.
 */
export function yubiReplyStatus(body: string, nonce: string, otp: string, secretB64: string): string | null {
  const kv = parseYubiKv(body);
  if (!kv || !yubiHmacOk(kv, secretB64)) return null;
  if (kv.nonce !== nonce) return null;
  if (kv.otp !== otp) return null;
  return kv.status || null;
}

export type YubiTapRow = { public_id: string; last_otp: string | null };

/** Per-admin failed-tap ceiling (see yubi-limit.ts; keyed per admin, not per session). */
export type YubiTapLimit = {
  /** Counts this tap; false = the admin is over the ceiling. */
  attempt: () => Promise<boolean>;
  /** A good tap resets the admin's count. */
  clear: () => Promise<void>;
};

export type YubiTapDeps = {
  rows: () => Promise<readonly YubiTapRow[]>;
  /** YubiCloud check within timeoutMs: null = signed OK, anything else (or a throw) = refused. */
  verify: (otp: string, timeoutMs: number) => Promise<string | null>;
  /** Marks the OTP used (local replay record). */
  touch: (publicId: string, otp: string) => Promise<void>;
  /**
   * The per-admin limiter. null = no signed-in user id or no valid limiter key setting:
   * every tap is refused (padded). Production always passes it (see consumeYubiOtp).
   */
  limit?: YubiTapLimit | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  floorMs?: number;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Checks one admin YubiKey tap. Order: per-admin tap limit, format, enrolled public ID, local
 * replay check, YubiCloud (time-boxed), and only after a signed YubiCloud OK, mark the OTP used.
 * Every refusal returns YUBI_REFUSED (or YUBI_TOO_MANY / YUBI_NONE_ENROLLED, which do not
 * depend on the key) and is padded to the same minimum time.
 */
export async function consumeYubiTap(otp: unknown, deps: YubiTapDeps): Promise<string | null> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? realSleep;
  const floor = deps.floorMs ?? YUBI_REFUSAL_FLOOR_MS;
  const start = now();
  const refuse = async (text: string = YUBI_REFUSED) => {
    const wait = floor - (now() - start);
    if (wait > 0) await sleep(wait);
    return text;
  };
  // No signed-in user id or no limiter key: never a shared bucket, always the padded refusal.
  if (deps.limit === null) return refuse();
  if (deps.limit) {
    let allowed: boolean;
    try {
      allowed = await deps.limit.attempt();
    } catch {
      return refuse();
    }
    if (!allowed) return refuse(YUBI_TOO_MANY);
  }
  // A missing or non-string OTP (a crafted request) gets the same padded refusal.
  if (typeof otp !== "string") return refuse();
  const tap = otp.trim().toLowerCase();
  if (!YUBI_OTP_RE.test(tap)) return refuse();
  let rows: readonly YubiTapRow[];
  try {
    rows = await deps.rows();
  } catch {
    return refuse();
  }
  if (!rows.length) return refuse(YUBI_NONE_ENROLLED);
  // Fail closed: only enrolled keys reach YubiCloud.
  if (!yubiPublicIdEnrolled(tap, rows.map((r) => r.public_id))) return refuse();
  const pid = tap.slice(0, 12);
  const row = rows.find((r) => r.public_id === pid);
  if (!row) return refuse();
  // Local replay check, before any network call.
  if (row.last_otp && row.last_otp === tap) return refuse();
  // YubiCloud gets what is left of the floor (minus headroom), never more than its timeout.
  const budget = Math.min(YUBICLOUD_TIMEOUT_MS, floor - YUBI_CLOUD_HEADROOM_MS - (now() - start));
  if (budget <= 0) return refuse();
  let cloud: string | null;
  try {
    cloud = await deps.verify(tap, budget);
  } catch {
    return refuse();
  }
  if (cloud !== null) return refuse();
  // Mark used only after a signed YubiCloud OK, so a bad tap can never block a real one.
  try {
    await deps.touch(pid, tap);
  } catch {
    return refuse();
  }
  if (deps.limit) {
    try {
      await deps.limit.clear();
    } catch {
      /* the count stays: stricter, never looser */
    }
  }
  return null;
}
