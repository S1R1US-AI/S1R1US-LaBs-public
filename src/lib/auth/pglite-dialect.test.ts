import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  transactionBeginSql,
  UnsupportedIsolationLevelError,
} from "./pglite-isolation.ts";

const dialect = readFileSync(new URL("./pglite-dialect.ts", import.meta.url), "utf8");
const isolation = readFileSync(new URL("./pglite-isolation.ts", import.meta.url), "utf8");

describe("transaction isolation SQL is allowlisted", () => {
  it("emits a fixed START TRANSACTION for each Postgres isolation level", () => {
    assert.equal(
      transactionBeginSql("read committed"),
      "start transaction isolation level read committed",
    );
    assert.equal(
      transactionBeginSql("repeatable read"),
      "start transaction isolation level repeatable read",
    );
    assert.equal(
      transactionBeginSql("serializable"),
      "start transaction isolation level serializable",
    );
    assert.equal(
      transactionBeginSql("read uncommitted"),
      "start transaction isolation level read uncommitted",
    );
  });

  it("normalizes case and separators but still only emits allowlisted names", () => {
    assert.equal(
      transactionBeginSql("  READ_COMMITTED  "),
      "start transaction isolation level read committed",
    );
    assert.equal(
      transactionBeginSql("Repeatable-Read"),
      "start transaction isolation level repeatable read",
    );
  });

  it("uses BEGIN only when the isolation level is missing or empty", () => {
    assert.equal(transactionBeginSql(undefined), "begin");
    assert.equal(transactionBeginSql(""), "begin");
    assert.equal(transactionBeginSql("   "), "begin");
  });

  it("throws on a non-empty value that is not allowlisted", () => {
    const bad = [
      "snapshot",
      "serializable; drop table users",
      "read committed; drop table users",
      "read committed --",
      "repeatable read or write",
    ];
    for (const value of bad) {
      assert.throws(
        () => transactionBeginSql(value),
        (err: unknown) => {
          assert.ok(err instanceof UnsupportedIsolationLevelError);
          return true;
        },
      );
    }
  });

  it("the dialect uses the helper and never interpolates the raw setting", () => {
    assert.match(dialect, /transactionBeginSql\(settings\.isolationLevel\)/);
    assert.match(dialect, /from "\.\/pglite-isolation"/);
    assert.doesNotMatch(
      dialect,
      /start transaction isolation level \$\{settings\.isolationLevel\}/,
    );
    assert.doesNotMatch(isolation, /\$\{/);
    assert.doesNotMatch(isolation, /`start transaction/);
  });
});
