import { createFileRoute } from "@tanstack/react-router";
import { F33dPage } from "@/components/f33d-page";
import { PAGE_DESC_FEED, PAGE_TITLE_FEED, SEO_KEYWORDS, canonicalUrl } from "@/lib/brand";

export const Route = createFileRoute("/f33d")({
  component: F33dPage,
  head: () => ({
    meta: [
      { title: PAGE_TITLE_FEED },
      { name: "description", content: PAGE_DESC_FEED },
      { name: "keywords", content: SEO_KEYWORDS },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/f33d") }],
  }),
});
