/** Morning-report security section. Server-only: reached through the admin server functions. */
import { protocolRows, vulnRows } from "./security-log";
import { s3cSweepRows, s3cSweepScore } from "./s3c-sweep";
import { owlSecuritySummary } from "./owl-forum";
import { alignmentScore } from "./alignment";

const MANDATE_NOTE =
  "Alignment Score 1–100 is security protocols vs system mandate. Security headers and rate limits are app-layer. Live Coinbase create stays off. Score is ops honesty, not a promise of zero risk.";

export function morningSecurity() {
  const proto = protocolRows();
  const vulns = vulnRows();
  const fail = proto.filter((p) => p.status === "FAIL");
  const operator = proto.filter((p) => p.status === "OPERATOR");
  const open = vulns.filter((v) => v.status === "OPERATOR" || v.status === "ACCEPT");
  const needHelp = vulns.filter((v) => v.status === "OPERATOR");
  const rows = s3cSweepRows();
  const headline =
    fail.length === 0
      ? `SECURITY ANALYSIS — ${proto.length - operator.length} PASS · ${operator.length} OPERATOR`
      : `SECURITY ANALYSIS — FAIL ${fail.length} · ${operator.length} OPERATOR`;
  return {
    asOf: new Date().toISOString(),
    headline,
    s3c: s3cSweepScore(rows),
    s3cRows: rows,
    owl: owlSecuritySummary(),
    proto,
    vulns,
    fail,
    operator,
    open,
    needHelp,
    alignment: alignmentScore(),
    mandateScoreNote: MANDATE_NOTE,
  };
}

export type MorningSecurity = ReturnType<typeof morningSecurity>;
