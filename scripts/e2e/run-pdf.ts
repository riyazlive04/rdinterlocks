/**
 * Quotation PDF flow suite — drives the REAL rendering pipeline end to end:
 *
 *   buildQuotationHtml()  ->  headless Chromium (lib/pdf-render.ts)  ->  PDF bytes
 *
 * No database needed: the quotation data is supplied directly in the shape
 * api/quote/[id]/pdf/route.ts builds it. Locally this renders through the
 * Edge/Chrome install that resolveLocalExecutablePath() discovers.
 *
 * The template deliberately uses a FIXED page height with `overflow: hidden`
 * (see its own comment: "a page that doesn't fit is a spacing bug to fix, not
 * something to silently paginate around"). That makes overflow a correctness
 * concern for a customer-facing money document — a clipped page drops line
 * items with no error anywhere — so this suite measures it in the browser.
 *
 * Run: npx tsx scripts/e2e/run-pdf.ts
 */

import fs from "fs";
import path from "path";
import os from "os";
import { tc, eq, ok, run } from "./harness";
import { buildQuotationHtml, type QuotePdfData, type QuoteItemRow } from "@/lib/quote-pdf-template";
import { renderHtmlToPdf, withPage } from "@/lib/pdf-render";
import { upiQrDataUrl } from "@/lib/upi-qr";
import { quoteItemName } from "@/lib/quote";

const OUT_DIR = path.join(os.tmpdir(), "rd-quote-pdf-tests");
fs.mkdirSync(OUT_DIR, { recursive: true });

function makeItems(n: number): QuoteItemRow[] {
  const sizes = [
    { label: "8 Inch", dimensions: "10.5*5*6" },
    { label: "6 Inch", dimensions: "10.5*4*6" },
    { label: "4 Inch", dimensions: "10.5*3*6" },
  ];
  return Array.from({ length: n }, (_, i) => {
    const size = sizes[i % sizes.length];
    const quantity = 1000 * (i + 1);
    const unitPrice = 24.5 + i;
    return {
      nameEn: quoteItemName(size, "en"),
      nameTa: quoteItemName(size, "ta"),
      quantity,
      unitPrice,
      total: quantity * unitPrice,
    };
  });
}

async function makeData(itemCount: number, overrides: Partial<QuotePdfData> = {}): Promise<QuotePdfData> {
  const items = overrides.items ?? makeItems(itemCount);
  const total = items.reduce((s, it) => s + it.total, 0);
  const bullets = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${prefix} condition number ${i + 1} as printed on the reference letterhead`);
  return {
    factoryName: "RD Interlock Bricks",
    addressEn: "No 4, Salem Main Road, Salem, Tamil Nadu 636001",
    addressTa: "எண் 4, சேலம் பிரதான சாலை, சேலம், தமிழ்நாடு 636001",
    phone: "8870714655",
    email: "rdinterlock@example.com",
    logoDataUrl: null,
    number: "RD/Q/2026-27/0042",
    dateLabel: "17 / 08 / 2026",
    customerName: "Ramesh Kumar",
    customerPlace: "Salem",
    customerPhone: "9876543210",
    items,
    total,
    termsEn: bullets("Payment", 4),
    termsTa: ["முன்பணம் 50% செலுத்த வேண்டும்", "மீதி தொகை டெலிவரி நேரத்தில்"],
    ourScopeEn: bullets("Our scope", 4),
    ourScopeTa: ["பொருட்கள் வழங்கப்படும்", "போக்குவரத்து எங்கள் பொறுப்பு"],
    clientScopeEn: bullets("Client scope", 4),
    clientScopeTa: ["தண்ணீர் வசதி", "மின்சார வசதி"],
    paymentLine: "Gpay / Phonepe : 8870714655",
    upiQrDataUrl: await upiQrDataUrl({ vpa: "rdinterlock@okhdfcbank", payeeName: "RD Interlock Bricks", amount: total }),
    signatureImageDataUrl: null,
    ...overrides,
  };
}

/** Measure, in a real browser, whether any .page clips its own content. */
async function measurePages(html: string) {
  return withPage(async (page) => {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    return page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".page")).map((el, i) => ({
        index: i,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        overflowPx: el.scrollHeight - el.clientHeight,
      }))
    );
  });
}

function countPdfPages(buf: Buffer): number {
  const s = buf.toString("latin1");
  return (s.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

// ─────────────────────────────── Test cases ──────────────────────────────

const TC_PDF01 = tc("TC-PDF-01", "A typical 3-line quotation renders to a valid 2-page PDF", async () => {
  const html = buildQuotationHtml(await makeData(3));
  const pdf = await renderHtmlToPdf(html);
  const out = path.join(OUT_DIR, "typical-3-items.pdf");
  fs.writeFileSync(out, pdf);

  ok("output is a PDF", pdf.subarray(0, 5).toString() === "%PDF-", pdf.subarray(0, 8).toString());
  ok("PDF is a plausible size (>20KB)", pdf.length > 20_000, `${pdf.length} bytes`);
  eq("it is exactly two pages (Tamil + English)", countPdfPages(pdf), 2);
  console.log(`         wrote ${out} (${(pdf.length / 1024).toFixed(0)} KB)`);
});

const TC_PDF02 = tc("TC-PDF-02", "A typical quotation's pages do not clip their content", async () => {
  const html = buildQuotationHtml(await makeData(3));
  const pages = await measurePages(html);
  eq("the document has two .page elements", pages.length, 2);
  for (const p of pages) {
    ok(`page ${p.index + 1} fits within its fixed height`, p.overflowPx <= 1, `overflows by ${p.overflowPx}px`);
  }
});

const TC_PDF03 = tc("TC-PDF-03", "A large quotation must not silently drop line items", async () => {
  // A real factory order can list more sizes and construction types than the
  // reference letterhead's three lines. With a fixed-height page and
  // `overflow: hidden`, every row past roughly the fifteenth was simply not
  // painted: the customer received a quotation whose visible items did not add
  // up to its printed total, and nothing failed server-side. The page must
  // grow (and if necessary spill onto another sheet) rather than clip.
  const ITEMS = 18;
  const html = buildQuotationHtml(await makeData(ITEMS));

  const pages = await measurePages(html);
  for (const p of pages) {
    ok(
      `page ${p.index + 1} with ${ITEMS} line items is not clipped`,
      p.overflowPx <= 1,
      `overflows by ${p.overflowPx}px — those rows would be invisible in the PDF`
    );
  }

  // The decisive check: every line item is actually in the laid-out document,
  // on both the Tamil and the English page.
  const rowCounts = await withPage(async (page) => {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    return page.evaluate(() =>
      Array.from(document.querySelectorAll(".page")).map(
        (pg) => pg.querySelectorAll("tbody tr").length
      )
    );
  });
  eq(`both pages render all ${ITEMS} rows`, rowCounts, [ITEMS, ITEMS]);

  const pdf = await renderHtmlToPdf(html);
  fs.writeFileSync(path.join(OUT_DIR, "stress-18-items.pdf"), pdf);
  ok("it still renders a valid PDF", pdf.subarray(0, 5).toString() === "%PDF-");
  // Two sheets per language at most: content spilling is acceptable, content
  // disappearing is not.
  const pageCount = countPdfPages(pdf);
  ok("a large quotation paginates rather than clipping", pageCount >= 2 && pageCount <= 4, `${pageCount} pages`);
  console.log(`         18-item quotation rendered as ${pageCount} PDF pages`);
});

const TC_PDF04 = tc("TC-PDF-04", "Customer-supplied text cannot break the document", async () => {
  const data = await makeData(2, {
    customerName: 'Ramesh & Co <script>alert("x")</script>',
    customerPlace: "Salem > Omalur",
    customerPhone: '"9876543210"',
  });
  const html = buildQuotationHtml(data);
  ok("a raw <script> tag never reaches the markup", !html.includes("<script>"), "unescaped script tag present");
  ok("the ampersand is escaped", html.includes("&amp;"));
  ok("the angle bracket is escaped", html.includes("&lt;"));
  const pdf = await renderHtmlToPdf(html);
  ok("it still renders", pdf.subarray(0, 5).toString() === "%PDF-");
  eq("and is still two pages", countPdfPages(pdf), 2);
});

const TC_PDF05 = tc("TC-PDF-05", "Tamil text is shaped by the browser, not dropped as tofu", async () => {
  const html = buildQuotationHtml(await makeData(3));
  ok("Tamil item names are present in the markup", html.includes("இன்டர்லாக்"));
  const width = await withPage(async (page) => {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    // A Tamil string must occupy real horizontal space; a run of .notdef glyphs
    // measures very differently from shaped text, and zero width means it
    // wasn't laid out at all.
    return page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "ta";
      probe.style.cssText = "position:absolute;white-space:nowrap;font-size:16px";
      probe.textContent = "இன்டர்லாக் பிரிக்ஸ்";
      document.body.appendChild(probe);
      return probe.getBoundingClientRect().width;
    });
  });
  ok("shaped Tamil has a non-trivial measured width", width > 40, `measured ${width.toFixed(1)}px`);
});

run("QUOTATION PDF FLOW SUITE (real headless Chromium)", [
  TC_PDF01,
  TC_PDF02,
  TC_PDF03,
  TC_PDF04,
  TC_PDF05,
]);
