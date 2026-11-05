// Meet Shiva logo rings: Pause / Play button (WCAG 2.2.2) and reduced motion.
// Runs front-door-static/js/shiva-rings.js in a small fake DOM (node:vm), no browser needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("../front-door-static/js/shiva-rings.js", import.meta.url), "utf8");

class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.children = []; this.parentNode = null; this.listeners = {}; this.style = {}; this.hidden = false; this.offsetWidth = 32; this.classList = { set: new Set(), add: (c) => this.classList.set.add(c), contains: (c) => this.classList.set.has(c) }; }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  set className(v) { this.attrs.set("class", v); String(v).split(/\s+/).forEach((c) => this.classList.add(c)); }
  get className() { return this.getAttribute("class"); }
  get nextSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  closest(sel) { return sel === "a" && this.tagName === "A" ? this : this.parentNode && this.parentNode.closest ? this.parentNode.closest(sel) : null; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  click() { (this.listeners.click || []).forEach((f) => f({ type: "click", target: this, preventDefault() {}, stopPropagation() {} })); }
  getBoundingClientRect() { return this.tagName === "A" ? { left: 20, top: 0, right: 220, bottom: 200 } : { left: 0, top: 0, right: 240, bottom: 260 }; }
}

function setup({ reduced = false, rings = true } = {}) {
  const host = new El("div");
  const link = new El("a"); host.appendChild(link);
  const r = new El("span"); if (rings) link.appendChild(r);
  const h3 = new El("h3"); host.appendChild(h3);
  let mqListener = null; const mq = { matches: reduced, addEventListener: (_t, f) => { mqListener = f; } };
  const doc = { createElement: (t) => new El(t), querySelector: () => (rings ? r : null) };
  const win = { matchMedia: () => mq, addEventListener() {} };
  vm.runInNewContext(code, { window: win, document: doc });
  return { host, link, rings: r, btn: link.nextSibling, setReduced: (on) => { mq.matches = on; if (mqListener) mqListener(); } };
}

test("rings play with a Pause button next to the link, not inside it", () => {
  const { host, link, rings, btn } = setup();
  assert.equal(btn.tagName, "BUTTON");
  assert.equal(btn.parentNode, host);
  assert.ok(!link.children.includes(btn));
  assert.equal(btn.type, "button");
  assert.equal(btn.className, "s1-loop-toggle");
  assert.ok(host.classList.contains("s1-loop-host"));
  assert.equal(rings.getAttribute("data-state"), "playing");
  assert.equal(btn.getAttribute("aria-label"), "Pause animation");
  assert.equal(btn.title, "Pause animation");
  assert.equal(btn.getAttribute("aria-pressed"), "false");
  assert.equal(btn.getAttribute("data-state"), "playing");
  assert.equal(btn.hidden, false);
  assert.equal(btn.style.left, "182px"); // top-right corner of the 200px logo
  assert.equal(btn.style.top, "6px");
});

test("Pause stops all three rings and sticks; Play starts them again", () => {
  const { rings, btn, setReduced } = setup();
  btn.click();
  assert.equal(rings.getAttribute("data-state"), "paused");
  assert.equal(btn.getAttribute("aria-label"), "Play animation");
  assert.equal(btn.getAttribute("aria-pressed"), "true");
  assert.equal(btn.getAttribute("data-state"), "paused");
  setReduced(true); setReduced(false); // a motion-setting change never restarts a user pause
  assert.equal(rings.getAttribute("data-state"), "paused");
  btn.click();
  assert.equal(rings.getAttribute("data-state"), "playing");
  assert.equal(btn.getAttribute("aria-label"), "Pause animation");
  assert.equal(btn.getAttribute("aria-pressed"), "false");
});

test("reduced motion: rings stay still and the button is hidden", () => {
  const { rings, btn, setReduced } = setup({ reduced: true });
  assert.equal(rings.getAttribute("data-state"), "paused");
  assert.equal(btn.hidden, true);
  setReduced(false);
  assert.equal(rings.getAttribute("data-state"), "playing");
  assert.equal(btn.hidden, false);
});

test("no Shiva rings on the page: nothing is added", () => {
  const { host } = setup({ rings: false });
  assert.equal(host.children.length, 2);
});
