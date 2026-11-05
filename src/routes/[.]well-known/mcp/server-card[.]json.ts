import { createFileRoute } from "@tanstack/react-router";
import { agentCorsHeaders, agentJson } from "@/lib/desk/agent-feed";
import { withAgentLimit } from "@/lib/desk/agent-limit";
import { mcpServerCard } from "@/lib/desk/agent-discovery";

export const Route = createFileRoute("/.well-known/mcp/server-card.json")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: agentCorsHeaders() }),
      GET: ({ request }) => withAgentLimit(request, () => agentJson(mcpServerCard())),
    },
  },
});
