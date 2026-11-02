import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/access";
import { getQuotationPdf } from "@/lib/quote-document";

// GET /api/quote/[id]/pdf
//
// Session-cookie auth: a human downloading a document they are looking at in
// the app, not a machine integration.
//
// Access rule. The baseline is `quotations` + `revenue`, matching the Server
// Action gate for generating a quotation. But `quoteReview` and `quoteSend`
// are each sufficient ON THEIR OWN, because the whole purpose of those two
// grants is to handle this exact document: a reviewer has to read the priced
// PDF to approve it, and whoever sends it is handing that same priced PDF to
// the customer. Requiring `revenue` as well would have made the review gate
// unusable by the telecaller it was built for — the reviewer could approve a
// document they were forbidden from opening.
//
// `revenue` still governs seeing prices in aggregate (dashboard totals,
// reports, cashbook); it was never meant to hide the quotation a user is
// explicitly entrusted with sending.
//
// The document itself is composed and rendered by lib/quote-document.ts: a
// bilingual (Tamil + English) letterhead matched to the owner's reference
// document, printed through headless Chromium (lib/pdf-render.ts) because
// pdfkit (used for the Excel/PDF report export) can't shape Tamil script
// correctly.
//
// Once a quotation has been submitted for review its bytes are FROZEN, and
// this route serves those bytes rather than re-composing from the current
// Settings row. That is what makes the file the reviewer approved and the
// file the customer received provably the same document — see the comment
// at the top of lib/quote-document.ts. An un-frozen draft still renders on
// demand, byte-for-byte as before.

export const runtime = "nodejs";
export const maxDuration = 30; // Chromium launch + render can take a few seconds, well under Vercel's default

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const mayReadDocument =
    can(session, "quoteReview") ||
    can(session, "quoteSend") ||
    (can(session, "quotations") && can(session, "revenue"));
  if (!mayReadDocument) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const quotation = await prisma.quotation.findUnique({ where: { id }, select: { number: true } });
  if (!quotation) return NextResponse.json({ error: "not found" }, { status: 404 });

  const doc = await getQuotationPdf(id);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Only a frozen document gets an ETag: its bytes are immutable for the
  // life of the quotation, so a conditional request can be answered 304.
  // A draft's render is not stable (it tracks current settings), so it is
  // deliberately left uncacheable.
  const etag = doc.frozen && doc.sha256 ? `"${doc.sha256}"` : null;
  if (etag && req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return new NextResponse(new Uint8Array(doc.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${quotation.number.replace(/[^a-z0-9]+/gi, "_")}.pdf"`,
      ...(etag ? { ETag: etag } : {}),
    },
  });
}
