import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/morning-pdf/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const {
          morningPdfAllowed,
          morningPdfId,
          morningPdfInvalid,
          morningPdfMissing,
          morningPdfToken,
          morningPdfUnauthorized,
          MORNING_PDF_CACHE,
        } = await import("@/lib/desk/morning-pdf-auth");
        const { verifyAccessToken } = await import("@/lib/desk/access.server");
        const { verifyAppAdminToken } = await import("@/lib/desk/app-admin");
        const token = morningPdfToken(request);
        const allowed = await morningPdfAllowed(token, {
          verifySystem: verifyAccessToken,
          verifyCopy: verifyAppAdminToken,
        });
        if (!allowed) return morningPdfUnauthorized();

        const id = morningPdfId(params.id);
        if (!id) return morningPdfInvalid();
        const dl = new URL(request.url).searchParams.get("dl") === "1";
        const { readMorningPdf } = await import("@/lib/desk/morning-lib.server");
        const { morningPdfName } = await import("@/lib/desk/morning-lib");
        const buf = await readMorningPdf(id);
        if (!buf) return morningPdfMissing();
        const name = morningPdfName(id);
        return new Response(new Uint8Array(buf), {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `${dl ? "attachment" : "inline"}; filename="${name}"`,
            "cache-control": MORNING_PDF_CACHE,
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
