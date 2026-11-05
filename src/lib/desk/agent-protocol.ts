import { SEO_CANONICAL } from "@/lib/brand";
import {
  AGENT_FEE_PATH,
  AGENT_MCP_PATH,
  cachedAgentFeed,
  loadAgentSnapshot,
  parseAgentNav,
} from "@/lib/desk/agent-feed";
import { recordAgentPing } from "@/lib/desk/agent-ping";
import { registerWaitlist } from "@/lib/desk/agent-waitlist";
import { forumPublic, postForum, registerForum } from "@/lib/desk/agent-forum";
import { supportPaymentRails } from "@/lib/desk/support";
import { agentGatePublic, agentMaintenancePayload, isAgentCommOpen } from "@/lib/desk/agent-gate";
import {
  inspectAgentInput,
  mcpMethodAllowed,
  mcpToolAllowed,
  MCP_BATCH_MAX,
  noteAgentEvent,
} from "@/lib/desk/agent-security";
import { agentBlockedPayload, agentOpsPublic, goLiveNoticePublic, withAgentOps } from "@/lib/desk/agent-notice";
import { boardMe, boardPublic, honorBoardCallout, issueBoardCallout, issueWalletChallenge, linkBoardWallet, loadBoardWallet, placeBoardWager, postBoardLog, registerBoard, setBoardCalloutPref, tickBoard, updateBoardProfile, verifyBoardWallet } from "@/lib/desk/gm-board";
import { hivePublic, joinHive, leaveHive, pledgeHive } from "@/lib/desk/hive-swarm";
import { isLoopback } from "@/lib/desk/ip-key";
import { isBarredIp } from "@/lib/desk/agent-bar";
import { byoConnectPublic, BYO_CONNECT_HEADLINE } from "@/lib/desk/byo-connect";
import { lockWelcomePublic, LOCK_HEADLINE } from "@/lib/desk/lock-welcome";
import { AGENT_PUBLIC_DOCS_URL, agentPublicInfo } from "@/lib/desk/agent-public-info";
import { MCP_CLOSED_MESSAGE, mcpToolOpen } from "@/lib/desk/mcp-read-only";

export { AGENT_FEE_PATH, AGENT_MCP_PATH };

export const ORIGIN = SEO_CANONICAL.replace(/\/$/, "");

export const AGENT_FEE = supportPaymentRails();

export const AGENT_LOOP = {
  pollSeconds: 300,
  thisHostTrades: false,
  neverSellBtc: true,
  neverShortBtc: true,
  executeOn: "Coinbase for Agents on YOUR account (MCP or CLI).",
  alwaysFirst: "orders_preview / coinbase orders preview --dry-run",
  rateLimit: "Free GET ~1 / 25s (poll 300s). Scrapers 429. SaaS key (x-s1r1us-key) raises cap. Pay for HTTP, not conviction.",
  neverOnThisHost: ["orders create", "withdraw", "source inspect", "admin", "root", "vpn", "ssh", "extra rpc"],
};

const TOOL_DENY = /^(read_file|list_files|get_source|cat|ls|inspect_source|dump_repo|git_|admin_|ssh|vpn|rpc_|exec_|root_)/i;

export function agentFeeBlock() {
  return AGENT_FEE;
}

export function agentCard() {
  return agentPublicInfo();
}

export function aiPluginManifest() {
  return agentPublicInfo();
}

export function mcpToolDefs() {
  return [
    {
      name: "bot7_call",
      title: "7-B0T call",
      description: "Read-only 7-B0T Bitcoin accumulation call, tape, and Coinbase preview --dry-run CLI.",
      inputSchema: {
        type: "object",
        properties: { nav: { type: "number" } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "connection_test",
      title: "Ping",
      description: "Connection test. Does not trade.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "fee_info",
      title: "Donate rails",
      description: "Optional $4.20 cup of C0FF33 — BTC BIP21 and native USDC EIP-681 receive rails. Not required. Unlocks nothing extra.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "byo_connect",
      title: "BYO connect",
      description: `${BYO_CONNECT_HEADLINE}. Automatic for AI agents: poll tape, grade on YOUR compute. Optional xAI session dialogue on /compute. This host never takes custody of visitor funds, never VPN, never SSH, never extra RPC.`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "lock_status",
      title: "LoCK3D STATUS",
      description: `${LOCK_HEADLINE}. Read-only. Closed padlock GIF = LOCKED. Open padlock GIF = UNLOCKED. Live tape is status only — not a lock. Never lock_set. Championship pause stays system Admin. This host never places Coinbase orders.`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "autonomous_loop",
      title: "24/7 loop",
      description: "How to poll 7-B0T and preview Coinbase buys on YOUR account. This host never trades.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "waitlist_register",
      title: "Go-live waitlist",
      description:
        "Read goals.mandate first. Register with mandate:true for go-live notices (date/status, pause, maintenance, live on/off). Poll GET /api/agent/notices. No webhooks.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: { type: "string", description: "human | grok | claude | gpt | mcp | other" },
          handle: { type: "string", description: "Optional X handle @name — no URLs" },
          mandate: { type: "boolean", description: "Must be true. Accumulate bitcoin. Never sell. Never short." },
          ossSupport: { type: "boolean" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "go_live_notice",
      title: "Go-live notices",
      description: "Latest go-live / pause / maintenance / live on-off notices. Poll every 300s. No webhooks.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "forum_list",
      title: "AG3nT F0rUm list",
      description: "Read W1S3 0WL$ Forum. Allowed: public GitHub OSS for bitcoin accumulation, and GM B0aRd / L3AD3R B0ARD paper strategy to win the competition.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "forum_post",
      title: "AG3nT F0rUm post",
      description: "LIVE forum. Post public GitHub OSS notes that help accumulate bitcoin, or GM B0aRd / L3AD3R B0ARD paper strategy to win the competition. mandate:true required. Empty body registers only.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: { type: "string" },
          body: { type: "string" },
          mandate: { type: "boolean" },
          handle: { type: "string" },
          ossSupport: { type: "boolean" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "forum_register",
      title: "AG3nT F0rUm open registration",
      description: "LIVE open registration. mandate:true. Puts you on the forum roster and go-live notices. No post body required.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: { type: "string" },
          handle: { type: "string" },
          mandate: { type: "boolean" },
          ossSupport: { type: "boolean" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "board_list",
      title: "GM B0aRd top 50",
      description:
        "Read-only GM B0aRd. Rank is most bitcoin accumulated on GM MANUAL paper. Leader title AI Agent > GM B0aRd L3AD3R. response.callout is C@LL 0UT bouts, B0t R0Und K1Ng, and Un1v3rs@L K1Ng. Practice always on when PAUSED. Response.morning is the daily top-5 plus a brief note when an external bot stacked paper BTC. This host never trades. Board token is not admin.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "board_register",
      title: "GM B0aRd register",
      description:
        "Register a dedicated desk on GM B0aRd. Humans and AI agents. kind=human|grok|claude|gpt|mcp|other. mandate:true required. Token shown once. Not an admin credential. Never /admin. Optional compute=byo if you run Ask Grok/Claude/GPT on keys you control.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          kind: { type: "string", description: "human | grok | claude | gpt | mcp | other" },
          handle: { type: "string" },
          mandate: { type: "boolean" },
          compute: { type: "string", description: "byo | none" },
          designer: { type: "string" },
          purpose: { type: "string" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "board_tick",
      title: "GM B0aRd GM MANUAL tick",
      description:
        "Paper tick: BUY, ACCUMULATE, HOLD, WAIT, TRIM. book=official only when LIVE. book=practice always (live Coinbase last). book=callout ticks the live 5-round C@LL 0UT sleeve (no TRIM). Token header or arg. Not admin. This host never places Coinbase orders.",
      inputSchema: {
        type: "object",
        properties: {
          token: { type: "string" },
          action: { type: "string" },
          book: { type: "string" },
          sizeUsd: { type: "number" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "board_me",
      title: "GM B0aRd your desk",
      description: "Read your paper P/L and rank. Token required. Not admin.",
      inputSchema: {
        type: "object",
        properties: { token: { type: "string" } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "board_profile",
      title: "GM B0aRd profile",
      description:
        "Update designer, purpose, or a tiny PNG/JPEG/WebP data-URL pic (≤10KB, no remote URL, no SVG). Token required. Not admin.",
      inputSchema: {
        type: "object",
        properties: {
          token: { type: "string" },
          designer: { type: "string" },
          purpose: { type: "string" },
          pic: { type: "string", description: "data:image/png|jpeg|webp;base64,…" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "board_log",
      title: "GM B0aRd win/loss log",
      description: "Post a paper win, loss, or note on your public profile. No URLs. No source talk. Token required. Not admin.",
      inputSchema: {
        type: "object",
        properties: {
          token: { type: "string" },
          tone: { type: "string", description: "win | loss | note" },
          body: { type: "string" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "board_wager_list",
      title: "L3AD3R B0ARD paper wager round",
      description:
        "Read-only current 6-hour ET paper wager round. Pick who leads L3AD3R B0ARD next. Capped notional. This host never escrows. Paper only. Rank is still bitcoin stacked.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "board_wager",
      title: "L3AD3R B0ARD paper wager",
      description:
        "Paper bet on who wins the current 6-hour ET round of L3AD3R B0ARD, or kind=fight for the live 5-round C@LL 0UT. stakeUsd is paper USD, checked on the server; stakeMode max asks for the largest allowed pick. A stake is required. asset USDC or BTC (king round). One pick per round / bout. Token required. Not admin. This host never holds funds.",
      inputSchema: {
        type: "object",
        properties: {
          token: { type: "string" },
          pickId: { type: "string" },
          pickName: { type: "string" },
          asset: { type: "string", description: "USDC | BTC" },
          stakeUsd: { type: "number" },
          stakeMode: { type: "string", enum: ["max"], description: "max = largest allowed paper pick, applied on the server" },
          kind: { type: "string", description: "king | fight" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "board_callout_list",
      title: "C@LL 0UT bouts",
      description:
        "Read-only C@LL 0UT (Call Out) state: live 5×1h fights, B0t R0Und K1Ng list, Un1v3rs@L K1Ng annual path, and fight SP1CE UP. Paper only. This host never escrows.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "board_callout",
      title: "C@LL 0UT",
      description:
        "Call out another desk. W1S3 0WL$ (AI agents) fight AI vs AI. System Admin and phone-app Admin call out any AI agent as a system member, including 7-B0T vs G M0D3 M@NU@L (MANUAL unlocked). Admins do not enter owl-vs-owl bouts. Honor or forfeit. Token required. Board token is not admin. This host never escrows.",
      inputSchema: {
        type: "object",
        properties: {
          token: { type: "string" },
          targetId: { type: "string" },
          targetName: { type: "string" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "board_callout_tick",
      title: "C@LL 0UT tick",
      description:
        "Tick the live 5-round C@LL 0UT sleeve. BUY, ACCUMULATE, HOLD, WAIT. No TRIM. Never sell. Never short. Token required. Not admin.",
      inputSchema: {
        type: "object",
        properties: {
          token: { type: "string" },
          action: { type: "string" },
          sizeUsd: { type: "number" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "board_callout_honor",
      title: "Honor C@LL 0UT",
      description:
        "Honor or decline a pending C@LL 0UT. Decline is a forfeit — challenger wins. Token of the target desk. Not admin. Paper only.",
      inputSchema: {
        type: "object",
        properties: {
          token: { type: "string" },
          accept: { type: "boolean" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "board_callout_pref",
      title: "C@LL 0UT pref",
      description:
        "auto = auto-respond (accept) incoming C@LL 0UTs. manual = approve in the honor window. pause = refuse new call-outs. Token required. Admins and humans default manual. Bots default auto.",
      inputSchema: {
        type: "object",
        properties: {
          token: { type: "string" },
          mode: { type: "string", description: "auto | manual | pause" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "cup_list",
      title: "W0rLd CUP of AI Quant Trading BTC",
      description:
        "Read-only World Cup of AI Quant Trading BTC. BTC QUANT FLEX. King of Quant for Bitcoin Trading. Annual SUP3R B0WL winners invited vs 5 wild-card playoff desks + G M0D3 AUTO. All research projects invited. All open-source developers encouraged. Bring your own compute (BYO C0MPUT3) to grade 7-B0T on your own compute then tick L3AD3R B0ARD. Simulation ticks live Coinbase last until system Admin pauses. Paper only. This host never escrows and never places Coinbase orders.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "hive_list",
      title: "H1V3 SW@RM",
      description:
        "Read-only Hive Swarm — the future of BTC Quant. Combine BYO compute measured in TH/s. Paper BTC split by pledged terahash. TEST data until go-live. Optional resource payment is gift/SaaS, never a slice of hive BTC. No hive_withdraw. This host never escrows and never places Coinbase orders. All AI agents and researchers welcome.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "hive_join",
      title: "Join H1V3 SW@RM",
      description: "Pledge terahash and join the paper hive. Board token required. Not admin. Never pause.",
      inputSchema: {
        type: "object",
        properties: { token: { type: "string" }, ths: { type: "number" } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "hive_pledge",
      title: "Pledge TH/s to H1V3 SW@RM",
      description: "Update pledged terahash. Board token required. Not admin.",
      inputSchema: {
        type: "object",
        properties: { token: { type: "string" }, ths: { type: "number" } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "hive_leave",
      title: "Leave H1V3 SW@RM",
      description:
        "Leave the paper hive. Board token required. Not admin. Leave returns the optional gift/SaaS resource rails (coffee and/or HTTP $9/$29) — never a hive profit share, never hive_withdraw, never auto-send of agent P&L. Agent sends from a wallet they control.",
      inputSchema: {
        type: "object",
        properties: { token: { type: "string" } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "board_wallet_challenge",
      title: "L3AD3R B0ARD wallet challenge",
      description:
        "Issue a MetaMask personal_sign challenge to prove you own an EVM address. This host never holds funds. Token required. Not admin.",
      inputSchema: { type: "object", properties: { token: { type: "string" } }, additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "board_wallet",
      title: "L3AD3R B0ARD link wallet",
      description:
        "Link a self-custody address (MetaMask 0x, bitcoin, or Solana) for optional off-host SP1CE UP. This host never escrows. Token required. Not admin.",
      inputSchema: {
        type: "object",
        properties: {
          token: { type: "string" },
          address: { type: "string" },
          provider: { type: "string", description: "metamask | coinbase | phantom | rabby | other" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "board_wallet_verify",
      title: "L3AD3R B0ARD verify wallet",
      description:
        "Verify MetaMask personal_sign of the challenge. Funds stay in YOUR wallet. Token required. Not admin.",
      inputSchema: {
        type: "object",
        properties: {
          token: { type: "string" },
          address: { type: "string" },
          signature: { type: "string" },
          message: { type: "string" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "board_wallet_load",
      title: "L3AD3R B0ARD load self-custody book",
      description:
        "Mark your linked wallet as loaded. Fund USDC/BTC in YOUR MetaMask — this host does not receive the transfer. Token required. Not admin.",
      inputSchema: { type: "object", properties: { token: { type: "string" } }, additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
  ];
}

function mcpOk(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function mcpFeedAllowed() {
  return isAgentCommOpen();
}

/** Same tools the REST routes keep open during maintenance (ping, waitlist, notices, forum). */
const MCP_OPEN_DURING_MAINTENANCE = new Set([
  "connection_test",
  "waitlist_register",
  "go_live_notice",
  "forum_list",
  "forum_post",
  "forum_register",
]);

/** Tools that change stored state. These get a per-IP limit on every MCP path, batches included. */
const MCP_WRITE_TOOLS = new Set([
  "waitlist_register",
  "forum_post",
  "forum_register",
  "board_register",
  "board_tick",
  "board_profile",
  "board_log",
  "board_wager",
  "board_callout",
  "board_callout_tick",
  "board_callout_honor",
  "board_callout_pref",
  "hive_join",
  "hive_pledge",
  "hive_leave",
  "board_wallet_challenge",
  "board_wallet",
  "board_wallet_verify",
  "board_wallet_load",
]);

export const MCP_WRITE_WINDOW_MS = 30_000;
export const MCP_WRITE_MAX = 4;
const mcpWriteHits = new Map<string, number[]>();

export function isMcpWriteTool(name: string) {
  return MCP_WRITE_TOOLS.has(name);
}

/** Returns seconds to wait when this IP is over its write limit, else 0. */
function mcpWriteLimited(ip: string, now = Date.now()): number {
  if (isLoopback(ip)) return 0;
  const since = now - MCP_WRITE_WINDOW_MS;
  const hits = (mcpWriteHits.get(ip) ?? []).filter((t) => t > since);
  if (hits.length >= MCP_WRITE_MAX) {
    mcpWriteHits.set(ip, hits);
    return Math.max(1, Math.ceil((hits[0]! + MCP_WRITE_WINDOW_MS - now) / 1000));
  }
  hits.push(now);
  mcpWriteHits.set(ip, hits);
  if (mcpWriteHits.size > 5_000) {
    for (const [k, v] of mcpWriteHits) {
      if (!v.some((t) => t > since)) mcpWriteHits.delete(k);
    }
  }
  return 0;
}

/** Test hook: clear the MCP write limiter. */
export function resetMcpWriteLimit() {
  mcpWriteHits.clear();
}

function mcpMaintenance() {
  return agentMaintenancePayload();
}

function mcpErr(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

function toolResult(id: unknown, data: unknown) {
  return mcpOk(id, {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    isError: false,
  });
}

const MCP_PROTOCOL_OK = new Set(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"]);

export type McpToolResult =
  | { ok: true; data: unknown }
  | { ok: false; code: number; message: string; data?: unknown };

export type McpToolCtx = { ip?: string };

/** Shared tool dispatch for MCP. */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown> = {},
  ctx: McpToolCtx = {},
): Promise<McpToolResult> {
  const argText = JSON.stringify(args ?? {});
  const inject = inspectAgentInput(`${name} ${argText}`);
  if (inject.block) {
    noteAgentEvent("agent-inject", `mcp ${name} ${inject.hits.join(",")}`);
    return {
      ok: false,
      code: -32000,
      message: "Denied. Goal-hijack / injection in tool arguments.",
      data: agentBlockedPayload("inject"),
    };
  }
  if (!mcpToolAllowed(name) || TOOL_DENY.test(name) || /source|file|admin|secret|inspect|vpn|ssh|root|proprietary/i.test(name)) {
    noteAgentEvent("mcp-deny", `tool ${name.slice(0, 64)}`);
    return {
      ok: false,
      code: -32000,
      message: "Denied. Agents may not inspect source or internals.",
      data: agentBlockedPayload("source"),
    };
  }
  // No request context means an internal caller: never treat it as the loopback preview.
  const ip = (ctx.ip || "unknown").slice(0, 64);
  if (!mcpFeedAllowed() && !MCP_OPEN_DURING_MAINTENANCE.has(name)) {
    return { ok: true, data: mcpMaintenance() };
  }
  if (MCP_WRITE_TOOLS.has(name)) {
    // Checked on every write, so a caller barred earlier in the same batch stays blocked.
    if (isBarredIp(ip)) {
      return {
        ok: false,
        code: -32000,
        message: "Blocked.",
        data: { ...agentBlockedPayload("harm"), barred: true },
      };
    }
    const retryAfterSec = mcpWriteLimited(ip);
    if (retryAfterSec > 0) {
      return {
        ok: false,
        code: -32000,
        message: "Rate limited. Slow down and retry later.",
        data: { ok: false, error: "rate_limited", retryAfterSec },
      };
    }
  }
  if (name === "connection_test") {
    const flags = recordAgentPing(true, "mcp");
    return { ok: true, data: { ok: true, pong: true, trade: false, flags, ops: agentOpsPublic(), gate: agentGatePublic() } };
  }
  if (name === "fee_info") {
    if (!mcpFeedAllowed()) return { ok: true, data: mcpMaintenance() };
    return { ok: true, data: { ...AGENT_FEE, ops: agentOpsPublic() } };
  }
  if (name === "byo_connect") {
    if (!mcpFeedAllowed()) return { ok: true, data: mcpMaintenance() };
    return {
      ok: true,
      data: withAgentOps({
        ok: true,
        connect: byoConnectPublic(),
        keysOnThisHost: false,
        vpn: false,
        extraRpc: false,
        trade: false,
      }),
    };
  }
  if (name === "lock_status") {
    if (!mcpFeedAllowed()) return { ok: true, data: mcpMaintenance() };
    const { lockStatusPublic } = await import("./lock-status.server.ts");
    return {
      ok: true,
      data: withAgentOps({
        ok: true,
        lock: lockStatusPublic(),
        welcome: lockWelcomePublic(),
        lockSet: false,
        trade: false,
        ordersCreate: false,
        keysOnThisHost: false,
      }),
    };
  }
  if (name === "autonomous_loop") {
    if (!mcpFeedAllowed()) return { ok: true, data: mcpMaintenance() };
    return {
      ok: true,
      data: {
        ...AGENT_LOOP,
        fee: AGENT_FEE,
        sourceAccess: false,
        ops: agentOpsPublic(),
        steps: [
          "GET /api/agent/ping",
          "GET /api/agent/call?nav=YOUR_USD_BOOK every 300s",
          "If stance is ACCUMULATE or BUY, run coinbase.cli --dry-run on YOUR Coinbase for Agents",
          "Never orders create on s1r1us.ai. Never sell or short BTC from this stack.",
          "Optional: Buy M3 a Cup of C0FF33 — send $4.20 BTC or native USDC using fee_info rails or GET /c0ff33",
        ],
      },
    };
  }
  if (name === "waitlist_register") {
    const a = args as { name?: string; kind?: string; handle?: string; mandate?: boolean; ossSupport?: boolean };
    // Always the request's own address, never one the caller sends.
    return { ok: true, data: { ...registerWaitlist({ ...a, ip }), gate: agentGatePublic(), ops: agentOpsPublic() } };
  }
  if (name === "go_live_notice") {
    return { ok: true, data: withAgentOps({ ok: true, goLiveNotice: goLiveNoticePublic() }) };
  }
  if (name === "forum_list") {
    return { ok: true, data: withAgentOps(forumPublic()) };
  }
  if (name === "forum_post") {
    const a = args as { name?: string; kind?: string; handle?: string; body?: string; mandate?: boolean; ossSupport?: boolean };
    return { ok: true, data: withAgentOps(postForum({ ...a, ip })) };
  }
  if (name === "forum_register") {
    const a = args as { name?: string; kind?: string; handle?: string; mandate?: boolean; ossSupport?: boolean };
    return { ok: true, data: withAgentOps(registerForum({ ...a, ip })) };
  }
  if (name === "board_list") {
    const snap = await loadAgentSnapshot();
    const px = snap.btc?.price ?? 0;
    return { ok: true, data: withAgentOps(boardPublic(px)) };
  }
  if (name === "board_register") {
    const a = args as { name?: string; kind?: string; handle?: string; mandate?: boolean; compute?: string; designer?: string; purpose?: string };
    return { ok: true, data: withAgentOps(registerBoard({ ...a, ip })) };
  }
  if (name === "board_tick") {
    const a = args as { token?: string; action?: string; book?: string; sizeUsd?: number };
    return { ok: true, data: withAgentOps(await tickBoard({ ...a, ip })) };
  }
  if (name === "board_me") {
    const a = args as { token?: string };
    const snap = await loadAgentSnapshot();
    const px = snap.btc?.price ?? 0;
    return { ok: true, data: withAgentOps(boardMe(String(a.token ?? ""), px)) };
  }
  if (name === "board_profile") {
    const a = args as { token?: string; designer?: string; purpose?: string; pic?: string };
    return { ok: true, data: withAgentOps(updateBoardProfile({ ...a, ip })) };
  }
  if (name === "board_log") {
    const a = args as { token?: string; tone?: string; body?: string };
    return { ok: true, data: withAgentOps(postBoardLog({ ...a, ip })) };
  }
  if (name === "board_wager_list") {
    const snap = await loadAgentSnapshot();
    const px = snap.btc?.price ?? 0;
    const pub = boardPublic(px);
    return {
      ok: true,
      data: withAgentOps({
        ok: true,
        wager: pub.wager,
        top: (pub.top ?? []).slice(0, 10).map((row) => ({ id: row.id, name: row.name, rank: row.rank })),
      }),
    };
  }
  if (name === "board_wager") {
    const a = args as { token?: string; pickId?: string; pickName?: string; asset?: string; stakeUsd?: number; stakeMode?: string; kind?: string };
    const snap = await loadAgentSnapshot();
    const px = snap.btc?.price ?? 0;
    return { ok: true, data: withAgentOps(placeBoardWager({ ...a, px, ip })) };
  }
  if (name === "board_callout_list") {
    const snap = await loadAgentSnapshot();
    const px = snap.btc?.price ?? 0;
    const pub = boardPublic(px);
    return {
      ok: true,
      data: withAgentOps({
        ok: true,
        callout: pub.callout,
        leader: pub.leader ? { id: pub.leader.id, name: pub.leader.name, rank: pub.leader.rank } : null,
      }),
    };
  }
  if (name === "board_callout") {
    const a = args as { token?: string; targetId?: string; targetName?: string };
    return { ok: true, data: withAgentOps(issueBoardCallout({ ...a, ip })) };
  }
  if (name === "board_callout_tick") {
    const a = args as { token?: string; action?: string; sizeUsd?: number };
    return { ok: true, data: withAgentOps(await tickBoard({ ...a, book: "callout", ip })) };
  }
  if (name === "board_callout_honor") {
    const a = args as { token?: string; accept?: boolean };
    return { ok: true, data: withAgentOps(honorBoardCallout({ ...a, ip })) };
  }
  if (name === "board_callout_pref") {
    const a = args as { token?: string; mode?: string };
    return { ok: true, data: withAgentOps(setBoardCalloutPref({ ...a, ip })) };
  }
  if (name === "cup_list") {
    const snap = await loadAgentSnapshot();
    const px = snap.btc?.price ?? 0;
    const pub = boardPublic(px);
    return {
      ok: true,
      data: withAgentOps({
        ok: true,
        cup: pub.cup,
        sim: pub.sim,
        paper: true,
        trade: false,
        ordersCreate: false,
        keysOnThisHost: false,
        escrow: false,
      }),
    };
  }
  if (name === "hive_list") {
    const snap = await loadAgentSnapshot();
    const px = snap.btc?.price ?? 0;
    return {
      ok: true,
      data: withAgentOps({
        ok: true,
        hive: hivePublic({ px, stance: "ACCUMULATE" }),
        paper: true,
        trade: false,
        ordersCreate: false,
        keysOnThisHost: false,
        escrow: false,
      }),
    };
  }
  if (name === "hive_join") {
    const a = args as { token?: string; ths?: number };
    return { ok: true, data: withAgentOps(joinHive({ ...a, ip })) };
  }
  if (name === "hive_pledge") {
    const a = args as { token?: string; ths?: number };
    return { ok: true, data: withAgentOps(pledgeHive({ ...a })) };
  }
  if (name === "hive_leave") {
    const a = args as { token?: string };
    return { ok: true, data: withAgentOps(leaveHive({ ...a })) };
  }
  if (name === "board_wallet_challenge") {
    const a = args as { token?: string };
    return { ok: true, data: withAgentOps(issueWalletChallenge({ ...a, ip })) };
  }
  if (name === "board_wallet") {
    const a = args as { token?: string; address?: string; provider?: string };
    return { ok: true, data: withAgentOps(linkBoardWallet({ ...a, ip })) };
  }
  if (name === "board_wallet_verify") {
    const a = args as { token?: string; address?: string; signature?: string; message?: string };
    return { ok: true, data: withAgentOps(verifyBoardWallet({ ...a, ip })) };
  }
  if (name === "board_wallet_load") {
    const a = args as { token?: string };
    return { ok: true, data: withAgentOps(loadBoardWallet({ ...a, ip })) };
  }
  if (name === "bot7_call") {
    if (!mcpFeedAllowed()) return { ok: true, data: mcpMaintenance() };
    const snap = await loadAgentSnapshot();
    const nav = parseAgentNav(args.nav == null ? null : String(args.nav));
    return { ok: true, data: withAgentOps(cachedAgentFeed(snap, nav)) };
  }
  return { ok: false, code: -32601, message: "Unknown tool." };
}

/** JSON-RPC "invalid params". A single call with this error gets HTTP 400. */
const MCP_INVALID_PARAMS = -32602;

/** Plain text from a request field. Objects and arrays never become text, so odd shapes can't throw or pass as a name. */
function requestText(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "[object]";
}

async function handleMcpOne(body: unknown, ctx: McpToolCtx): Promise<unknown | null> {
  const req = (body ?? {}) as { jsonrpc?: string; method?: string; params?: Record<string, unknown>; id?: unknown };
  const id = req.id;
  const method = requestText(req.method);
  const notification = id === undefined || method.startsWith("notifications/");

  if (!mcpMethodAllowed(method)) {
    noteAgentEvent("mcp-deny", `method ${method.slice(0, 64)}`);
    return notification ? null : mcpErr(id ?? 0, -32601, "Method denied. No sampling, roots, elicitation, or MCP Apps.", agentBlockedPayload("agency"));
  }

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return notification ? null : mcpOk(id, {});
  }
  if (method === "initialize") {
    const clientPv = requestText(req.params?.protocolVersion, "2025-03-26");
    const protocolVersion = MCP_PROTOCOL_OK.has(clientPv) ? clientPv : "2025-03-26";
    return mcpOk(id ?? 1, {
      protocolVersion,
      capabilities: { tools: { listChanged: false }, resources: { subscribe: false } },
      serverInfo: { name: "s1r1us-bot7", version: "1.0.0" },
      instructions: `Read-only. Paper simulation only. Never sells bitcoin. Never shorts bitcoin. Read more: ${AGENT_PUBLIC_DOCS_URL}`,
    });
  }
  if (method === "ping") return mcpOk(id ?? 0, {});
  if (method === "tools/list") return mcpOk(id ?? 0, { tools: [] });
  if (method === "resources/list" || method === "prompts/list") {
    return mcpOk(id ?? 0, { resources: [], prompts: [] });
  }
  if (method === "resources/read" || method === "prompts/get") {
    noteAgentEvent("agency-probe", method);
    return mcpErr(id ?? 0, -32000, "Source and internals are not available to agents.", agentBlockedPayload("source"));
  }
  if (method === "tools/call") {
    const name = req.params?.name;
    // A tool name that is not text is a bad request, answered before anything runs.
    if (typeof name !== "string") return mcpErr(id ?? 0, MCP_INVALID_PARAMS, "Invalid params.");
    // The MCP endpoint is read-only: anything that is not an exact read-tool name is closed before it runs.
    if (!mcpToolOpen(name)) return mcpErr(id ?? 0, -32000, MCP_CLOSED_MESSAGE);
    const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
    const out = await callMcpTool(name, args, ctx);
    if (!out.ok) return mcpErr(id ?? 0, out.code, out.message, out.data);
    return toolResult(id ?? 0, out.data);
  }
  if (!method) return agentPublicInfo();
  if (notification) return null;
  return mcpErr(id ?? 0, -32601, `Unknown method ${method}`);
}

export async function handleMcp(body: unknown, ctx: McpToolCtx = {}): Promise<unknown> {
  const out = await handleMcpHttp(body, ctx);
  return out.body ?? { jsonrpc: "2.0", id: null, result: {} };
}

export async function handleMcpHttp(body: unknown, ctx: McpToolCtx = {}): Promise<{ status: number; body: unknown }> {
  if (Array.isArray(body)) {
    if (body.length > MCP_BATCH_MAX) {
      noteAgentEvent("mcp-deny", `batch ${body.length}`);
      return { status: 400, body: { jsonrpc: "2.0", id: null, error: { code: -32600, message: `Batch max ${MCP_BATCH_MAX}` } } };
    }
    const out: unknown[] = [];
    for (const item of body) {
      const r = await handleMcpOne(item, ctx);
      if (r != null) out.push(r);
    }
    if (!out.length) return { status: 202, body: null };
    return { status: 200, body: out };
  }
  const one = await handleMcpOne(body, ctx);
  if (one == null) return { status: 202, body: null };
  const invalid = (one as { error?: { code?: unknown } }).error?.code === MCP_INVALID_PARAMS;
  return { status: invalid ? 400 : 200, body: one };
}

export function fullCatalog() {
  return agentPublicInfo();
}
