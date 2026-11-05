import { looksLikeSecret } from "./secret-check";

/** Input guards: secret-paste rejection, address format checks and the operator Grok rate limit. */
export { looksLikeCdpSecret, looksLikeSecret, looksLikeWalletSecret } from "./secret-check";

export { CDP_KEYS, CDP_REVOKE, MCP_DOCS, MCP_REMOTE, SPARROW_SITE } from "./coinbase-links";

export function assertSafePayload(raw: string): string | null {
  if (raw.length > 80_000) return "Snapshot too large.";
  if (looksLikeSecret(raw)) return "Secret rejected. Never paste a Coinbase API key, wallet seed or private key here.";
  return null;
}

export function isEvmAddress(text: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(text.trim());
}

/** Base58 pubkey (Phantom / Base app Solana). Not USDC on Ethereum or Base. */
export function looksLikeSolanaAddress(text: string): boolean {
  const a = text.trim();
  if (!a || a.startsWith("0x") || a.startsWith("bc1")) return false;
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(a)) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
}

export function usdcReceiveError(raw: string): string | null {
  const a = raw.trim();
  if (!a) return null;
  if (looksLikeSolanaAddress(a)) {
    return "That is a Solana address. Switch the Base app network to Base or Ethereum, then Receive native USDC. Need a 0x… address.";
  }
  if (!isEvmAddress(a)) {
    return "USDC staging must be 0x + 40 hex (same address on Ethereum and Base). Native USDC only.";
  }
  return null;
}

export function isBtcReceiveAddress(text: string): boolean {
  const a = text.trim();
  if (looksLikeSecret(a)) return false;
  if (/^(bc1[qp][a-z0-9]{25,90})$/.test(a)) return true;
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(a)) return true;
  return false;
}

const WINDOW_MS = 10 * 60_000;
const MAX_GROK = 6;
const grokHits: number[] = [];

export function grokRateLimit(): string | null {
  const now = Date.now();
  while (grokHits.length && now - grokHits[0]! > WINDOW_MS) grokHits.shift();
  if (grokHits.length >= MAX_GROK) return "Grok cap reached. Try again later. Operator only, user-initiated.";
  grokHits.push(now);
  return null;
}

export function grokUsage() {
  const now = Date.now();
  while (grokHits.length && now - grokHits[0]! > WINDOW_MS) grokHits.shift();
  return { used: grokHits.length, max: MAX_GROK, windowMin: 10 };
}
