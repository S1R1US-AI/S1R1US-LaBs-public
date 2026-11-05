/**
 * Nitro: add the safe HTTP security headers (sec-headers.ts) to every response.
 * Filename prefix keeps it first, before grok-pwa and home-apex.
 */
interface HeaderEvent {
  url: URL;
  req: { method: string; headers: Headers };
}

export default async function securityHeadersMiddleware(
  event: HeaderEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const { withSecHeaders } = await import("../../src/lib/desk/sec-headers");
  const https = event.url.protocol === "https:" || event.req.headers.get("x-forwarded-proto") === "https";
  const out = await next();
  if (out instanceof Response) return withSecHeaders(out, https);
  return out;
}
