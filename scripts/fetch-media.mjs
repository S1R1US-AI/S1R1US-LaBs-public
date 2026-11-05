#!/usr/bin/env node
// Fetch large media that is not committed to git from the public CDN.
// Reads scripts/media-manifest.tsv (path, size, sha256), downloads each file
// that is missing or does not match into its repo path, and verifies the
// sha256. Fails on any mismatch or missing file. No credentials needed.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDN = "https://s1r1us-media.nyc3.cdn.digitaloceanspaces.com/";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "scripts", "media-manifest.tsv");
const TIMEOUT_MS = 60_000;
const ATTEMPTS = 2;
const CONCURRENCY = 6;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function cdnKey(path) {
  const key = path.replace(/^(front-door-static|public)\//, "");
  return key.split("/").map(encodeURIComponent).join("/");
}

async function readManifest() {
  const rows = [];
  for (const line of (await readFile(MANIFEST, "utf8")).split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [path, size, hash] = line.split("\t");
    if (!path || path.includes("..") || !/^\d+$/.test(size) || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error(`bad manifest line: ${line}`);
    }
    rows.push({ path, size: Number(size), hash });
  }
  return rows;
}

async function isCurrent({ path, size, hash }) {
  try {
    const buf = await readFile(join(ROOT, path));
    return buf.length === size && sha256(buf) === hash;
  } catch {
    return false;
  }
}

async function download(entry) {
  const url = CDN + cdnKey(entry.path);
  let last;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length !== entry.size) throw new Error(`size ${buf.length} != ${entry.size}`);
      if (sha256(buf) !== entry.hash) throw new Error("sha256 mismatch");
      const dest = join(ROOT, entry.path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(`${dest}.part`, buf);
      await rename(`${dest}.part`, dest);
      return;
    } catch (err) {
      last = err;
    }
  }
  throw new Error(`${entry.path}: ${last?.message ?? last}`);
}

const entries = await readManifest();
const todo = [];
for (const e of entries) if (!(await isCurrent(e))) todo.push(e);

const failures = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
    while (next < todo.length) {
      const e = todo[next++];
      try {
        await download(e);
      } catch (err) {
        failures.push(err.message);
      }
    }
  }),
);

if (failures.length) {
  console.error(`fetch-media: ${failures.length} of ${entries.length} failed`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`fetch-media: ${entries.length} files verified (${todo.length} downloaded)`);
