/**
 * The MCP endpoint answers read tools only. This list is the whole allowlist:
 * any tool not named here, including tools added later, gets the closed reply.
 * There is no setting, file, header or date that opens it. Opening a write
 * tool here is a reviewed code change.
 *
 * Only the MCP endpoint uses this. The app gateway that the site's own pages
 * use is not changed.
 */
const READ_TOOLS: ReadonlySet<string> = new Set([
  "bot7_call",
  "connection_test",
  "fee_info",
  "byo_connect",
  "lock_status",
  "autonomous_loop",
  "go_live_notice",
  "forum_list",
  "board_list",
  "board_me",
  "board_wager_list",
  "board_callout_list",
  "cup_list",
  "hive_list",
]);

/** The one closed reply, kept here so the wording is changed in one place. One plain line. No tool, route or method names. */
export const MCP_CLOSED_MESSAGE = "This is read-only for now.";

/** The read tools the MCP endpoint answers, sorted. */
export const MCP_READ_TOOLS: readonly string[] = Object.freeze([...READ_TOOLS].sort());

/** True only for an exact read-tool name. Everything else is closed. */
export function mcpToolOpen(name: unknown): name is string {
  return typeof name === "string" && READ_TOOLS.has(name);
}
