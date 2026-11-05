// /launch was removed from the public build: no route file and no generated route, so it falls
// through to the 404 page. The sign-in and admin pages keep their noindex robots meta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("/launch is gone from the routes, and /login and /admin stay noindex,nofollow", () => {
  assert.equal(existsSync(new URL("../src/routes/launch.tsx", import.meta.url)), false);
  const tree = read("src/routeTree.gen.ts");
  assert.doesNotMatch(tree, /'\/launch'/);
  assert.doesNotMatch(tree, /routes\/launch'/);
  assert.doesNotMatch(read("src/components/launch-desk.tsx"), /export function LaunchPage\b/);
  for (const p of ["src/routes/login.tsx", "src/routes/admin.tsx"]) {
    assert.match(read(p), /\{ name: "robots", content: "noindex,nofollow" \}/, `${p} pattern`);
  }
});
