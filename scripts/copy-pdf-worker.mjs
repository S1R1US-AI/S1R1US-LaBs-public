#!/usr/bin/env node
// Copy the pdf.js worker from the locked pdfjs-dist package into public/
// at build time, so the minified third-party file is not committed.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const src = join(dirname(require.resolve("pdfjs-dist/package.json")), "build", "pdf.worker.min.mjs");
const dest = join(root, "public", "pdf.worker.min.mjs");
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("copy-pdf-worker: public/pdf.worker.min.mjs");
