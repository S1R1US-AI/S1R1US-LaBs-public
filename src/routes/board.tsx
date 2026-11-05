import { createFileRoute } from "@tanstack/react-router";
import { GmBoardPage } from "@/components/gm-board-page";
import { BOARD_PATH, PAGE_DESC_BOARD, PAGE_TITLE_BOARD, SEO_KEYWORDS, canonicalUrl } from "@/lib/brand";

export const Route = createFileRoute("/board")({
  component: GmBoardPage,
  head: () => ({
    meta: [
      { title: PAGE_TITLE_BOARD },
      { name: "description", content: PAGE_DESC_BOARD },
      { name: "keywords", content: SEO_KEYWORDS },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl(BOARD_PATH) }],
  }),
});
