import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CODEQL_UPLOAD_ALWAYS, CODEQL_UPLOAD_NEVER, codeqlUploadMode } from "./codeql-upload-mode.mjs";

const SCRIPT = fileURLToPath(new URL("./codeql-upload-mode.mjs", import.meta.url));
const WORKFLOW = fileURLToPath(new URL("../.github/workflows/codeql.yml", import.meta.url));
const GITIGNORE = fileURLToPath(new URL("../.gitignore", import.meta.url));
const CODEQL_ACTION = "33d7b85da1a04171e211befe2c739303b9a4c066";

test("default branch always uploads, including when the actor is Dependabot", () => {
  assert.equal(
    codeqlUploadMode({
      actor: "dependabot[bot]",
      ref: "refs/heads/main",
      defaultBranch: "main",
    }),
    CODEQL_UPLOAD_ALWAYS,
  );
  assert.equal(
    codeqlUploadMode({
      actor: "S1R1US-AI",
      ref: "refs/heads/main",
      defaultBranch: "main",
    }),
    CODEQL_UPLOAD_ALWAYS,
  );
});

test("Dependabot push and pull_request off the default branch skip code scanning upload", () => {
  assert.equal(
    codeqlUploadMode({
      actor: "dependabot[bot]",
      ref: "refs/heads/dependabot/npm_and_yarn/jose-6.2.15",
      defaultBranch: "main",
    }),
    CODEQL_UPLOAD_NEVER,
  );
  assert.equal(
    codeqlUploadMode({
      actor: "dependabot[bot]",
      ref: "refs/pull/1/merge",
      defaultBranch: "main",
    }),
    CODEQL_UPLOAD_NEVER,
  );
});

test("every other actor keeps upload always, and near-miss actor names do too", () => {
  for (const actor of ["S1R1US-AI", "github-actions[bot]", "dependabot", "Dependabot[bot]"]) {
    assert.equal(
      codeqlUploadMode({
        actor,
        ref: "refs/heads/06/semgrep-log-redaction-failclosed",
        defaultBranch: "main",
      }),
      CODEQL_UPLOAD_ALWAYS,
    );
    assert.equal(
      codeqlUploadMode({
        actor,
        ref: "refs/pull/8/merge",
        defaultBranch: "main",
      }),
      CODEQL_UPLOAD_ALWAYS,
    );
  }
});

test("the mode is only always or never", () => {
  const samples = [
    ["dependabot[bot]", "refs/pull/2/merge"],
    ["S1R1US-AI", "refs/tags/v1"],
    ["dependabot[bot]", "refs/heads/main"],
  ];
  for (const [actor, ref] of samples) {
    const mode = codeqlUploadMode({ actor, ref, defaultBranch: "main" });
    assert.ok(mode === CODEQL_UPLOAD_ALWAYS || mode === CODEQL_UPLOAD_NEVER);
    assert.notEqual(mode, "false");
    assert.notEqual(mode, "failure-only");
  }
});

test("missing actor, ref, or default branch fails closed", () => {
  assert.throws(() => codeqlUploadMode({ actor: "", ref: "refs/heads/main", defaultBranch: "main" }));
  assert.throws(() => codeqlUploadMode({ actor: "S1R1US-AI", ref: "", defaultBranch: "main" }));
  assert.throws(() => codeqlUploadMode({ actor: "S1R1US-AI", ref: "refs/heads/main", defaultBranch: "" }));
});

test("the CLI writes the mode for Actions and fails when it cannot", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeql-upload-mode-"));
  const output = join(dir, "github-output");
  const never = spawnSync(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      CODEQL_ACTOR: "dependabot[bot]",
      CODEQL_REF: "refs/pull/6/merge",
      CODEQL_DEFAULT_BRANCH: "main",
      GITHUB_OUTPUT: output,
    },
    encoding: "utf8",
  });
  assert.equal(never.status, 0, never.stderr);
  assert.equal(readFileSync(output, "utf8"), "mode=never\n");
  assert.match(never.stdout, /^codeql upload mode: never\n$/);

  const missingOutput = spawnSync(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      CODEQL_ACTOR: "S1R1US-AI",
      CODEQL_REF: "refs/heads/main",
      CODEQL_DEFAULT_BRANCH: "main",
      GITHUB_OUTPUT: "",
    },
    encoding: "utf8",
  });
  assert.equal(missingOutput.status, 1);

  const missingActor = spawnSync(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      CODEQL_ACTOR: "",
      CODEQL_REF: "refs/heads/main",
      CODEQL_DEFAULT_BRANCH: "main",
      GITHUB_OUTPUT: output,
    },
    encoding: "utf8",
  });
  assert.equal(missingActor.status, 1);
  assert.match(missingActor.stderr, /actor is required/);
});

test("the workflow keeps analysis, main upload, and the Dependabot artifact path", () => {
  const workflow = readFileSync(WORKFLOW, "utf8");
  assert.equal(workflow.split(CODEQL_ACTION).length - 1, 2);
  assert.match(workflow, /security-events: write/);
  assert.match(workflow, /queries: security-extended/);
  assert.match(workflow, /language: \[javascript-typescript, actions, python\]/);
  assert.match(workflow, /name: Analyze \(\$\{\{ matrix\.language \}\}\)/);
  assert.match(workflow, /CODEQL_ACTOR: \$\{\{ github\.actor \}\}/);
  assert.match(workflow, /CODEQL_REF: \$\{\{ github\.ref \}\}/);
  assert.match(workflow, /CODEQL_DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /node scripts\/codeql-upload-mode\.mjs/);
  assert.match(workflow, /upload: \$\{\{ steps\.codeql-upload\.outputs\.mode \}\}/);
  assert.match(workflow, /output: codeql-sarif/);
  assert.match(workflow, /if: \$\{\{ success\(\) && steps\.codeql-upload\.outputs\.mode == 'never' \}\}/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.doesNotMatch(workflow, /continue-on-error/);
  assert.doesNotMatch(workflow, /upload:\s*false/);
  assert.doesNotMatch(workflow, /upload:\s*['"]?never['"]?/);
  assert.match(readFileSync(GITIGNORE, "utf8"), /^\/codeql-sarif\/$/m);
});
