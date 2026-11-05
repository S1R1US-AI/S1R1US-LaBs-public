import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  YUBI_CLOUD_HEADROOM_MS,
  YUBI_NONE_ENROLLED,
  YUBI_REFUSAL_FLOOR_MS,
  YUBI_REFUSED,
  YUBI_TOO_MANY,
  YUBI_UNCONFIGURED,
  YUBICLOUD_TIMEOUT_MS,
  YUBICLOUD_VERIFY_URL,
  consumeYubiTap,
  parseYubiKv,
  yubiCloudHmac,
  yubicoApiSecret,
  yubicoClientId,
  yubicoConfig,
  yubiHmacOk,
  yubiPublicIdEnrolled,
  yubiReplyStatus,
} from "./yubi-config.ts";
import { YUBI_TAP_KEY_MIN_BYTES, YUBI_TAP_SETTING_NAME, yubiAdminKey, yubiTapKey, yubiTapLimiter, yubiTapLimits } from "./yubi-limit.ts";

// Obvious dummy test keys (not real secrets).
const DUMMY_KEY = Buffer.from("dummy-test-key-not-a-secret!").toString("base64");
const OTHER_KEY = Buffer.from("other-dummy-key-not-a-secret").toString("base64");
const OTP = "c".repeat(44);
const NONCE = "0123456789abcdef0123456789abcdef";

function signedReply(fields: Record<string, string>, key = DUMMY_KEY) {
  const h = yubiCloudHmac(fields, key);
  return [...Object.entries(fields).map(([k, v]) => `${k}=${v}`), `h=${h}`].join("\r\n");
}

test("Yubico client ID fails closed when unset or invalid", () => {
  for (const v of [undefined, "", "   ", "0", "abc", "1.5", "-1", "12345678901"]) {
    assert.equal(yubicoClientId({ YUBICO_CLIENT_ID: v }), null, String(v));
  }
  assert.equal(yubicoClientId({}), null);
  assert.equal(yubicoClientId({ YUBICO_CLIENT_ID: " 98765 " }), "98765");
});

test("Yubico API secret is required and must be a valid key", () => {
  const short = Buffer.from("too-short").toString("base64");
  const long = Buffer.alloc(80, 1).toString("base64");
  for (const v of [undefined, "", "   ", "not base64 !!", "abc", `${DUMMY_KEY}x`, short, long]) {
    assert.equal(yubicoApiSecret({ YUBICO_API_SECRET: v }), null, String(v));
  }
  assert.equal(yubicoApiSecret({ YUBICO_API_SECRET: ` ${DUMMY_KEY} ` }), DUMMY_KEY);
});

test("Yubico config refuses unless both client ID and secret are set", () => {
  assert.equal(yubicoConfig({}), null);
  assert.equal(yubicoConfig({ YUBICO_CLIENT_ID: "98765" }), null);
  assert.equal(yubicoConfig({ YUBICO_API_SECRET: DUMMY_KEY }), null);
  assert.equal(yubicoConfig({ YUBICO_CLIENT_ID: "98765", YUBICO_API_SECRET: "bad" }), null);
  assert.deepEqual(yubicoConfig({ YUBICO_CLIENT_ID: "98765", YUBICO_API_SECRET: DUMMY_KEY }), {
    id: "98765",
    secret: DUMMY_KEY,
  });
});

test("Yubico reply is accepted only with a matching signature, nonce and OTP", () => {
  const fields = { nonce: NONCE, otp: OTP, status: "OK", t: "2026-11-03T00:00:00Z0000" };
  assert.equal(yubiReplyStatus(signedReply(fields), NONCE, OTP, DUMMY_KEY), "OK");

  const unsigned = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join("\r\n");
  assert.equal(yubiReplyStatus(unsigned, NONCE, OTP, DUMMY_KEY), null, "missing signature");
  assert.equal(yubiReplyStatus(`${unsigned}\r\nh=`, NONCE, OTP, DUMMY_KEY), null, "empty signature");
  assert.equal(yubiReplyStatus(signedReply(fields, OTHER_KEY), NONCE, OTP, DUMMY_KEY), null, "wrong key");

  const tampered = signedReply({ ...fields, status: "BAD_OTP" }).replace("status=BAD_OTP", "status=OK");
  assert.equal(yubiReplyStatus(tampered, NONCE, OTP, DUMMY_KEY), null, "tampered status");

  assert.equal(yubiReplyStatus(signedReply({ ...fields, nonce: "f".repeat(32) }), NONCE, OTP, DUMMY_KEY), null);
  assert.equal(yubiReplyStatus(signedReply({ ...fields, otp: "d".repeat(44) }), NONCE, OTP, DUMMY_KEY), null);
  assert.equal(yubiHmacOk({ status: "OK" }, DUMMY_KEY), false);
});

test("Yubico OTP check refuses before any network call and always signs and checks", () => {
  const src = readFileSync(new URL("./yubi.server.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export async function verifyYubicoOtp"));
  assert.ok(!/YUBICO_CLIENT_ID\?\.trim\(\)\s*\|\|\s*"\d+"/.test(src), "no demo client ID fallback");
  assert.ok(!/process\.env\.YUBICO_/.test(body), "settings come only from yubi-config");
  const guard = body.indexOf("if (!cfg) return YUBI_UNCONFIGURED;");
  const cfg = body.indexOf("const cfg = yubicoConfig();");
  assert.ok(cfg > 0 && guard > cfg, "refuses when unconfigured");
  assert.ok(guard < body.indexOf("guardedFetch("), "refusal comes before the fetch");
  assert.ok(/\n\s*params\.h = yubiCloudHmac\(params, secret\);/.test(body), "every request is signed");
  assert.ok(!/if \(secret\)/.test(body), "signing and checking are never optional");
  const check = body.indexOf("yubiReplyStatus(body, nonce, otp, secret)");
  assert.ok(check > 0 && check < body.indexOf('=== "OK"'), "reply signature checked before status");
  assert.ok(!/parseYubiKv|kv\.status/.test(body), "status is read only through the checked reply");
  assert.match(YUBI_UNCONFIGURED, /not set up/);
});

// Known-answer tests: Yubico's published HMAC test vectors (public test values, not a secret of ours).
// Source: https://developers.yubico.com/OTP/Specifications/Test_vectors.html ("HMAC test vectors").
// Fields are listed in the published, unsorted order so a missing sort or a non-SHA-1 HMAC fails here.
const YUBICO_VECTOR_KEY = "mG5be6ZJU1qBGz24yPh/ESM3UdU="; // gitleaks:allow

test("Yubico official request vector (HMAC-SHA1 over sorted keys)", () => {
  const request = { id: "1", otp: "vvungrrdhvtklknvrtvuvbbkeidikkvgglrvdgrfcdft", nonce: "jrFwbaYFhn0HoxZIsd9LQ6w2ceU" };
  const h = yubiCloudHmac(request, YUBICO_VECTOR_KEY);
  assert.equal(encodeURIComponent(h), "%2Bja8S3IjbX593%2FLAgTBixwPNGX4%3D");
  assert.equal(h, "+ja8S3IjbX593/LAgTBixwPNGX4=");
  assert.equal(yubiCloudHmac({ ...request, h: "ignored" }, YUBICO_VECTOR_KEY), h, "h is excluded");
});

test("Yubico official response vector is accepted, and refused once altered", () => {
  const otp = "cccccckdvvulethkhtvkrtbeukiettvfceekurncllcj";
  const nonce = "0123456789abcdef";
  const lines = ["status=OK", "t=2019-06-06T05:14:15Z0369", `nonce=${nonce}`, `otp=${otp}`, "sl=25"];
  const body = [...lines, "h=iCV9uFJDtuyELQsxFPnR80Yj2XU="].join("\r\n");
  const kv = parseYubiKv(body);
  assert.ok(kv);
  assert.equal(yubiCloudHmac(kv, YUBICO_VECTOR_KEY), "iCV9uFJDtuyELQsxFPnR80Yj2XU=");
  assert.equal(yubiHmacOk(kv, YUBICO_VECTOR_KEY), true);
  assert.equal(yubiReplyStatus(body, nonce, otp, YUBICO_VECTOR_KEY), "OK");
  assert.equal(yubiReplyStatus(body.replace("sl=25", "sl=26"), nonce, otp, YUBICO_VECTOR_KEY), null, "altered field");
  assert.equal(yubiReplyStatus(body, nonce, otp, DUMMY_KEY), null, "wrong key");
});

test("Yubico reply with a valid signature but no status is refused", () => {
  const fields = { nonce: NONCE, otp: OTP, t: "2026-11-03T00:00:00Z0000" };
  const body = signedReply(fields);
  assert.equal(yubiHmacOk(parseYubiKv(body) ?? {}, DUMMY_KEY), true, "signature itself is valid");
  assert.equal(yubiReplyStatus(body, NONCE, OTP, DUMMY_KEY), null);
  assert.equal(yubiReplyStatus(signedReply({ ...fields, status: "" }), NONCE, OTP, DUMMY_KEY), null, "empty status");
});

test("Yubico reply parsing is prototype-free and refuses repeated keys", () => {
  const kv = parseYubiKv("__proto__=x\r\nstatus=OK");
  assert.ok(kv);
  assert.equal(Object.getPrototypeOf(kv), null);
  assert.equal(kv.__proto__, "x");
  assert.equal(parseYubiKv("status=BAD_OTP\r\nstatus=OK"), null);
  const fields = { nonce: NONCE, otp: OTP, status: "OK" };
  assert.equal(yubiReplyStatus(`${signedReply(fields)}\r\nstatus=OK`, NONCE, OTP, DUMMY_KEY), null);
});

test("Only enrolled YubiKey public IDs are checked, before any YubiCloud call", () => {
  const a = "cccccckdvvul";
  const b = "vvungrrdhvtk";
  assert.equal(yubiPublicIdEnrolled(`${a}${"c".repeat(32)}`, [a, b]), true);
  assert.equal(yubiPublicIdEnrolled(`${b}${"c".repeat(32)}`, [a]), false);
  assert.equal(yubiPublicIdEnrolled(`${a}${"c".repeat(32)}`, []), false);
  assert.equal(yubiPublicIdEnrolled("", [""]), false);
  assert.equal(yubiPublicIdEnrolled(`${"x".repeat(12)}${"c".repeat(32)}`, ["x".repeat(12)]), false, "not modhex");

  const src = readFileSync(new URL("./yubi-config.ts", import.meta.url), "utf8");
  const consume = src.slice(src.indexOf("export async function consumeYubiTap"));
  const enrolled = consume.indexOf("yubiPublicIdEnrolled(");
  assert.ok(enrolled > 0 && enrolled < consume.indexOf("deps.verify("), "enrolled check comes first");
});

test("YubiCloud is called only at api.yubico.com (api2-api5 retired 2020-07-01)", () => {
  assert.equal(YUBICLOUD_VERIFY_URL, "https://api.yubico.com/wsapi/2.0/verify");
  const src = readFileSync(new URL("./yubi.server.ts", import.meta.url), "utf8");
  assert.ok(!/api[2-9]\.yubico\.com/.test(src), "no retired hosts");
  assert.ok(!/wsapi\/2\.0\/verify/.test(src), "URL comes only from yubi-config");
  assert.ok(/guardedFetch\(`\$\{YUBICLOUD_VERIFY_URL\}\?/.test(src), "one fetch to the one verify URL");
  assert.equal((src.match(/guardedFetch\(/g) ?? []).length, 1);
});

// consumeYubiTap with a fake clock: verify() takes CLOUD_MS like a YubiCloud round trip.
const KEY_A = "cccccckdvvul";
const KEY_B = "vvungrrdhvtk";
const TAP_A = `${KEY_A}${"c".repeat(32)}`;
const TAP_A2 = `${KEY_A}${"d".repeat(32)}`;
const CLOUD_MS = 300;

type HarnessOpts = {
  lastOtp?: string | null;
  cloud?: string | null | Error;
  /** How long YubiCloud takes; longer than the budget = aborted (TimeoutError). */
  cloudMs?: number;
  touchFails?: boolean;
  noRows?: boolean;
  rowsFail?: boolean;
  rowsMs?: number;
};

function tapHarness(opts: HarnessOpts = {}) {
  let clock = 1_000_000;
  const calls: string[] = [];
  const sleeps: number[] = [];
  const budgets: number[] = [];
  let lookups = 0;
  const deps = {
    rows: async () => {
      lookups += 1;
      clock += opts.rowsMs ?? 0;
      if (opts.rowsFail) throw new Error("db");
      return opts.noRows ? [] : [{ public_id: KEY_A, last_otp: opts.lastOtp ?? null }, { public_id: KEY_B, last_otp: null }];
    },
    verify: async (otp: string, timeoutMs: number) => {
      calls.push(`verify:${otp}`);
      budgets.push(timeoutMs);
      const took = opts.cloudMs ?? CLOUD_MS;
      if (took > timeoutMs) {
        clock += timeoutMs;
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }
      clock += took;
      if (opts.cloud instanceof Error) throw opts.cloud;
      return opts.cloud === undefined ? null : opts.cloud;
    },
    touch: async (pid: string, otp: string) => {
      calls.push(`touch:${pid}:${otp}`);
      if (opts.touchFails) throw new Error("db");
    },
    now: () => clock,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
  };
  return { deps, calls, sleeps, budgets, lookups: () => lookups, elapsed: () => clock - 1_000_000 };
}

test("Every YubiKey refusal gives one generic text and takes the same minimum time", async () => {
  assert.ok(YUBI_REFUSAL_FLOOR_MS >= 1000 && YUBI_REFUSAL_FLOOR_MS > CLOUD_MS);
  const cases: [string, string, HarnessOpts][] = [
    ["bad format", "not-an-otp", {}],
    ["43 characters", TAP_A.slice(0, 43), {}],
    ["45 characters", `${TAP_A}c`, {}],
    ["key lookup error", TAP_A, { rowsFail: true }],
    ["YubiCloud too slow", TAP_A, { cloudMs: 60_000 }],
    ["unenrolled public ID", `${"b".repeat(12)}${"c".repeat(32)}`, {}],
    ["local replay", TAP_A, { lastOtp: TAP_A }],
    ["YubiCloud BAD_OTP", TAP_A, { cloud: "YubiCloud rejected that OTP." }],
    ["YubiCloud REPLAYED_OTP", TAP_A, { cloud: "That YubiKey OTP was already used. Tap again." }],
    ["bad signature or status", TAP_A, { cloud: "YubiCloud could not verify that tap. Try again." }],
    ["YubiCloud unreachable", TAP_A, { cloud: new Error("net") }],
    ["could not record", TAP_A, { touchFails: true }],
  ];
  for (const [name, otp, opts] of cases) {
    const h = tapHarness(opts);
    assert.equal(await consumeYubiTap(otp, h.deps), YUBI_REFUSED, name);
    assert.equal(h.elapsed(), YUBI_REFUSAL_FLOOR_MS, `${name}: padded to the floor`);
  }
  const none = tapHarness({ noRows: true });
  assert.equal(await consumeYubiTap(TAP_A, none.deps), YUBI_NONE_ENROLLED);
  assert.equal(none.elapsed(), YUBI_REFUSAL_FLOOR_MS);
});

test("Unenrolled and enrolled-with-bad-OTP taps look the same (text and time)", async () => {
  const unknown = tapHarness();
  const badOtp = tapHarness({ cloud: "YubiCloud rejected that OTP." });
  const a = await consumeYubiTap(`${"b".repeat(12)}${"c".repeat(32)}`, unknown.deps);
  const b = await consumeYubiTap(TAP_A, badOtp.deps);
  assert.equal(a, b);
  assert.equal(unknown.elapsed(), badOtp.elapsed());
  assert.deepEqual(unknown.calls, [], "unknown key never reaches YubiCloud");
});

test("A good tap is accepted without padding", async () => {
  const h = tapHarness();
  assert.equal(await consumeYubiTap(` ${TAP_A.toUpperCase()} `, h.deps), null);
  assert.deepEqual(h.sleeps, []);
  assert.equal(h.elapsed(), CLOUD_MS);
});

test("Local replay check runs before YubiCloud", async () => {
  const h = tapHarness({ lastOtp: TAP_A });
  assert.equal(await consumeYubiTap(TAP_A, h.deps), YUBI_REFUSED);
  assert.deepEqual(h.calls, [], "a replayed OTP never reaches YubiCloud or the replay record");
  const fresh = tapHarness({ lastOtp: TAP_A });
  assert.equal(await consumeYubiTap(TAP_A2, fresh.deps), null, "a new OTP from the same key still works");
});

test("The OTP is marked used only after a signed YubiCloud OK", async () => {
  const ok = tapHarness();
  assert.equal(await consumeYubiTap(TAP_A, ok.deps), null);
  assert.deepEqual(ok.calls, [`verify:${TAP_A}`, `touch:${KEY_A}:${TAP_A}`]);
  for (const cloud of ["YubiCloud rejected that OTP.", "YubiCloud could not verify that tap. Try again.", new Error("net")]) {
    const h = tapHarness({ cloud });
    assert.equal(await consumeYubiTap(TAP_A, h.deps), YUBI_REFUSED);
    assert.deepEqual(h.calls, [`verify:${TAP_A}`], "a refused tap never touches the replay record");
  }
});

test("consumeYubiOtp is exactly one delegation to consumeYubiTap (no checks of its own)", () => {
  const src = readFileSync(new URL("./yubi.server.ts", import.meta.url), "utf8");
  const start = src.indexOf("export async function consumeYubiOtp");
  const fn = src.slice(start, src.indexOf("export async function clearYubi"));
  const body = fn
    .slice(fn.indexOf("{") + 1, fn.lastIndexOf("}"))
    .replace(/\/\/[^\n]*/g, "")
    .trim();
  assert.equal(
    body,
    "return consumeYubiTap(otp, { rows: yubiRows, verify: verifyYubicoOtp, touch: touchYubi, limit: yubiTapLimiter(getSql, yubiAdminKey(userId)) });",
  );
  assert.equal((src.match(/consumeYubiTap\(/g) ?? []).length, 1, "one call site");
});

test("Non-string or missing OTP gets the padded generic refusal", async () => {
  for (const otp of [undefined, null, 123, {}, ["x"], true]) {
    const h = tapHarness();
    assert.equal(await consumeYubiTap(otp, h.deps), YUBI_REFUSED, String(otp));
    assert.equal(h.elapsed(), YUBI_REFUSAL_FLOOR_MS, `${String(otp)}: padded`);
    assert.deepEqual(h.calls, [], "never reaches YubiCloud");
    assert.equal(h.lookups(), 0, "never reaches the key lookup");
  }
});

test("A key lookup error is padded and gives the generic refusal", async () => {
  const h = tapHarness({ rowsFail: true });
  assert.equal(await consumeYubiTap(TAP_A, h.deps), YUBI_REFUSED);
  assert.equal(h.elapsed(), YUBI_REFUSAL_FLOOR_MS);
  assert.equal(h.lookups(), 1);
  assert.deepEqual(h.calls, [], "never reaches YubiCloud");
});

test("43- and 45-character OTPs are refused before any lookup (valid length is 44)", async () => {
  for (const otp of [TAP_A.slice(0, 43), `${TAP_A}c`, `${TAP_A}${"c".repeat(20)}`]) {
    const h = tapHarness();
    assert.equal(await consumeYubiTap(otp, h.deps), YUBI_REFUSED, `${otp.length} chars`);
    assert.deepEqual(h.calls, [], `${otp.length} chars: no YubiCloud`);
    assert.equal(h.lookups(), 0, `${otp.length} chars: no lookup`);
  }
  const ok = tapHarness();
  assert.equal(await consumeYubiTap(TAP_A, ok.deps), null, "44 chars accepted");
});

test("YubiCloud is time-boxed so even a slow or hung reply ends at the floor", async () => {
  assert.equal(YUBICLOUD_TIMEOUT_MS, 1200);
  assert.ok(YUBICLOUD_TIMEOUT_MS + YUBI_CLOUD_HEADROOM_MS <= YUBI_REFUSAL_FLOOR_MS);
  const unknown = tapHarness();
  await consumeYubiTap(`${"b".repeat(12)}${"c".repeat(32)}`, unknown.deps);
  for (const rowsMs of [0, 250, 1400, 3000]) {
    const slow = tapHarness({ cloudMs: 60_000, rowsMs });
    assert.equal(await consumeYubiTap(TAP_A, slow.deps), YUBI_REFUSED, `rows ${rowsMs}ms`);
    assert.equal(slow.elapsed(), Math.max(YUBI_REFUSAL_FLOOR_MS, rowsMs), `rows ${rowsMs}ms: ends at the floor`);
    const slowUnknown = tapHarness({ rowsMs });
    await consumeYubiTap(`${"b".repeat(12)}${"c".repeat(32)}`, slowUnknown.deps);
    assert.equal(slow.elapsed(), slowUnknown.elapsed(), `rows ${rowsMs}ms: same time as an unknown key`);
    for (const b of slow.budgets) assert.ok(b > 0 && b <= YUBICLOUD_TIMEOUT_MS);
  }
  const h = tapHarness();
  await consumeYubiTap(TAP_A, h.deps);
  assert.deepEqual(h.budgets, [YUBICLOUD_TIMEOUT_MS], "normal case: the full 1200 ms");
  assert.equal(unknown.elapsed(), YUBI_REFUSAL_FLOOR_MS);

  const src = readFileSync(new URL("./yubi.server.ts", import.meta.url), "utf8");
  const verify = src.slice(src.indexOf("export async function verifyYubicoOtp"));
  assert.match(verify, /AbortSignal\.timeout\(Math\.max\(1, Math\.min\(timeoutMs, YUBICLOUD_TIMEOUT_MS\)\)\)/);
  assert.match(verify, /guardedFetch\(`\$\{YUBICLOUD_VERIFY_URL\}\?\$\{query\}`, \{ signal \}\)/);
});

// Per-admin tap ceiling against the real SQL and migration (in-memory PGLite).
async function limitDb() {
  const db = new PGlite();
  await db.exec(readFileSync(new URL("../../../migrations/0014_admin_yubi_taps.sql", import.meta.url), "utf8"));
  const sql = { query: async <T,>(text: string, params: unknown[] = []) => (await db.query<T>(text, params)).rows };
  return { db, getSql: async () => sql };
}

const LIMITS = { max: 5, windowMs: 15 * 60_000 };
// Obvious dummy limiter key setting (not a real secret), at least 32 bytes.
const TAP_SECRET = "dummy-tap-key-not-a-secret-0123456789";
const TAP_ENV = { [YUBI_TAP_SETTING_NAME]: TAP_SECRET };

test("Tap limit defaults are 5 failed taps per 15 minutes per admin", () => {
  const saved = { m: process.env.S1R1US_YUBI_TAP_MAX, w: process.env.S1R1US_YUBI_TAP_WINDOW_MS };
  delete process.env.S1R1US_YUBI_TAP_MAX;
  delete process.env.S1R1US_YUBI_TAP_WINDOW_MS;
  try {
    assert.deepEqual(yubiTapLimits(), LIMITS);
  } finally {
    if (saved.m !== undefined) process.env.S1R1US_YUBI_TAP_MAX = saved.m;
    if (saved.w !== undefined) process.env.S1R1US_YUBI_TAP_WINDOW_MS = saved.w;
  }
  assert.notEqual(yubiAdminKey("a", TAP_ENV), yubiAdminKey("b", TAP_ENV));
  assert.equal(yubiAdminKey(null, TAP_ENV), null);
  assert.match(String(yubiAdminKey("a", TAP_ENV)), /^[0-9a-f]{64}$/, "stored as a hash");
});

test("Tap limit: under the limit OK, over it refused (padded), window expires, success resets, admins separate", async () => {
  const { db, getSql } = await limitDb();
  try {
    let t = 5_000_000;
    const clock = () => t;
    const limitA = yubiTapLimiter(getSql, yubiAdminKey("admin-a", TAP_ENV), LIMITS, clock, () => {});
    const limitB = yubiTapLimiter(getSql, yubiAdminKey("admin-b", TAP_ENV), LIMITS, clock, () => {});
    const bad = `${KEY_A}${"e".repeat(32)}`;
    const tap = async (otp: unknown, limit = limitA, opts: HarnessOpts = {}) => {
      const h = tapHarness(opts);
      const out = await consumeYubiTap(otp, { ...h.deps, limit });
      return { out, h };
    };
    // Under the limit: 5 failed taps are each a normal refusal.
    for (let i = 0; i < LIMITS.max; i += 1) {
      assert.equal((await tap(bad, limitA, { cloud: "YubiCloud rejected that OTP." })).out, YUBI_REFUSED, `fail ${i + 1}`);
    }
    // Over the limit: refused with the settled text, padded, and never reaches the lookup or YubiCloud.
    const over = await tap(TAP_A);
    assert.equal(over.out, YUBI_TOO_MANY);
    assert.equal(over.h.elapsed(), YUBI_REFUSAL_FLOOR_MS);
    assert.deepEqual(over.h.calls, []);
    assert.equal(over.h.lookups(), 0);
    // Another admin is counted on their own.
    assert.equal((await tap(TAP_A, limitB)).out, null, "admin B unaffected");
    // The window expires.
    t += LIMITS.windowMs + 1;
    assert.equal((await tap(TAP_A)).out, null, "after the window, taps work again");
    // A good tap resets the count: 4 fails + good + 5 fails all allowed, the next is refused.
    for (let i = 0; i < LIMITS.max - 1; i += 1) await tap(bad, limitA, { cloud: "YubiCloud rejected that OTP." });
    assert.equal((await tap(TAP_A)).out, null, "good tap under the limit");
    for (let i = 0; i < LIMITS.max; i += 1) {
      assert.equal((await tap(bad, limitA, { cloud: "YubiCloud rejected that OTP." })).out, YUBI_REFUSED, `after reset ${i + 1}`);
    }
    assert.equal((await tap(TAP_A)).out, YUBI_TOO_MANY, "count restarted after the good tap");
    // Malformed and non-string taps count too.
    const limitC = yubiTapLimiter(getSql, yubiAdminKey("admin-c", TAP_ENV), LIMITS, clock, () => {});
    for (let i = 0; i < LIMITS.max; i += 1) await tap(i % 2 ? 42 : "short", limitC);
    assert.equal((await tap(TAP_A, limitC)).out, YUBI_TOO_MANY);
    // Parallel taps cannot slip past: exactly max are let through.
    const limitD = yubiTapLimiter(getSql, yubiAdminKey("admin-d", TAP_ENV), LIMITS, clock, () => {});
    const results = await Promise.all(Array.from({ length: 12 }, () => limitD!.attempt()));
    assert.equal(results.filter(Boolean).length, LIMITS.max);
  } finally {
    await db.close();
  }
});

test("Tap limit fails closed when the store errors", async () => {
  const h = tapHarness();
  const broken = { attempt: async () => { throw new Error("db"); }, clear: async () => {} };
  assert.equal(await consumeYubiTap(TAP_A, { ...h.deps, limit: broken }), YUBI_REFUSED);
  assert.equal(h.elapsed(), YUBI_REFUSAL_FLOOR_MS);
  assert.deepEqual(h.calls, []);
  const h2 = tapHarness();
  const noClear = { attempt: async () => true, clear: async () => { throw new Error("db"); } };
  assert.equal(await consumeYubiTap(TAP_A, { ...h2.deps, limit: noClear }), null, "a clear error never refuses a good tap");
});

// --- r12: call-site keys, no-session refusal, cloud budget, keyed hash + purge, ceiling alert ---

/** Splits the argument list that starts right after an opening paren (balanced, top-level commas). */
function callArgs(src: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = open + 1; i < src.length; i += 1) {
    const ch = src[i]!;
    if ("([{".includes(ch)) depth += 1;
    if (")]}".includes(ch)) {
      if (depth === 0) {
        args.push(cur.trim());
        return args;
      }
      depth -= 1;
    }
    if (ch === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  throw new Error("unbalanced call");
}

test("Every access.ts tap-limit key is the verified session user id, never a request field", () => {
  const src = readFileSync(new URL("./access.ts", import.meta.url), "utf8");
  const sites: { fn: string; middleware: string; key: string }[] = [];
  for (const m of src.matchAll(/consumeYubiOtp\(/g)) {
    const at = m.index!;
    if (src.lastIndexOf("import", at) > src.lastIndexOf(";", at)) continue; // the import line
    const before = src.slice(0, at);
    const decl = [...before.matchAll(/export const (\w+) = createServerFn\([^)]*\)\s*\.middleware\(\[([^\]]*)\]\)/g)].pop();
    assert.ok(decl, "call site inside a server function");
    const args = callArgs(src, at + "consumeYubiOtp".length);
    assert.equal(args.length, 2, `${decl[1]}: otp and key`);
    sites.push({ fn: decl[1]!, middleware: decl[2]!.replace(/\s+/g, " ").trim(), key: args[1]! });
  }
  const fromVerifiedToken = "context.userId"; // authMiddleware: requireUserId(verified bearer/cookie)
  const fromVerifiedSession = "(context as { xUserId?: string | null }).xUserId"; // optionalXSession: getSessionUser
  assert.deepEqual(
    sites.map((s) => [s.fn, s.key]),
    [
      ["confirmYubi", fromVerifiedToken],
      ["approveOutgoing", fromVerifiedSession],
      ["renewAdminPasswordWithX", fromVerifiedToken],
    ],
    "every call site is listed here (a new one must be pinned too)",
  );
  for (const s of sites) {
    assert.ok(!/\b(data|input|request|req|headers?|query|body|params|searchParams|getRequest|otp|ticket|token|action)\b/.test(s.key), `${s.fn}: request field in key`);
    if (s.key === fromVerifiedToken) assert.match(s.middleware, /\bauthMiddleware\b/, `${s.fn}: userId comes from authMiddleware`);
    if (s.key === fromVerifiedSession) assert.match(s.middleware, /\boptionalXSession\b/, `${s.fn}: xUserId comes from optionalXSession`);
  }
  // Where those ids come from: the verified session, not the request.
  const xs = readFileSync(new URL("./x-session.ts", import.meta.url), "utf8");
  assert.match(xs, /const user = await getSessionUser\(bearer\);/);
  assert.match(xs, /xUserId: user\?\.id \?\? null,/);
  const mw = readFileSync(new URL("../auth/middleware.ts", import.meta.url), "utf8");
  assert.match(mw, /const userId = await requireUserId\(context\.bearerToken\);\s*return next\(\{ context: \{ userId \} \}\);/);
});

test("No signed-in user id (or no limiter key) gets the padded generic refusal, never a shared bucket", async () => {
  for (const id of [null, undefined, "", "   "]) {
    assert.equal(yubiAdminKey(id, TAP_ENV), null, `id ${String(id)}`);
  }
  assert.equal(yubiAdminKey(123 as unknown as string, TAP_ENV), null, "non-string id");
  const getSql = async () => ({ query: async () => [] as never[] });
  assert.equal(yubiTapLimiter(getSql, null), null);
  assert.equal(yubiTapLimiter(getSql, "no-session"), null, "only a 64-hex keyed hash is a key");
  for (const f of ["./yubi-limit.ts", "./yubi.server.ts", "./access.ts"]) {
    assert.ok(!readFileSync(new URL(f, import.meta.url), "utf8").includes("no-session"), `${f}: no shared bucket`);
  }
  // A good tap with no limiter (null) is still refused, padded, before any lookup or YubiCloud.
  for (const limit of [null, yubiTapLimiter(getSql, yubiAdminKey(null, TAP_ENV))]) {
    const h = tapHarness();
    assert.equal(await consumeYubiTap(TAP_A, { ...h.deps, limit }), YUBI_REFUSED);
    assert.equal(h.elapsed(), YUBI_REFUSAL_FLOOR_MS, "padded");
    assert.deepEqual(h.calls, []);
    assert.equal(h.lookups(), 0);
  }
});

test("YubiCloud budget = min(1200, floor - 200 - elapsed), with an injected clock", async () => {
  assert.equal(YUBI_REFUSAL_FLOOR_MS, 1500);
  assert.equal(YUBI_CLOUD_HEADROOM_MS, 200);
  const table: [number, number | null][] = [
    [0, 1200],
    [50, 1200],
    [100, 1200],
    [101, 1199],
    [250, 1050],
    [400, 900],
    [700, 600],
    [1000, 300],
    [1299, 1],
    [1300, null],
    [1400, null],
  ];
  for (const [elapsed, want] of table) {
    assert.equal(
      want,
      Math.min(YUBICLOUD_TIMEOUT_MS, YUBI_REFUSAL_FLOOR_MS - YUBI_CLOUD_HEADROOM_MS - elapsed) > 0
        ? Math.min(YUBICLOUD_TIMEOUT_MS, YUBI_REFUSAL_FLOOR_MS - YUBI_CLOUD_HEADROOM_MS - elapsed)
        : null,
      `table row ${elapsed}`,
    );
    const h = tapHarness({ rowsMs: elapsed, cloudMs: 0 });
    const out = await consumeYubiTap(TAP_A, h.deps);
    assert.deepEqual(h.budgets, want === null ? [] : [want], `elapsed ${elapsed}ms`);
    assert.equal(out, want === null ? YUBI_REFUSED : null, `elapsed ${elapsed}ms: outcome`);
  }
});

test("Stored key is HMAC-SHA256(S1R1US_YUBI_TAP_KEY, user id); missing or short key fails closed", async () => {
  const { createHash, createHmac } = await import("node:crypto");
  assert.equal(YUBI_TAP_SETTING_NAME, "S1R1US_YUBI_TAP_KEY");
  assert.equal(YUBI_TAP_KEY_MIN_BYTES, 32);
  const want = createHmac("sha256", TAP_SECRET).update("12345").digest("hex");
  assert.equal(yubiAdminKey("12345", TAP_ENV), want);
  assert.equal(yubiAdminKey(" 12345 ", TAP_ENV), want, "id trimmed");
  assert.notEqual(want, createHash("sha256").update("yubi-tap:12345").digest("hex"), "not the old unkeyed hash");
  assert.notEqual(want, createHash("sha256").update("12345").digest("hex"));
  assert.notEqual(yubiAdminKey("12345", { [YUBI_TAP_SETTING_NAME]: `${TAP_SECRET}-other` }), want, "depends on the key");
  const short = "x".repeat(31);
  for (const v of [undefined, "", "   ", short, ` ${short} `]) {
    assert.equal(yubiTapKey({ [YUBI_TAP_SETTING_NAME]: v }), null, `key ${String(v?.length)}`);
    assert.equal(yubiAdminKey("12345", { [YUBI_TAP_SETTING_NAME]: v }), null);
    const h = tapHarness();
    const limit = yubiTapLimiter(async () => ({ query: async () => [] as never[] }), yubiAdminKey("12345", { [YUBI_TAP_SETTING_NAME]: v }));
    assert.equal(await consumeYubiTap(TAP_A, { ...h.deps, limit }), YUBI_REFUSED, "good tap refused without a key");
    assert.equal(h.elapsed(), YUBI_REFUSAL_FLOOR_MS);
    assert.deepEqual(h.calls, []);
  }
  assert.equal(yubiTapKey({ [YUBI_TAP_SETTING_NAME]: "y".repeat(32) }), "y".repeat(32), "32 bytes is enough");
  // The value is never logged: no console use in the limiter, and the alert carries no secret.
  const lim = readFileSync(new URL("./yubi-limit.ts", import.meta.url), "utf8");
  assert.ok(!/console\./.test(lim), "limiter never logs directly");
  assert.ok(!/secret[^\n]*alert|alert\([^)]*secret/.test(lim));
  // The table holds only the keyed hash.
  const { db, getSql } = await limitDb();
  try {
    const limit = yubiTapLimiter(getSql, yubiAdminKey("12345", TAP_ENV), LIMITS, () => 1_000, () => {});
    assert.equal(await limit!.attempt(), true);
    const rows = (await db.query<{ admin_key: string }>("select admin_key from admin_yubi_taps")).rows;
    assert.deepEqual(rows.map((r) => r.admin_key), [want]);
    assert.ok(!JSON.stringify(rows).includes("12345"));
  } finally {
    await db.close();
  }
});

test("Expired limiter rows are purged on write; live rows and this tap's count stay", async () => {
  const { db, getSql } = await limitDb();
  try {
    const t = 10_000_000;
    const old = (n: number) => createHmacHex(`old-${n}`);
    const ins = "insert into admin_yubi_taps (admin_key, fails, window_start) values ($1, $2, $3)";
    await db.query(ins, [old(1), 5, t - LIMITS.windowMs]); // exactly at the edge: expired
    await db.query(ins, [old(2), 9, t - LIMITS.windowMs - 60_000]);
    await db.query(ins, [old(3), 2, t - LIMITS.windowMs + 1]); // still inside the window
    const key = yubiAdminKey("admin-p", TAP_ENV)!;
    await db.query(ins, [key, 3, t - 1_000]);
    const limit = yubiTapLimiter(getSql, key, LIMITS, () => t, () => {});
    assert.equal(await limit!.attempt(), true);
    const left = (await db.query<{ admin_key: string; fails: number }>("select admin_key, fails from admin_yubi_taps order by admin_key")).rows;
    assert.deepEqual(
      left.map((r) => [r.admin_key, r.fails]).sort(),
      [[key, 4], [old(3), 2]].sort(),
    );
    // A purge error never changes the outcome.
    let n = 0;
    const flaky = { query: async <T,>(text: string, params: unknown[] = []) => {
      n += 1;
      if (/^delete/.test(text)) throw new Error("db");
      return (await db.query<T>(text, params)).rows;
    } };
    const l2 = yubiTapLimiter(async () => flaky, key, LIMITS, () => t, () => {});
    assert.equal(await l2!.attempt(), true);
    assert.equal(n, 2, "upsert then purge");
  } finally {
    await db.close();
  }
});

function createHmacHex(s: string): string {
  return String(yubiAdminKey(s, TAP_ENV));
}

test("Per-admin ceiling trip raises one structured security event (no secret, no user id)", async () => {
  const { securityEvent } = await import("./security-log.ts");
  const { db, getSql } = await limitDb();
  try {
    const events: unknown[] = [];
    const id = "4242424242";
    const key = yubiAdminKey(id, TAP_ENV)!;
    const limit = yubiTapLimiter(getSql, key, LIMITS, () => 7_000_000, (e) => events.push(e));
    for (let i = 0; i < LIMITS.max; i += 1) assert.equal(await limit!.attempt(), true);
    assert.deepEqual(events, [], "no alert under the ceiling");
    assert.equal(await limit!.attempt(), false);
    assert.equal(await limit!.attempt(), false);
    assert.deepEqual(events, [{ event: "yubi_tap_ceiling", scope: "per-admin", ref: key.slice(0, 12), max: LIMITS.max, windowMs: LIMITS.windowMs }], "exactly one alert per window");
    const lines: string[] = [];
    securityEvent({ ...(events[0] as Parameters<typeof securityEvent>[0]), ...({ secret: TAP_SECRET, userId: id } as object) } as Parameters<typeof securityEvent>[0], (l) => lines.push(l));
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /^\[security\] \{/);
    const out = JSON.parse(lines[0]!.slice("[security] ".length));
    assert.deepEqual(Object.keys(out), ["at", "event", "scope", "ref", "max", "windowMs"], "only fixed fields");
    assert.ok(!lines[0]!.includes(id) && !lines[0]!.includes(TAP_SECRET), "no user id or secret");
    // An alert that throws never changes the outcome.
    const k2 = yubiAdminKey("admin-throw", TAP_ENV)!;
    const l2 = yubiTapLimiter(getSql, k2, LIMITS, () => 7_000_000, () => { throw new Error("log"); });
    for (let i = 0; i < LIMITS.max; i += 1) await l2!.attempt();
    assert.equal(await l2!.attempt(), false);
  } finally {
    await db.close();
  }
  // Comments state the real keying: per admin, not per session.
  const lim = readFileSync(new URL("./yubi-limit.ts", import.meta.url), "utf8");
  const cfg = readFileSync(new URL("./yubi-config.ts", import.meta.url), "utf8");
  assert.match(lim, /PER ADMIN, not per session/);
  assert.ok(!/per-session (tap )?limit|session tap limit|one session has/i.test(lim + cfg), "no per-session claims");
});

// Round 9 survivors (K3, L5b, L6, L10, K1c).

test("K3: the limiter key setting value never reaches stdout, stderr or console (sentinel)", async () => {
  const { randomBytes } = await import("node:crypto");
  // Obvious dummy sentinel (not a real secret), >= 32 bytes, unique per run.
  const sentinel = `SENTINEL-dummy-not-a-secret-${randomBytes(12).toString("hex")}`;
  const env = { [YUBI_TAP_SETTING_NAME]: sentinel };
  const seen: string[] = [];
  const text = (a: unknown[]) => a.map((x) => (typeof x === "string" ? x : x instanceof Uint8Array ? Buffer.from(x).toString("utf8") : String(x))).join(" ");
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
  const saved = methods.map((m) => console[m]);
  // Record and pass through (the test runner reports on stdout).
  process.stdout.write = ((...a: unknown[]) => { seen.push(text(a)); return (out as (...x: unknown[]) => boolean)(...a); }) as typeof process.stdout.write;
  process.stderr.write = ((...a: unknown[]) => { seen.push(text(a)); return (err as (...x: unknown[]) => boolean)(...a); }) as typeof process.stderr.write;
  for (const m of methods) console[m] = (...a: unknown[]) => { seen.push(text(a)); };
  // Also the process env, so code that reads the setting itself is covered.
  const savedEnv = process.env[YUBI_TAP_SETTING_NAME];
  process.env[YUBI_TAP_SETTING_NAME] = sentinel;
  const { db, getSql } = await limitDb();
  try {
    assert.equal(yubiTapKey(), sentinel);
    assert.equal(yubiTapKey(env), sentinel);
    const key = yubiAdminKey("777", env)!;
    assert.match(key, /^[0-9a-f]{64}$/);
    // Default alert sink (securityEvent -> console.warn): trip the ceiling once.
    const limit = yubiTapLimiter(getSql, key, LIMITS, () => 3_000_000);
    for (let i = 0; i <= LIMITS.max; i += 1) await limit!.attempt();
    await limit!.clear();
    const h = tapHarness();
    await consumeYubiTap(TAP_A, { ...h.deps, limit: yubiTapLimiter(getSql, yubiAdminKey("777", env), LIMITS, () => 3_000_000) });
    yubiTapKey({ [YUBI_TAP_SETTING_NAME]: sentinel.slice(0, 31) });
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
    methods.forEach((m, i) => { console[m] = saved[i] as never; });
    if (savedEnv === undefined) delete process.env[YUBI_TAP_SETTING_NAME]; else process.env[YUBI_TAP_SETTING_NAME] = savedEnv;
    await db.close();
  }
  assert.ok(seen.some((l) => l.includes("[security]") && l.includes("yubi_tap_ceiling")), "capture works (the alert line was seen)");
  assert.ok(!seen.some((l) => l.includes(sentinel) || l.includes(sentinel.slice(0, 31))), "setting value never written");
});

test("L5b: a non-integer fails count from the store is refused (fail closed)", async () => {
  const key = yubiAdminKey("admin-l5b", TAP_ENV)!;
  for (const v of [1.5, "2.5", 0.5, Number.NaN, null, undefined, "x", "", 0, -1, Number.POSITIVE_INFINITY]) {
    const sql = { query: async <T,>(text: string) => (/^insert/.test(text) ? ([{ fails: v }] as T[]) : ([] as T[])) };
    const limit = yubiTapLimiter(async () => sql, key, LIMITS, () => 1_000, () => {});
    assert.equal(await limit!.attempt(), false, `fails=${String(v)}`);
  }
  // Control: an integer count under the ceiling is allowed (also as a numeric string from the driver).
  for (const v of [1, "3", LIMITS.max]) {
    const sql = { query: async <T,>(text: string) => (/^insert/.test(text) ? ([{ fails: v }] as T[]) : ([] as T[])) };
    assert.equal(await yubiTapLimiter(async () => sql, key, LIMITS, () => 1_000, () => {})!.attempt(), true, `fails=${String(v)}`);
  }
});

test("L6: the window is fixed from the first counted tap, never sliding", async () => {
  const { db, getSql } = await limitDb();
  try {
    const W = 60_000;
    const lim = { max: 2, windowMs: W };
    const t0 = 20_000_000;
    let t = t0;
    const key = yubiAdminKey("admin-l6", TAP_ENV)!;
    const limit = yubiTapLimiter(getSql, key, lim, () => t, () => {});
    assert.equal(await limit!.attempt(), true, "1st");
    t = t0 + W / 2;
    assert.equal(await limit!.attempt(), true, "2nd");
    t = t0 + W / 2 + 1;
    assert.equal(await limit!.attempt(), false, "3rd over the ceiling");
    const row = (await db.query<{ window_start: string | number }>("select window_start from admin_yubi_taps where admin_key = $1", [key])).rows[0];
    assert.equal(Number(row?.window_start), t0, "later taps do not move the window start");
    t = t0 + W - 1;
    assert.equal(await limit!.attempt(), false, "still inside the first window");
    t = t0 + W;
    assert.equal(await limit!.attempt(), true, "a fixed window ends W after the first tap");
    const after = (await db.query<{ window_start: string | number; fails: number }>("select window_start, fails from admin_yubi_taps where admin_key = $1", [key])).rows[0];
    assert.deepEqual([Number(after?.window_start), Number(after?.fails)], [t0 + W, 1], "new window, count reset");
  } finally {
    await db.close();
  }
});

test("L10: env limits are capped; out-of-range values fall back to the strict defaults", () => {
  const saved = { m: process.env.S1R1US_YUBI_TAP_MAX, w: process.env.S1R1US_YUBI_TAP_WINDOW_MS };
  const set = (m?: string, w?: string) => {
    if (m === undefined) delete process.env.S1R1US_YUBI_TAP_MAX; else process.env.S1R1US_YUBI_TAP_MAX = m;
    if (w === undefined) delete process.env.S1R1US_YUBI_TAP_WINDOW_MS; else process.env.S1R1US_YUBI_TAP_WINDOW_MS = w;
  };
  try {
    const cases: Array<[string | undefined, string | undefined, number, number]> = [
      ["50", undefined, 50, LIMITS.windowMs],
      ["1", undefined, 1, LIMITS.windowMs],
      ["51", undefined, LIMITS.max, LIMITS.windowMs],
      ["5000", undefined, LIMITS.max, LIMITS.windowMs],
      ["0", undefined, LIMITS.max, LIMITS.windowMs],
      ["7.5", undefined, LIMITS.max, LIMITS.windowMs],
      [undefined, String(24 * 60 * 60_000), LIMITS.max, 24 * 60 * 60_000],
      [undefined, "60000", LIMITS.max, 60_000],
      [undefined, String(24 * 60 * 60_000 + 1), LIMITS.max, LIMITS.windowMs],
      [undefined, "59999", LIMITS.max, LIMITS.windowMs],
    ];
    for (const [m, w, wantMax, wantWin] of cases) {
      set(m, w);
      assert.deepEqual(yubiTapLimits(), { max: wantMax, windowMs: wantWin }, `max=${String(m)} window=${String(w)}`);
    }
  } finally {
    set(saved.m, saved.w);
  }
});

test("K1c: key length is counted in UTF-8 bytes, not characters", () => {
  const ok = "€".repeat(11); // 11 chars, 33 bytes
  const short = `${"€".repeat(10)}a`; // 11 chars, 31 bytes
  assert.equal(Buffer.byteLength(ok, "utf8"), 33);
  assert.equal(Buffer.byteLength(short, "utf8"), 31);
  assert.equal(yubiTapKey({ [YUBI_TAP_SETTING_NAME]: ok }), ok, "33 bytes accepted");
  assert.match(String(yubiAdminKey("12345", { [YUBI_TAP_SETTING_NAME]: ok })), /^[0-9a-f]{64}$/);
  assert.equal(yubiTapKey({ [YUBI_TAP_SETTING_NAME]: short }), null, "31 bytes refused");
  assert.equal(yubiAdminKey("12345", { [YUBI_TAP_SETTING_NAME]: short }), null);
});

test("Startup check uses the same setting name and the same 32-byte rule", () => {
  const src = readFileSync(new URL("../../../scripts/do-start.mjs", import.meta.url), "utf8");
  assert.ok(src.includes(`YUBI_TAP_SETTING_NAME = "${YUBI_TAP_SETTING_NAME}"`), "same setting name");
  assert.match(src, /Buffer\.byteLength\(v, "utf8"\) >= 32\) return null;/);
  assert.equal(YUBI_TAP_KEY_MIN_BYTES, 32);
  assert.match(src, /if \(IS_MAIN\) \{\nconst yubiTapWarning = yubiTapSecretWarning\(\);\nif \(yubiTapWarning\) console\.warn\(yubiTapWarning\);/, "warns at boot");
});

test("N6/N8: an upsert error or a DB connection failure inside the limiter refuses the tap (padded)", async () => {
  const key = yubiAdminKey("admin-n6", TAP_ENV)!;
  const alerts: unknown[] = [];
  // N6: the count update (upsert) throws; housekeeping would succeed.
  let upserts = 0;
  const upsertFails = { query: async (text: string) => {
    if (/^\s*insert/.test(text)) { upserts++; throw new Error("db"); }
    return [] as never[];
  } } as never;
  // N8: getSql() itself rejects (connection failure); no query is ever reached.
  let connects = 0;
  const cases: [string, () => Promise<never>][] = [
    ["upsert throws", async () => upsertFails],
    ["connection fails", async () => { connects++; throw new Error("ECONNREFUSED"); }],
  ];
  for (const [name, getSql] of cases) {
    const limit = yubiTapLimiter(getSql, key, LIMITS, () => 9_000_000, (e) => alerts.push(e))!;
    assert.ok(limit, name);
    await assert.rejects(limit.attempt(), Error, `${name}: attempt() rejects, never resolves allowed`);
    const h = tapHarness();
    assert.equal(await consumeYubiTap(TAP_A, { ...h.deps, limit }), YUBI_REFUSED, `${name}: tap refused`);
    assert.equal(h.elapsed(), YUBI_REFUSAL_FLOOR_MS, `${name}: padded`);
    assert.deepEqual(h.calls, [], `${name}: no YubiCloud call`);
    assert.equal(h.lookups(), 0, `${name}: no key lookup`);
  }
  assert.equal(upserts, 2);
  assert.equal(connects, 2);
  assert.deepEqual(alerts, [], "a store failure is not a ceiling event");
});
