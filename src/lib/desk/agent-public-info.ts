/** The short public reply for AI assistants that ask what this site offers. Client-safe.
 * Name, a read-only status, the FAQ link, and the plain mandate. Nothing else.
 */
import { APP_NAME, SEO_CANONICAL } from "../brand.ts";

const origin = SEO_CANONICAL.replace(/\/$/, "");

export const AGENT_PUBLIC_DOCS_URL = `${origin}/faq/`;

export function agentPublicInfo() {
  return {
    name: APP_NAME,
    status: "read-only" as const,
    docs: AGENT_PUBLIC_DOCS_URL,
    mandate: "Paper simulation only. Never sells bitcoin. Never shorts bitcoin.",
  };
}
