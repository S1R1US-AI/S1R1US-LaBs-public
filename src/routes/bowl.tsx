import { createFileRoute } from "@tanstack/react-router";
import { BowlPage } from "@/components/bowl-page";
import { BOWL_PATH, PAGE_DESC_BOWL, PAGE_TITLE_BOWL, SEO_KEYWORDS, canonicalUrl } from "@/lib/brand";

export const Route = createFileRoute("/bowl")({
  component: BowlPage,
  head: () => ({
    meta: [
      { title: PAGE_TITLE_BOWL },
      { name: "description", content: PAGE_DESC_BOWL },
      { name: "keywords", content: SEO_KEYWORDS },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl(BOWL_PATH) }],
  }),
});
