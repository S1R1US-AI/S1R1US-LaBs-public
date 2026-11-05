// Guards the final sitemap URLs: slash locs that exist as indexable static pages, map-only lastmod dates,
// no image title/caption tails, one /media/ entry in the video sitemap, and slash canonicals that match og:url.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

register(new URL("./lib/ts-src-loader.mjs", import.meta.url));

const ORIGIN = "https://s1r1us.ai";
const root = fileURLToPath(new URL("../", import.meta.url));
const staticRoot = `${root}front-door-static`;
const nav = await import(new URL("../src/lib/desk/public-nav.ts", import.meta.url).href);
const video = await import(new URL("../src/routes/video-sitemap[.]xml.ts", import.meta.url).href);

const staticFile = (loc) => {
  const path = loc.slice(ORIGIN.length);
  return path === "/" ? `${staticRoot}/index.html` : `${staticRoot}${path}index.html`;
};
const urls = (xml) =>
  [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    body: m[1],
    loc: m[1].match(/<loc>([^<]*)<\/loc>/)?.[1],
    lastmod: m[1].match(/<lastmod>([^<]*)<\/lastmod>/)?.[1],
  }));

test("sitemap locs are unique slash URLs that exist as indexable static pages", () => {
  const list = urls(nav.sitemapXml());
  assert.ok(list.length > 0);
  const locs = list.map((u) => u.loc);
  assert.equal(new Set(locs).size, locs.length, "duplicate loc");
  for (const loc of locs) {
    assert.ok(loc.startsWith(`${ORIGIN}/`) && loc.endsWith("/"), `${loc} not a slash URL`);
    assert.ok(!loc.includes("#"), `${loc} has a fragment`);
    const f = staticFile(loc);
    assert.ok(existsSync(f), `${loc} has no static page`);
    const robots = readFileSync(f, "utf8").match(/<meta name="robots" content="([^"]*)"/)?.[1] ?? "";
    assert.doesNotMatch(robots, /noindex/i, `${loc} is noindex`);
  }
});

test("every sitemap lastmod comes from the page map, never the old 2026-09-12 default", () => {
  for (const u of urls(nav.sitemapXml())) {
    assert.ok(u.lastmod, `${u.loc} has no lastmod`);
    assert.equal(u.lastmod, nav.SITEMAP_PAGE_LASTMOD[u.loc], `${u.loc} lastmod not from the map`);
    assert.notEqual(u.lastmod, "2026-09-12", `${u.loc} old default date`);
  }
});

test("sitemap image entries carry no image:title or image:caption", () => {
  assert.doesNotMatch(nav.sitemapXml(), /<image:title>|<image:caption>/);
});

test("video sitemap lists one /media/ URL holding all 4 videos, none from the removed cost pack", async () => {
  const xml = await video.Route.options.server.handlers.GET().text();
  const list = urls(xml);
  assert.equal(list.length, 1);
  assert.equal(list[0].loc, `${ORIGIN}/media/`);
  assert.equal((list[0].body.match(/<video:video>/g) ?? []).length, 4);
  assert.doesNotMatch(xml, /cost/i);
});

test("every static page: canonical === og:url === its slash URL", () => {
  const pages = [["", `${staticRoot}/index.html`]];
  for (const d of readdirSync(staticRoot, { withFileTypes: true })) {
    if (d.isDirectory() && existsSync(`${staticRoot}/${d.name}/index.html`)) pages.push([d.name, `${staticRoot}/${d.name}/index.html`]);
  }
  for (const [dir, f] of pages) {
    const h = readFileSync(f, "utf8");
    const want = dir ? `${ORIGIN}/${dir}/` : `${ORIGIN}/`;
    assert.equal(h.match(/<link rel="canonical" href="([^"]*)"/)?.[1], want, `${dir || "home"} canonical`);
    assert.equal(h.match(/<meta property="og:url" content="([^"]*)"/)?.[1], want, `${dir || "home"} og:url`);
  }
});
