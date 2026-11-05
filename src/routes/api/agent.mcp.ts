import { createFileRoute } from "@tanstack/react-router";
import { agentCorsHeaders, agentJson } from "@/lib/desk/agent-feed";
import { withAgentLimit } from "@/lib/desk/agent-limit";
import { agentPublicInfo } from "@/lib/desk/agent-public-info";
import { handleMcpHttp } from "@/lib/desk/agent-protocol";
import { readAgentJson } from "@/lib/desk/agent-security";
import { trustedRequestIp } from "@/lib/desk/client-ip";

function mcpResponse(status: number, body: unknown, accept: string): Response {
  const headers = agentCorsHeaders({ "content-type": "application/json; charset=utf-8" });
  if (status === 202 && body == null) {
    return new Response(null, { status: 202, headers });
  }
  const json = JSON.stringify(body);
  if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
    headers.set("content-type", "text/event-stream");
    return new Response(`event: message\ndata: ${json}\n\n`, { status, headers });
  }
  return new Response(json, { status, headers });
}

export const Route = createFileRoute("/api/agent/mcp")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: agentCorsHeaders() }),
      GET: ({ request }) =>
        withAgentLimit(request, () => {
        const accept = request.headers.get("accept") ?? "";
        if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
          return new Response(null, { status: 405, headers: agentCorsHeaders() });
        }
        return agentJson(agentPublicInfo());
      }),
      POST: async ({ request }) =>
        withAgentLimit(request, async () => {
        const parsed = await readAgentJson(request);
        if (!parsed.ok) {
          const code = parsed.status === 413 ? -32600 : -32700;
          return agentJson({ jsonrpc: "2.0", id: null, error: { code, message: parsed.error } }, parsed.status);
        }
        const out = await handleMcpHttp(parsed.body, { ip: trustedRequestIp(request) });
        return mcpResponse(out.status, out.body, request.headers.get("accept") ?? "");
      }),
      DELETE: () => new Response(null, { status: 405, headers: agentCorsHeaders() }),
    },
  },
});
