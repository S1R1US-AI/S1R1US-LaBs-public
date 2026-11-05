import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { guardedFetch } from "./net-guard";
import {
  YUBI_OTP_RE,
  YUBI_UNCONFIGURED,
  YUBICLOUD_TIMEOUT_MS,
  YUBICLOUD_VERIFY_URL,
  consumeYubiTap,
  yubiCloudHmac,
  yubicoConfig,
  yubiReplyStatus,
} from "./yubi-config";
import { yubiAdminKey, yubiTapLimiter } from "./yubi-limit";

export { YUBI_OTP_RE, yubiCloudHmac };
export const YUBI_SLOTS = 2;

export type YubiKeyRow = { id: string; public_id: string; last_otp: string | null };

export function yubiPublicId(otp: string) {
  return otp.slice(0, 12);
}

export function maskYubiId(publicId: string) {
  if (publicId.length < 6) return publicId;
  return `${publicId.slice(0, 4)}…${publicId.slice(-2)}`;
}

export async function yubiRows(): Promise<YubiKeyRow[]> {
  try {
    const sql = await getSql();
    return await sql<YubiKeyRow>`
      select id, public_id, last_otp from admin_yubi order by id asc
    `;
  } catch {
    return [];
  }
}

export async function yubiRow(): Promise<YubiKeyRow | null> {
  const rows = await yubiRows();
  return rows[0] ?? null;
}

export async function saveYubi(publicId: string, otp: string): Promise<{ slot: string; created: boolean } | { error: string }> {
  const sql = await getSql();
  const rows = await yubiRows();
  const same = rows.find((r) => r.public_id === publicId);
  if (same) {
    await sql`update admin_yubi set last_otp = ${otp}, enrolled_at = now() where public_id = ${publicId}`;
    return { slot: same.id, created: false };
  }
  if (rows.length >= YUBI_SLOTS) {
    return { error: `Both YubiKey slots are full (${YUBI_SLOTS}). Remove one before adding another.` };
  }
  const used = new Set(rows.map((r) => r.id));
  const slot = used.has("1") ? "2" : "1";
  await sql`
    insert into admin_yubi (id, public_id, last_otp, enrolled_at)
    values (${slot}, ${publicId}, ${otp}, now())
    on conflict (id) do update set
      public_id = excluded.public_id,
      last_otp = excluded.last_otp,
      enrolled_at = now()
  `;
  return { slot, created: true };
}

export async function touchYubi(publicId: string, otp: string) {
  const sql = await getSql();
  await sql`update admin_yubi set last_otp = ${otp} where public_id = ${publicId}`;
}

export async function consumeYubiOtp(otp: unknown, userId: string | null | undefined): Promise<string | null> {
  // One generic refusal, a fixed minimum time and a per-admin tap ceiling keyed by the signed-in
  // user id (see yubi-limit.ts). No user id or no limiter key = padded refusal (fail closed).
  return consumeYubiTap(otp, { rows: yubiRows, verify: verifyYubicoOtp, touch: touchYubi, limit: yubiTapLimiter(getSql, yubiAdminKey(userId)) });
}

export async function clearYubi(publicId?: string) {
  const sql = await getSql();
  if (publicId) {
    await sql`delete from admin_yubi where public_id = ${publicId}`;
    return;
  }
  await sql`delete from admin_yubi`;
}

export async function verifyYubicoOtp(otp: string, timeoutMs: number = YUBICLOUD_TIMEOUT_MS): Promise<string | null> {
  if (!YUBI_OTP_RE.test(otp)) return "Tap the YubiKey in this field (44-character Yubico OTP).";
  // Fail closed: client ID and API secret are both required (see yubi-config.ts).
  const cfg = yubicoConfig();
  if (!cfg) return YUBI_UNCONFIGURED;
  const { id, secret } = cfg;
  const nonce = randomBytes(16).toString("hex");
  const params: Record<string, string> = { id, nonce, otp, timeout: "8" };
  params.h = yubiCloudHmac(params, secret);
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  // Time-boxed (fetch and body): a slow or hung YubiCloud is aborted and counts as a refusal.
  const signal = AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, YUBICLOUD_TIMEOUT_MS)));
  try {
    const res = await guardedFetch(`${YUBICLOUD_VERIFY_URL}?${query}`, { signal });
    if (!res.ok) return "YubiCloud could not verify that tap. Try again.";
    const body = await res.text();
    // Signature always checked; unsigned or mismatched replies are ignored.
    const status = yubiReplyStatus(body, nonce, otp, secret);
    if (status === "OK") return null;
    if (status === "REPLAYED_OTP") return "That YubiKey OTP was already used. Tap again.";
    if (status === "BAD_OTP") return "YubiCloud rejected that OTP.";
    return "YubiCloud could not verify that tap. Try again.";
  } catch {
    return "YubiCloud is unreachable. Try the tap again.";
  }
}
