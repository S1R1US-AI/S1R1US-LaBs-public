/**
 * Per-admin failed-tap ceiling for admin YubiKey taps, stored in the database (table
 * admin_yubi_taps, migration 0014), so it holds across processes and restarts.
 *
 * Keying (the real one): PER ADMIN, not per session. The key is HMAC-SHA256 of the signed-in
 * user id (from the verified session, never a request field) under the private deploy setting
 * S1R1US_YUBI_TAP_KEY, so all of one admin's sessions share one count. Access tokens carry no
 * session id, so a per-session lockout would need an auth change (not done here).
 * - Each tap is counted up front in one atomic statement (parallel taps can't slip past).
 * - A good tap clears the admin's count; the window is fixed from the first counted tap.
 * - Rows older than the window are purged on each write (best effort).
 * - When the ceiling trips, one structured security event is logged (no secret, no user id).
 * - No signed-in user id, or a missing/short S1R1US_YUBI_TAP_KEY: no limiter (null), and
 *   consumeYubiTap refuses every tap with the padded generic refusal (fail closed).
 * - Limits are deploy settings read through limitFromEnv (strict defaults when unset).
 */
import { createHmac } from "node:crypto";
import { limitFromEnv } from "./limit-env.ts";
import { securityEvent, type SecurityEvent } from "./security-log.ts";
import type { YubiTapLimit } from "./yubi-config.ts";

type SqlLike = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> };
type Env = Record<string, string | undefined>;

export type YubiTapLimits = { max: number; windowMs: number };

/** Name of the private deploy setting that keys the stored limiter key (value never logged). */
export const YUBI_TAP_SETTING_NAME = "S1R1US_YUBI_TAP_KEY";

/** The setting must be at least this many bytes; shorter counts as unset (fail closed). */
export const YUBI_TAP_KEY_MIN_BYTES = 32;

/** Strict defaults: 5 failed taps per 15 minutes per admin. */
export function yubiTapLimits(): YubiTapLimits {
  return {
    max: limitFromEnv("S1R1US_YUBI_TAP_MAX", 5, 1, 50),
    windowMs: limitFromEnv("S1R1US_YUBI_TAP_WINDOW_MS", 15 * 60_000, 60_000, 24 * 60 * 60_000),
  };
}

/** The limiter key secret from the host's private settings, or null when unset or too short. */
export function yubiTapKey(env: Env = process.env): string | null {
  const s = env[YUBI_TAP_SETTING_NAME]?.trim() ?? "";
  return Buffer.byteLength(s, "utf8") >= YUBI_TAP_KEY_MIN_BYTES ? s : null;
}

/**
 * Stored key for one admin: HMAC-SHA256(S1R1US_YUBI_TAP_KEY, signed-in user id), hex.
 * Null when there is no signed-in user id or no valid key setting (never a shared bucket).
 */
export function yubiAdminKey(userId: string | null | undefined, env: Env = process.env): string | null {
  const id = typeof userId === "string" ? userId.trim() : "";
  const secret = yubiTapKey(env);
  if (!id || !secret) return null;
  return createHmac("sha256", secret).update(id).digest("hex");
}

/** Null adminKey = no limiter, and consumeYubiTap refuses (padded). */
export function yubiTapLimiter(
  getSql: () => Promise<SqlLike>,
  adminKey: string | null,
  limits: YubiTapLimits = yubiTapLimits(),
  now: () => number = Date.now,
  alert: (e: SecurityEvent) => void = securityEvent,
): YubiTapLimit | null {
  if (typeof adminKey !== "string" || !/^[0-9a-f]{64}$/.test(adminKey)) return null;
  return {
    async attempt() {
      const sql = await getSql();
      const t = now();
      const cutoff = t - limits.windowMs;
      const rows = await sql.query<{ fails: number }>(
        `insert into admin_yubi_taps (admin_key, fails, window_start) values ($1, 1, $2)
         on conflict (admin_key) do update set
           fails = case when admin_yubi_taps.window_start <= $3 then 1 else admin_yubi_taps.fails + 1 end,
           window_start = case when admin_yubi_taps.window_start <= $3 then excluded.window_start else admin_yubi_taps.window_start end
         returning fails`,
        [adminKey, t, cutoff],
      );
      const fails = Number(rows[0]?.fails);
      // Housekeeping: drop rows whose window has ended. Never affects this tap's count.
      try {
        await sql.query("delete from admin_yubi_taps where window_start <= $1 and admin_key <> $2", [cutoff, adminKey]);
      } catch {
        /* best effort */
      }
      // Alert once per window, on the first tap over the per-admin ceiling.
      if (fails === limits.max + 1) {
        try {
          alert({ event: "yubi_tap_ceiling", scope: "per-admin", ref: adminKey.slice(0, 12), max: limits.max, windowMs: limits.windowMs });
        } catch {
          /* logging never changes the outcome */
        }
      }
      // A counted tap is a whole number >= 1; anything else (null, "", 0, 2.5, NaN) is refused.
      return Number.isInteger(fails) && fails >= 1 && fails <= limits.max;
    },
    async clear() {
      const sql = await getSql();
      await sql.query("delete from admin_yubi_taps where admin_key = $1", [adminKey]);
    },
  };
}
