import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isPdfContentType,
  morningPdfAllowed,
  morningPdfBlob,
  morningPdfId,
  morningPdfInvalid,
  morningPdfMissing,
  morningPdfToken,
  morningPdfUnauthorized,
  MORNING_PDF_CACHE,
} from "./morning-pdf-auth.ts";

const route = readFileSync(new URL("../../routes/morning-pdf.$id.ts", import.meta.url), "utf8");
const ui = readFileSync(new URL("../../components/morning-report-pdf.tsx", import.meta.url), "utf8");

const allow = { verifySystem: async () => true, verifyCopy: () => null };
const deny = { verifySystem: async () => false, verifyCopy: () => null };
const copyOnly = { verifySystem: async () => false, verifyCopy: () => ({ id: "app-1" }) };

describe("morning-report PDFs require a system or copy-admin token", () => {
  it("allows a verified system admin token", async () => {
    assert.equal(await morningPdfAllowed("sys.tok", allow), true);
  });

  it("allows a verified copy-admin token", async () => {
    assert.equal(await morningPdfAllowed("app.tok", copyOnly), true);
  });

  it("denies a missing, empty, or unverified token", async () => {
    assert.equal(await morningPdfAllowed(undefined, allow), false);
    assert.equal(await morningPdfAllowed("", allow), false);
    assert.equal(await morningPdfAllowed("nope", deny), false);
  });

  it("reads the token from the Authorization header only", () => {
    assert.equal(
      morningPdfToken(new Request("https://s1r1us.ai/morning-pdf/2026-11-25", {
        headers: { authorization: "Bearer secret-token" },
      })),
      "secret-token",
    );
    assert.equal(
      morningPdfToken(new Request("https://s1r1us.ai/morning-pdf/2026-11-25")),
      undefined,
    );
  });

  it("answers 401 with no file and 404 only after auth", () => {
    const unauthorized = morningPdfUnauthorized();
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("cache-control"), MORNING_PDF_CACHE);
    assert.equal(unauthorized.headers.get("cache-control"), "private, no-store");
    const missing = morningPdfMissing();
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), MORNING_PDF_CACHE);
  });

  it("rejects a malformed id with 400 and does not strip characters", () => {
    assert.equal(morningPdfId("2026-11-25"), "2026-11-25");
    assert.equal(morningPdfId("2026-11-24abc"), null);
    assert.equal(morningPdfId("../2026-11-25"), null);
    assert.equal(morningPdfId("2026-11-25/../../etc"), null);
    assert.equal(morningPdfId(""), null);
    assert.equal(morningPdfId(undefined), null);
    const invalid = morningPdfInvalid();
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get("cache-control"), MORNING_PDF_CACHE);
    assert.equal(invalid.headers.get("x-content-type-options"), "nosniff");
    const allowAt = route.indexOf("morningPdfAllowed");
    const idAt = route.indexOf("morningPdfId");
    const invalidAt = route.indexOf("morningPdfInvalid");
    const readAt = route.indexOf("readMorningPdf");
    assert.ok(allowAt >= 0 && idAt > allowAt, "id is checked after auth");
    assert.ok(invalidAt > idAt, "malformed ids return morningPdfInvalid");
    assert.ok(readAt > invalidAt, "readMorningPdf runs after the id check");
    assert.equal(route.includes(".replace(/[^0-9-]/g"), false);
    assert.match(route, /if \(!id\) return morningPdfInvalid\(\)/);
  });

  it("builds a PDF blob only when the response is application/pdf", () => {
    assert.equal(isPdfContentType("application/pdf"), true);
    assert.equal(isPdfContentType("application/pdf; charset=binary"), true);
    assert.equal(isPdfContentType("text/html"), false);
    assert.equal(isPdfContentType("application/javascript"), false);
    assert.equal(isPdfContentType("application/pdfx"), false);
    assert.equal(isPdfContentType(""), false);
    assert.equal(isPdfContentType(null), false);
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const ok = morningPdfBlob(bytes, "application/pdf; charset=binary");
    assert.ok(ok);
    assert.equal(ok.type, "application/pdf");
    assert.equal(morningPdfBlob(bytes, "text/html"), null);
    assert.equal(morningPdfBlob(bytes, "application/javascript"), null);
    assert.match(ui, /morningPdfBlob\(await res\.arrayBuffer\(\), res\.headers\.get\("content-type"\)\)/);
    assert.doesNotMatch(ui, /await res\.blob\(\)/);
  });

  it("the route checks auth before reading the PDF", () => {
    const allowAt = route.indexOf("morningPdfAllowed");
    const readAt = route.indexOf("readMorningPdf");
    assert.ok(allowAt >= 0, "route calls morningPdfAllowed");
    assert.ok(readAt > allowAt, "readMorningPdf runs after the auth check");
    assert.match(route, /if \(!allowed\) return morningPdfUnauthorized\(\)/);
    assert.match(route, /verifyAccessToken/);
    assert.match(route, /verifyAppAdminToken/);
  });

  it("the admin UI fetches the PDF with the bearer token and does not use a bare href", () => {
    assert.match(ui, /Authorization:\s*`Bearer \$\{token\}`/);
    assert.equal(ui.includes("href={`${inline}"), false);
    assert.equal(ui.includes("src={`${inline}"), false);
  });
});
