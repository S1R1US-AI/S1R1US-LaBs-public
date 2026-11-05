/**
 * Agent write switch. Runs before every route handler, so a blocked write is
 * answered before any auth header, token or body is read.
 * See src/lib/desk/agent-write-switch.ts.
 */
import { agentWriteGate } from "../../src/lib/desk/agent-write-switch";

interface SwitchEvent {
  url: URL;
  req: { method: string };
}

export default async function agentWritesMiddleware(
  event: SwitchEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const blocked = agentWriteGate(event.req.method ?? "GET", event.url.pathname, event.url.search);
  if (blocked) return blocked;
  return next();
}
