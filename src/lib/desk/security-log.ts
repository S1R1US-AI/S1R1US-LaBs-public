/**
 * Public security statement. The detailed security log (control checks and review items) is kept
 * privately by the operator and is not part of this repository, so these lists are empty here.
 */
export type ProtocolRow = {
  id: string;
  title: string;
  status: "PASS" | "OPERATOR" | "FAIL";
  detail: string;
};

export type VulnRow = {
  id: string;
  title: string;
  severity: "HIGH" | "MED" | "LOW" | "INFO";
  status: "FIXED" | "MITIGATED" | "OPERATOR" | "ACCEPT";
  detail: string;
};

export const ANALYSIS_AS_OF = "Security review · CISA KEV / OSV.dev";

export const SECURITY_STATEMENT =
  "We review dependencies against public advisories, scan every change for secrets, and send security headers on every response. Detailed review notes are kept privately. To report a vulnerability, follow SECURITY.md.";

export function protocolRows(): ProtocolRow[] {
  return [];
}

export function vulnRows(): VulnRow[] {
  return [];
}

/**
 * Structured server security events (one JSON line on stderr, prefixed "[security]").
 * The type allows only fixed, non-secret fields: never a secret, setting value or plain user id.
 */
export type SecurityEvent = {
  event: "yubi_tap_ceiling";
  scope: "per-admin";
  /** First 12 hex chars of the keyed limiter hash (correlation only; not the user id). */
  ref: string;
  max: number;
  windowMs: number;
};

export function securityEvent(e: SecurityEvent, sink: (line: string) => void = (line) => console.warn(line)): void {
  const { event, scope, ref, max, windowMs } = e;
  sink(`[security] ${JSON.stringify({ at: new Date().toISOString(), event, scope, ref, max, windowMs })}`);
}
