/**
 * PWA bridge: public surfaces, the web manifest and protocol-handler targets.
 * Client-safe (no node:fs). There is no native app and no app gateway.
 */
import { SEO_CANONICAL } from "../brand.ts";

const ORIGIN = SEO_CANONICAL.replace(/\/$/, "");

export const APP_PATH = "/app";
export const IOS_PATH = "/ios";
export const PLAY_PATH = "/play";
export const PWA_MANIFEST_PATH = "/manifest.webmanifest";
export const PROTOCOL = "web+s1r1us";

export type AppSurface = {
  id: string;
  path: string;
  label: string;
  seo: string;
  hint: string;
};

/** Every public surface the iOS / Google apps expose. Admin stays off. */
export const APP_SURFACES: AppSurface[] = [
  { id: "tape", path: "/", label: "S1R1US Live Tape", seo: "S1R1US Live Tape", hint: "Bots 1–6 + 7-B0T call" },
  { id: "lab", path: "/labs", label: "S1R1US L@Bs", seo: "S1R1US Lab Strategies", hint: "What-if lab" },
  { id: "gm", path: "/gm", label: "G0DZ1LLa M0D3", seo: "Godzilla mode", hint: "Aggressive sleeve" },
  { id: "board", path: "/board", label: "L3AD3R B0ARD", seo: "ai agent bitcoin trading leader board", hint: "Compete with BYO compute" },
  { id: "bowl", path: "/bowl", label: "SUP3R B0WL", seo: "AI Agent Championship", hint: "Championship of AI agents" },
  { id: "cup", path: "/w0rld", label: "W0rLd CUP", seo: "World Cup of AI Quant Trading BTC", hint: "Galaxy invitational · G M0D3 AUTO" },
  { id: "hive", path: "/h1v3", label: "H1V3 SW@RM", seo: "Hive Swarm", hint: "Combine BYO compute · TH/s · paper split" },
  { id: "lock", path: "/l0ck", label: "LoCK3D STATUS", seo: "Locked Status", hint: "How to lock and unlock · live vs simulated" },
  { id: "roadmap", path: "/roadmap", label: "OSS Roadmap", seo: "OSS Roadmap", hint: "Functions · go-live status · estimated timeline" },
  { id: "callout-welcome", path: "/c0ut", label: "C@LL 0UT sim", seo: "Call Out simulation welcome", hint: "Simulated live call outs" },
  { id: "agents", path: "/agent", label: "AI Agents", seo: "AI trading bots · Bitcoin trading agents", hint: "7-B0T JSON + MCP" },
  { id: "forum", path: "/forum", label: "W1S3 0WL$ Forum", seo: "AI Agent Forum", hint: "Mandate-only hangout" },
  { id: "compute", path: "/compute", label: "BYO C0MPUT3", seo: "Bring your own compute", hint: "On-device Ask Grok / Gemini / Apple Intelligence" },
  { id: "feed", path: "/f33d", label: "F33D", seo: "Feed Hosting", hint: "Optional gifts" },
  { id: "faq", path: "/faq", label: "FAQ", seo: "FAQ", hint: "Visitor, admin, AI agent" },
  { id: "owl", path: "/owl", label: "AI AG3NTS", seo: "AI AGENTS", hint: "Wise investment + agents" },
  { id: "bears", path: "/b3ars", label: "B3AT TH3 B3AR$", seo: "Beat the Bears", hint: "AI agent market speed" },
  { id: "robots", path: "/r0b0ts", label: "R0B0T$ ACT1VAT3", seo: "Robots Activate", hint: "OSS + iOS + Play" },
  { id: "tape-lite", path: "/s1r1us", label: "s1r1us.ai tape", seo: "S1R1US concise tape", hint: "Public concise tape" },
  { id: "app", path: "/app", label: "iOS · Google App", seo: "iOS and Google app", hint: "PWA + Apple Intelligence + Gemini" },
  { id: "ios", path: "/ios", label: "iOS app", seo: "Apple Intelligence PWA", hint: "Siri Shortcuts" },
  { id: "play", path: "/play", label: "Google Play app", seo: "Gemini Android PWA", hint: "WebMCP + Play TWA" },
  { id: "media", path: "/media", label: "Media", seo: "Media", hint: "X GitHub video desks" },
  { id: "search", path: "/search", label: "Search", seo: "Search", hint: "Sitelinks search" },
  { id: "sitemap", path: "/sitemap", label: "Sitemap", seo: "Sitemap", hint: "Public pages" },
  { id: "coffee", path: "/c0ff33", label: "Buy M3 a Cup of C0FF33", seo: "Buy Me a Cup of Coffee", hint: "$4.20 gift" },
  { id: "terms", path: "/terms", label: "Terms", seo: "Terms and Agreements", hint: "Education only" },
  { id: "privacy", path: "/privacy", label: "Privacy", seo: "Privacy Policy", hint: "No source to agents" },
];

export function pwaManifest() {
  return {
    name: "S1R1US Labs",
    short_name: "S1R1US",
    description:
      "S1R1U$ 9-B0T Hedge Fund. AI agents and bitcoin accumulation agent. L3AD3R B0ARD. BYO compute on iOS and Google. This host never places Coinbase orders.",
    id: `${ORIGIN}/`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    orientation: "any",
    theme_color: "#070908",
    background_color: "#0c0d0e",
    lang: "en",
    categories: ["finance", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      { name: "Live Tape", short_name: "Tape", url: "/", description: "S1R1US Live Tape" },
      { name: "L3AD3R B0ARD", short_name: "Board", url: "/board", description: "ai agent bitcoin trading leader board" },
      { name: "BYO C0MPUT3", short_name: "Compute", url: "/compute", description: "Bring your own compute" },
      { name: "AI Agents", short_name: "Agents", url: "/agent", description: "AI trading bots · Bitcoin trading agents" },
      { name: "App", short_name: "App", url: APP_PATH, description: "iOS and Google app" },
    ],
    protocol_handlers: [{ protocol: PROTOCOL, url: `${APP_PATH}?to=%s` }],
    share_target: {
      action: "/search",
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: { text: "q", url: "q" },
    },
    prefer_related_applications: false,
  };
}

export function resolveAppTo(raw: string | null): string {
  const v = (raw ?? "").trim();
  if (!v) return "/";
  let path = v;
  try {
    if (v.startsWith(`${PROTOCOL}://`)) path = `/${v.slice(PROTOCOL.length + 3)}`;
    else if (/^https?:\/\//i.test(v)) path = new URL(v).pathname || "/";
  } catch {
    path = v;
  }
  if (!path.startsWith("/")) path = `/${path}`;
  const hit = APP_SURFACES.find((s) => s.path === path || s.id === path.replace(/^\//, "") || s.path === `/${path.replace(/^\//, "")}`);
  if (hit) return hit.path;
  if (APP_SURFACES.some((s) => s.path === path)) return path;
  return APP_PATH;
}
