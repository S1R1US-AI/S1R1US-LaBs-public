import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { originAllowed, rpIdOf } from "./webauthn-origin.ts";

/** Runs fn with NODE_ENV set (or removed), then puts the old value back. */
function withNodeEnv(value: string | undefined, fn: () => void): void {
  const old = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    fn();
  } finally {
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
}

describe("security key origin", () => {
  it("allows the real site over https only", () => {
    assert.equal(originAllowed("https://s1r1us.ai"), true);
    assert.equal(originAllowed("https://www.s1r1us.ai"), true);
    assert.equal(originAllowed("http://s1r1us.ai"), false);
  });

  it("allows local dev hosts outside production", () => {
    for (const env of [undefined, "development", "test"]) {
      withNodeEnv(env, () => {
        assert.equal(originAllowed("http://localhost:3000"), true, String(env));
        assert.equal(originAllowed("http://127.0.0.1:8080"), true, String(env));
        assert.equal(originAllowed("https://localhost"), true, String(env));
      });
    }
  });

  it("rejects local dev hosts in production", () => {
    withNodeEnv("production", () => {
      assert.equal(originAllowed("http://localhost:3000"), false);
      assert.equal(originAllowed("https://localhost"), false);
      assert.equal(originAllowed("http://127.0.0.1:8080"), false);
      assert.equal(originAllowed("https://127.0.0.1"), false);
      assert.equal(originAllowed("http://LOCALHOST:3000"), false);
    });
  });

  it("still allows the real site in production", () => {
    withNodeEnv("production", () => {
      assert.equal(originAllowed("https://s1r1us.ai"), true);
      assert.equal(originAllowed("https://www.s1r1us.ai"), true);
      assert.equal(originAllowed("http://s1r1us.ai"), false);
    });
  });

  it("binds keys to the real site name, never a dev host, in production", () => {
    withNodeEnv("production", () => {
      assert.equal(rpIdOf("http://localhost:3000"), "s1r1us.ai");
      assert.equal(rpIdOf("http://127.0.0.1:8080"), "s1r1us.ai");
      assert.equal(rpIdOf("https://s1r1us.ai"), "s1r1us.ai");
    });
  });

  it("ignores the request host, so a faked host adds nothing", () => {
    assert.equal(originAllowed("https://evil.example", "evil.example"), false);
    assert.equal(originAllowed("https://app.ondigitalocean.app", "app.ondigitalocean.app"), false);
    assert.equal(originAllowed("https://s1r1us.ai.evil.example", "s1r1us.ai.evil.example"), false);
  });

  it("rejects bad input", () => {
    assert.equal(originAllowed(""), false);
    assert.equal(originAllowed("not a url"), false);
    assert.equal(originAllowed("javascript:alert(1)"), false);
  });

  it("binds keys to a fixed site name", () => {
    assert.equal(rpIdOf("https://s1r1us.ai"), "s1r1us.ai");
    assert.equal(rpIdOf("https://www.s1r1us.ai"), "s1r1us.ai");
    assert.equal(rpIdOf("https://evil.example"), "s1r1us.ai");
    assert.equal(rpIdOf("garbage"), "s1r1us.ai");
    withNodeEnv("development", () => assert.equal(rpIdOf("http://localhost:3000"), "localhost"));
  });
});
