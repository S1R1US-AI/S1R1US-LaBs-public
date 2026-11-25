/**
 * Auth for the morning-report PDF route. Same rule as fetchMorningLib:
 * a system admin token or a copy-admin (app-admin) token. No raw URL
 * ever yields the file.
 */

export const MORNING_PDF_CACHE = "private, no-store";

export const MORNING_PDF_ID_RE = /^\d{4}-\d{2}-\d{2}$/;

export type MorningPdfVerifiers = {
  verifySystem: (token: string | undefined) => Promise<boolean>;
  verifyCopy: (token: string | undefined) => { id: string } | null | false;
};

export function morningPdfToken(request: Request): string | undefined {
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m?.[1];
}

export function morningPdfId(raw: unknown): string | null {
  return typeof raw === "string" && MORNING_PDF_ID_RE.test(raw) ? raw : null;
}

export async function morningPdfAllowed(
  token: string | undefined,
  deps: MorningPdfVerifiers,
): Promise<boolean> {
  if (typeof token !== "string" || !token) return false;
  try {
    if ((await deps.verifySystem(token)) === true) return true;
  } catch {
    /* try copy-admin next */
  }
  try {
    return Boolean(deps.verifyCopy(token));
  } catch {
    return false;
  }
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": MORNING_PDF_CACHE,
      "x-content-type-options": "nosniff",
    },
  });
}

export function morningPdfUnauthorized(): Response {
  return textResponse(401, "Unauthorized");
}

export function morningPdfMissing(): Response {
  return textResponse(404, "not found");
}

export function morningPdfInvalid(): Response {
  return textResponse(400, "bad request");
}

export function isPdfContentType(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  return value.split(";", 1)[0]!.trim().toLowerCase() === "application/pdf";
}

/** Build a PDF blob only when the response type is application/pdf. */
export function morningPdfBlob(
  body: BlobPart,
  contentType: string | null | undefined,
): Blob | null {
  if (!isPdfContentType(contentType)) return null;
  return new Blob([body], { type: "application/pdf" });
}
