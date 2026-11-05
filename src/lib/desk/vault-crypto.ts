/** AES-256-GCM sealing for the desk_vault row. Stored format (unchanged): base64 ciphertext, 12-byte IV, 16-byte tag. */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const VAULT_IV_BYTES = 12;
export const VAULT_TAG_BYTES = 16;

export type SealedVault = { ciphertext: string; iv: string; tag: string };

function decodeExact(value: string, bytes: number, field: string) {
  const buf = Buffer.from(value, "base64");
  if (buf.length !== bytes || buf.toString("base64") !== value) {
    throw new Error(`vault ${field} must be ${bytes} bytes`);
  }
  return buf;
}

export function sealVault(plain: string, key: Buffer): SealedVault {
  const iv = randomBytes(VAULT_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: VAULT_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function openVault(row: SealedVault, key: Buffer): string {
  const iv = decodeExact(row.iv, VAULT_IV_BYTES, "iv");
  const tag = decodeExact(row.tag, VAULT_TAG_BYTES, "tag");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: VAULT_TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
