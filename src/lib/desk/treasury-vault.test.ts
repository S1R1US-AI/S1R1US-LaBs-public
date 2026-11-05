import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { openVault, sealVault, VAULT_IV_BYTES, VAULT_TAG_BYTES } from "./vault-crypto.ts";

const key = randomBytes(32);
const plain = '{"sparrowAddress":"","mainUuid":"m","agentUuid":"a","usdcAddress":""}';

/** Sealing shape that shipped before the tag-length fix, to prove old rows still open. */
function legacySeal(text: string, k: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

describe("treasury vault AES-GCM", () => {
  it("round-trips with a 12-byte IV and a 16-byte tag", () => {
    const row = sealVault(plain, key);
    assert.equal(Buffer.from(row.iv, "base64").length, VAULT_IV_BYTES);
    assert.equal(Buffer.from(row.tag, "base64").length, VAULT_TAG_BYTES);
    assert.equal(openVault(row, key), plain);
  });

  it("still opens rows sealed by the previous code", () => {
    assert.equal(openVault(legacySeal(plain, key), key), plain);
  });

  it("rejects a truncated 4-byte tag", () => {
    const row = sealVault(plain, key);
    const tag = Buffer.from(row.tag, "base64").subarray(0, 4).toString("base64");
    assert.throws(() => openVault({ ...row, tag }, key), /tag must be 16 bytes/);
  });

  it("rejects other truncated and over-long tags", () => {
    const row = sealVault(plain, key);
    for (const n of [8, 12, 15]) {
      const tag = Buffer.from(row.tag, "base64").subarray(0, n).toString("base64");
      assert.throws(() => openVault({ ...row, tag }, key), /tag must be 16 bytes/);
    }
    const long = Buffer.concat([Buffer.from(row.tag, "base64"), Buffer.alloc(1)]).toString("base64");
    assert.throws(() => openVault({ ...row, tag: long }, key), /tag must be 16 bytes/);
  });

  it("rejects a wrong tag of the right length", () => {
    const row = sealVault(plain, key);
    const tag = Buffer.from(row.tag, "base64");
    tag[0] ^= 1;
    assert.throws(() => openVault({ ...row, tag: tag.toString("base64") }, key));
  });

  it("rejects a tampered ciphertext", () => {
    const row = sealVault(plain, key);
    const ct = Buffer.from(row.ciphertext, "base64");
    ct[0] ^= 1;
    assert.throws(() => openVault({ ...row, ciphertext: ct.toString("base64") }, key));
  });

  it("rejects an IV that is not 12 bytes", () => {
    const row = sealVault(plain, key);
    for (const n of [8, 16]) {
      assert.throws(
        () => openVault({ ...row, iv: randomBytes(n).toString("base64") }, key),
        /iv must be 12 bytes/,
      );
    }
  });
});
