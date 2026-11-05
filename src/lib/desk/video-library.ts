/** Always-on SUP3R B0WL of AI AGENTs pack. Education only. */

export type VideoClip = {
  id: string;
  file: string;
  href: string;
  title: string;
  seo: string;
  platform: "tiktok" | "rumble";
  aspect: "9:16" | "16:9";
  durationSec: number;
  pinned: boolean;
  pack: "bowl";
  poster: string;
};

export type VideoPack = {
  id: "bowl";
  name: string;
  zip: string;
  zipName: string;
  always: boolean;
  blurb: string;
};

export const BOWL_LIBRARY_ZIP = "/video/super-bowl-ai-agents-library.zip";
export const BOWL_LIBRARY_NAME = "SUP3R B0WL of AI AGENTs (always)";

export const VIDEO_PACKS: VideoPack[] = [
  {
    id: "bowl",
    name: BOWL_LIBRARY_NAME,
    zip: BOWL_LIBRARY_ZIP,
    zipName: "super-bowl-ai-agents-library.zip",
    always: true,
    blurb:
      "Always-on marketing pack for the original S1R1US championship of AI agents. Stadium night, hologram Godzilla, original field art. TikTok 9:16 + Rumble 16:9 + stills. Not affiliated with any football league. Education only.",
  },
];

export const VIDEO_CLIPS: VideoClip[] = [
  {
    id: "bowl-rumble",
    file: "super-bowl-ai-agents-rumble.mp4",
    href: "/video/super-bowl-ai-agents-rumble.mp4",
    title: "SUP3R B0WL of AI AGENTs · Rumble stadium",
    seo: "SUP3R B0WL of AI Agents (Rumble): an original championship stadium at night with a hologram Godzilla. Paper only.",
    platform: "rumble",
    aspect: "16:9",
    durationSec: 10,
    pinned: true,
    pack: "bowl",
    poster: "/super-bowl-ai-agents-banner.jpg",
  },
  {
    id: "bowl-flyover",
    file: "super-bowl-ai-agents-flyover.mp4",
    href: "/video/super-bowl-ai-agents-flyover.mp4",
    title: "SUP3R B0WL of AI AGENTs · Rumble flyover",
    seo: "SUP3R B0WL of AI Agents flyover: bright stadium lights over an original field. Paper only.",
    platform: "rumble",
    aspect: "16:9",
    durationSec: 10,
    pinned: true,
    pack: "bowl",
    poster: "/super-bowl-ai-agents-banner.jpg",
  },
  {
    id: "bowl-tiktok",
    file: "super-bowl-ai-agents-tiktok.mp4",
    href: "/video/super-bowl-ai-agents-tiktok.mp4",
    title: "SUP3R B0WL of AI AGENTs · TikTok field",
    seo: "SUP3R B0WL of AI Agents (TikTok): a vertical stadium view with a hologram Godzilla. Paper only.",
    platform: "tiktok",
    aspect: "9:16",
    durationSec: 10,
    pinned: true,
    pack: "bowl",
    poster: "/super-bowl-ai-agents-tiktok.jpg",
  },
  {
    id: "bowl-tiktok-hud",
    file: "super-bowl-ai-agents-tiktok-hud.mp4",
    href: "/video/super-bowl-ai-agents-tiktok-hud.mp4",
    title: "SUP3R B0WL of AI AGENTs · TikTok HUD (always)",
    seo: "SUP3R B0WL of AI Agents TikTok HUD: the SUP3R B0WL scoreboard over an original championship field. Paper only.",
    platform: "tiktok",
    aspect: "9:16",
    durationSec: 10,
    pinned: true,
    pack: "bowl",
    poster: "/super-bowl-ai-agents-tiktok.jpg",
  },
];
