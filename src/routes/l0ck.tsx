import { createFileRoute } from "@tanstack/react-router";
import { LockPage } from "@/components/lock-page";
import { LOCK_PATH, PAGE_DESC_LOCK, PAGE_TITLE_LOCK, SEO_KEYWORDS, canonicalUrl } from "@/lib/brand";

export const Route = createFileRoute("/l0ck")({
  component: LockPage,
  head: () => ({
    meta: [
      { title: PAGE_TITLE_LOCK },
      { name: "description", content: PAGE_DESC_LOCK },
      { name: "keywords", content: SEO_KEYWORDS },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl(LOCK_PATH) }],
  }),
});
