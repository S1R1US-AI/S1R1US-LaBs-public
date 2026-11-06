#!/usr/bin/env node
/**
 * Choose the CodeQL Action v4.39.3 `upload` value for this job.
 *
 * The pinned action (`github/codeql-action/analyze` @ 33d7b85) accepts
 * `always`, `failure-only`, and `never`. `true` is an alias of `always`.
 * `false` is a deprecated alias of `failure-only` (upload debugging SARIF
 * only when the run fails) and must not be passed here.
 *
 * `never` skips the code scanning upload and still fails the action when the
 * CodeQL CLI fails (`core.setFailed` on the analysis error). `always` uploads
 * and fails the action when that upload fails.
 *
 * Dependabot's token cannot upload: push runs are read-only, and pull_request
 * runs are refused by the code scanning API ("Code scanning is not enabled")
 * even with security-events: write. Actions-token pushes to the default branch
 * upload successfully, so this script never selects `never` for that ref.
 */
import { appendFileSync } from "node:fs";
import { isMainModule } from "./shared-files-guard.mjs";

export const CODEQL_UPLOAD_ALWAYS = "always";
export const CODEQL_UPLOAD_NEVER = "never";

const DEPENDABOT_ACTOR = "dependabot[bot]";

/**
 * @param {{ actor: string, ref: string, defaultBranch: string }} input
 * @returns {"always" | "never"}
 */
export function codeqlUploadMode({ actor, ref, defaultBranch }) {
  if (typeof actor !== "string" || actor.length === 0) {
    throw new Error("actor is required");
  }
  if (typeof ref !== "string" || ref.length === 0) {
    throw new Error("ref is required");
  }
  if (typeof defaultBranch !== "string" || defaultBranch.length === 0) {
    throw new Error("default branch is required");
  }
  if (ref === `refs/heads/${defaultBranch}`) return CODEQL_UPLOAD_ALWAYS;
  if (actor === DEPENDABOT_ACTOR) return CODEQL_UPLOAD_NEVER;
  return CODEQL_UPLOAD_ALWAYS;
}

function main() {
  const mode = codeqlUploadMode({
    actor: process.env.CODEQL_ACTOR,
    ref: process.env.CODEQL_REF,
    defaultBranch: process.env.CODEQL_DEFAULT_BRANCH,
  });
  const output = process.env.GITHUB_OUTPUT;
  if (!output) {
    console.error("GITHUB_OUTPUT is required");
    return 1;
  }
  appendFileSync(output, `mode=${mode}\n`);
  console.log(`codeql upload mode: ${mode}`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "codeql upload mode failed");
    process.exitCode = 1;
  }
}
