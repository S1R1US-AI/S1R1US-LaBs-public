/** Agentic Resource Discovery + MCP server card. Client-safe.
 * Official 2026 surfaces:
 * - Google Search: schema.org JSON-LD only. llms.txt does not change ranking
 *   (Search Central, June 2026). Keep people-first HTML.
 * - ARD (Google + industry, 17 Jun 2026): /.well-known/ai-catalog.json
 * - MCP SEP-2127: /.well-known/mcp.json (name/version/remotes)
 * - MCP SEP-1649: /.well-known/mcp/server-card.json (serverInfo/transport)
 * Dual-compat: one card document carries both shapes.
 */
import { APP_NAME, SEO_CANONICAL } from "../brand.ts";
import { agentPublicInfo } from "./agent-public-info.ts";

const origin = SEO_CANONICAL.replace(/\/$/, "");

export const ARD_CATALOG_PATH = "/.well-known/ai-catalog.json";
export const ARD_CATALOG_ALIAS = "/ai-catalog.json";
export const MCP_CARD_PATH = "/.well-known/mcp.json";
export const MCP_CARD_ALT_PATH = "/.well-known/mcp-server.json";
export const MCP_SERVER_CARD_PATH = "/.well-known/mcp/server-card.json";
export const LLMS_PATH = "/llms.txt";
export const LLMS_WELLKNOWN_PATH = "/.well-known/llms.txt";
export const A2A_CARD_PATH = "/.well-known/agent-card.json";
export const GPT_PLUGIN_PATH = "/.well-known/ai-plugin.json";

export const INSTRUCTIONS_MODULE = {
  name: `${APP_NAME} instructions module`,
  path: LLMS_PATH,
  wellKnown: LLMS_WELLKNOWN_PATH,
  url: `${origin}${LLMS_PATH}`,
  wellKnownUrl: `${origin}${LLMS_WELLKNOWN_PATH}`,
  notGuide: true as const,
  googleSearchUsesLlmsTxt: false as const,
  googleSearchUsesSchemaOrg: true as const,
  note: "Short public note for AI assistants that points to the site FAQ.",
};

export function mcpServerCard() {
  return agentPublicInfo();
}

export function ardCatalog() {
  return agentPublicInfo();
}

export const DISCOVERY_WELCOME =
  "Start at /llms.txt (instructions module). Discover MCP at /.well-known/mcp.json, A2A at /.well-known/agent-card.json, and the Agentic Resource Discovery catalog at /.well-known/ai-catalog.json. This host never places Coinbase orders.";
