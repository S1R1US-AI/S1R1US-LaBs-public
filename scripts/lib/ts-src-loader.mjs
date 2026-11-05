// Test-only resolve hook: maps "@/x" to src/x and adds a missing ".ts"/".tsx" extension,
// so node --test can import TypeScript source files that use the app's path alias.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function withExt(p) {
  for (const c of [p, `${p}.ts`, `${p}.tsx`, join(p, "index.ts")]) if (existsSync(c)) return c;
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const hit = withExt(join(SRC, specifier.slice(2)));
    if (hit) return next(pathToFileURL(hit).href, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const base = dirname(fileURLToPath(context.parentURL));
    const p = join(base, specifier);
    if (!existsSync(p) || !/\.[cm]?[jt]sx?$/.test(p)) {
      const hit = withExt(p);
      if (hit) return next(pathToFileURL(hit).href, context);
    }
  }
  return next(specifier, context);
}
