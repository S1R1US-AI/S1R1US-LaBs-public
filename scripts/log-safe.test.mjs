import { test } from "node:test";
import assert from "node:assert/strict";
import { logSafe } from "./do-start.mjs";

test("logSafe strips C0 controls, DEL, and line separators", () => {
  assert.equal(logSafe("/a\r\nb"), "/ab");
  assert.equal(logSafe("x\ty\u0000z\u001b[31m"), "xyz[31m");
  assert.equal(logSafe("a\u007fb"), "ab");
  assert.equal(logSafe("a\u2028b\u2029c"), "abc");
});

test("logSafe strips C1 controls 0x80-0x9f, including the single-byte CSI", () => {
  assert.equal(logSafe("a\u009b31mb"), "a31mb");
  assert.equal(logSafe("\u0080x\u0085y\u009f"), "xy");
  for (let c = 0x80; c <= 0x9f; c++) assert.equal(logSafe(String.fromCharCode(c)), "", `0x${c.toString(16)}`);
});

test("logSafe keeps ordinary text and printable non-ASCII", () => {
  assert.equal(logSafe("/board?x=1&y=2"), "/board?x=1&y=2");
  assert.equal(logSafe("caf\u00e9 \u00a0 \u20bf"), "caf\u00e9 \u00a0 \u20bf");
  assert.equal(logSafe(undefined), "");
  assert.equal(logSafe(null), "");
  assert.equal(logSafe(42), "42");
});
