import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { prisma } from "./db";
import { renderHtmlToPdf } from "./pdf-render";
import { buildQuotationHtml, type QuoteItemRow } from "./quote-pdf-template";
import { upiQrDataUrl } from "./upi-qr";
import { quoteItemName } from "./quote";

// The quotation document: composing it, freezing it, and serving it.
//
// api/quote/[id]/pdf used to compose the PDF inline on every request, from
// the CURRENT Settings row — terms, scope lists, UPI id, signature image,
// logo. That makes the document unprovable: a quotation approved in November
// and re-opened in January renders with January's wording, so the file the
// reviewer approved and the file the customer received are only assumed to
// be the same. On a priced offer with a revision chain, that is the
// difference between an audit trail and a guess.
//
// So the composition lives here, in ONE function used by both the render-on-
// demand path and the freeze path, and a submitted quotation's bytes are
// rendered once, hashed, and stored in QuotationDocument. Every later read
// serves those bytes verbatim.

function ddmmyyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd} / ${mm} / ${d.getFullYear()}`;
}

function splitLines(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Build the print-ready HTML for one quotation. The single source of truth
 * for what a quotation document contains — moved here verbatim from the PDF
 * route so freezing and rendering on demand cannot drift apart.
 *
 * Returns null when the quotation doesn't exist, so callers can map that to
 * a 404 rather than guessing from a thrown error.
 */
export async function buildQuotationPdfHtml(quotationId: string): Promise<string | null> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: { items: { include: { brickSize: true } } },
  });
  if (!quotation) return null;

  const settings = await prisma.settings.findUnique({ where: { id: "default" } });

  const pngLogo = path.join(process.cwd(), "public", "logo.png");
  const logoDataUrl = fs.existsSync(pngLogo)
    ? `data:image/png;base64,${fs.readFileSync(pngLogo).toString("base64")}`
    : null;

  const items: QuoteItemRow[] = quotation.items.map((it) => ({
    nameEn: quoteItemName(it.brickSize, "en", it.transportOnly),
    nameTa: quoteItemName(it.brickSize, "ta", it.transportOnly),
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    total: it.total,
  }));

  const upiPayeeName = settings?.quoteUpiPayeeName || settings?.factoryName || "RD Interlock Bricks";
  const qr = settings?.quoteUpiId
    ? await upiQrDataUrl({
        vpa: settings.quoteUpiId,
        payeeName: upiPayeeName,
        amount: quotation.total,
        note: quotation.number,
      })
    : null;

  return buildQuotationHtml({
    factoryName: settings?.factoryName ?? "RD Interlock Bricks",
    addressEn: settings?.address ?? "",
    addressTa: settings?.quoteAddressTa ?? "",
    phone: settings?.phone ?? "",
    email: settings?.email ?? "",
    logoDataUrl,
    number: quotation.number,
    dateLabel: ddmmyyyy(quotation.quoteDate),
    customerName: quotation.customerName,
    customerPlace: quotation.place,
    customerPhone: quotation.customerPhone,
    items,
    total: quotation.total,
    termsEn: splitLines(settings?.quoteTermsEn ?? ""),
    termsTa: splitLines(settings?.quoteTermsTa ?? ""),
    ourScopeEn: splitLines(settings?.quoteOurScopeEn ?? ""),
    ourScopeTa: splitLines(settings?.quoteOurScopeTa ?? ""),
    clientScopeEn: splitLines(settings?.quoteClientScopeEn ?? ""),
    clientScopeTa: splitLines(settings?.quoteClientScopeTa ?? ""),
    paymentLine: settings?.quoteUpiId ? `Gpay / Phonepe : ${settings.quoteUpiId}` : "",
    upiQrDataUrl: qr,
    signatureImageDataUrl: settings?.quoteSignatureImage || null,
  });
}

/** Compose + render in one step. Null when the quotation doesn't exist. */
export async function renderQuotationPdf(quotationId: string): Promise<Buffer | null> {
  const html = await buildQuotationPdfHtml(quotationId);
  if (!html) return null;
  return renderHtmlToPdf(html);
}

/**
 * Render the quotation and store the bytes as THE document for it.
 *
 * Called when a quotation is submitted for review, so the reviewer, the
 * customer and any later audit all look at the same file. The hash is what
 * makes "is this the file that was approved?" answerable without comparing
 * blobs.
 *
 * Upsert, not create: a quotation sent back for changes and resubmitted must
 * freeze the corrected document. A REVISION never overwrites anything — it
 * is a different Quotation row, so it gets its own QuotationDocument.
 */
export async function freezeQuotationPdf(
  quotationId: string
): Promise<{ sha256: string; byteSize: number }> {
  const pdf = await renderQuotationPdf(quotationId);
  if (!pdf) throw new Error("Quotation not found.");

  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const byteSize = pdf.byteLength;

  await prisma.quotationDocument.upsert({
    where: { quotationId },
    update: { pdf, byteSize, sha256, renderedAt: new Date() },
    create: { quotationId, pdf, byteSize, sha256 },
  });

  return { sha256, byteSize };
}

/**
 * The bytes to serve for a quotation: the frozen document when there is one,
 * otherwise a fresh render (an un-submitted draft has nothing frozen yet,
 * and its PDF is expected to track whatever it currently says).
 *
 * `frozen` tells the caller whether these bytes are stable enough to put an
 * ETag on; null means no such quotation.
 */
export async function getQuotationPdf(
  quotationId: string
): Promise<{ pdf: Buffer; sha256: string | null; frozen: boolean } | null> {
  const doc = await prisma.quotationDocument.findUnique({ where: { quotationId } });
  if (doc) return { pdf: doc.pdf, sha256: doc.sha256, frozen: true };

  const pdf = await renderQuotationPdf(quotationId);
  if (!pdf) return null;
  return { pdf, sha256: null, frozen: false };
}
