import assert from "node:assert/strict";
import test from "node:test";
import { limitFromEnv } from "./limit-env.ts";

const KEY = "S1R1US_TEST_LIMIT_ONLY";

test("unset env falls back to the strict default", () => {
  delete process.env[KEY];
  assert.equal(limitFromEnv(KEY, 3, 1, 10), 3);
});

test("bad or out-of-range env falls back to the strict default", () => {
  for (const v of ["", "  ", "abc", "2.5", "0", "11", "-4"]) {
    process.env[KEY] = v;
    assert.equal(limitFromEnv(KEY, 3, 1, 10), 3, v);
  }
  delete process.env[KEY];
});

test("valid env value is used", () => {
  process.env[KEY] = " 7 ";
  assert.equal(limitFromEnv(KEY, 3, 1, 10), 7);
  delete process.env[KEY];
});
