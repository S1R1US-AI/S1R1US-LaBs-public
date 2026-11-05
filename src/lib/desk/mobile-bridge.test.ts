import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { APP_SURFACES, pwaManifest, resolveAppTo } from "./mobile-bridge.ts";

describe("mobile-bridge", () => {
  it("exposes every public surface and never admin", () => {
    const paths = APP_SURFACES.map((s) => s.path);
    assert.ok(paths.includes("/"));
    assert.ok(paths.includes("/board"));
    assert.ok(paths.includes("/bowl"));
    assert.ok(paths.includes("/w0rld"));
    assert.ok(paths.includes("/c0ut"));
    assert.ok(paths.includes("/h1v3"));
    assert.ok(paths.includes("/l0ck"));
    assert.ok(paths.includes("/roadmap"));
    assert.ok(paths.includes("/compute"));
    assert.ok(paths.includes("/agent"));
    assert.ok(paths.includes("/app"));
    assert.ok(paths.includes("/ios"));
    assert.ok(paths.includes("/play"));
    assert.ok(!paths.some((p) => p.startsWith("/admin") || p.startsWith("/source")));
  });

  it("PWA shortcuts include board and compute", () => {
    const m = pwaManifest();
    const urls = m.shortcuts.map((s) => s.url);
    assert.ok(urls.includes("/board"));
    assert.ok(urls.includes("/compute"));
    assert.equal(m.prefer_related_applications, false);
  });

  it("resolves protocol handler targets", () => {
    assert.equal(resolveAppTo("board"), "/board");
    assert.equal(resolveAppTo("web+s1r1us://compute"), "/compute");
    assert.equal(resolveAppTo("/admin"), "/app");
    assert.equal(resolveAppTo("https://s1r1us.ai/forum"), "/forum");
  });
});
