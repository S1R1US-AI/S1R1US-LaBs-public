/**
 * Test-only preload (node --import). Gives each test process its own temp
 * folder, so tests never write the shared files in /tmp or the desk data folder.
 *
 * - NODE_ENV=test and DESK_TEST_DATA_DIR turn on the redirect in
 *   src/lib/desk/data-path.ts. Production never loads this file.
 * - S1R1US_WAGER_MAX_USD and the two pick-check list settings get test-only
 *   values so paper-pick tests can run.
 * - TMPDIR points at the same private folder, so temp folders made by tests
 *   are removed when the process exits.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "s1r1us-test-"));
process.env.NODE_ENV = "test";
process.env.DESK_TEST_DATA_DIR = root;
process.env.TMPDIR = root;
// Test-only per-pick paper max (not the deploy value). Unset in production env = picks off.
process.env.S1R1US_WAGER_MAX_USD ??= "1000";
// Test-only pick-check list settings (not the deploy values). Unset in production env = picks off.
process.env.S1R1US_PICK_THROTTLE_ENTRIES ??= "5000";
process.env.S1R1US_PICK_THROTTLE_PRUNE_GAP_MS ??= "1000";

process.on("exit", () => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
