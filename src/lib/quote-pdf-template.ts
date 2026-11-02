// HTML template for the quotation PDF, matched to the owner-supplied
// reference letterhead (Tamil page + English page, teal-header item table,
// terms/scope two-column layout, dynamic UPI QR, signature block). Rendered
// to PDF via lib/pdf-render.ts (headless Chromium — required for correct
// Tamil complex-script shaping).

export type QuoteItemRow = { nameEn: string; nameTa: string; quantity: number; unitPrice: number; total: number };

export type QuotePdfData = {
  factoryName: string;
  addressEn: string;
  addressTa: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  number: string;
  dateLabel: string; // "17 / 08 / 2026"
  customerName: string;
  customerPlace: string;
  customerPhone: string;
  items: QuoteItemRow[];
  total: number;
  termsEn: string[];
  termsTa: string[];
  ourScopeEn: string[];
  ourScopeTa: string[];
  clientScopeEn: string[];
  clientScopeTa: string[];
  paymentLine: string; // "Gpay / Phonepe : 8870714655"
  upiQrDataUrl: string | null;
  signatureImageDataUrl: string | null;
};

const TEAL = "#5AC8DC";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function itemRows(items: QuoteItemRow[], lang: "en" | "ta"): string {
  return items
    .map(
      (it) => `
      <tr>
        <td class="item ${lang === "ta" ? "ta" : ""}">${esc(lang === "ta" ? it.nameTa : it.nameEn)}</td>
        <td class="num">${it.quantity.toLocaleString("en-IN")}</td>
        <td class="num">${it.unitPrice.toLocaleString("en-IN")}</td>
        <td class="num">${it.total.toLocaleString("en-IN")}</td>
      </tr>`
    )
    .join("");
}

function bulletList(items: string[], lang: "en" | "ta"): string {
  return `<ul class="${lang === "ta" ? "ta" : ""}">${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
}

function page(d: QuotePdfData, lang: "en" | "ta"): string {
  const t = lang === "ta";
  const title = t ? "விலைப்பட்டியல்" : "Quotation";
  const brandSub = t ? "இன்டர்லாக் பிரிக்ஸ்" : "Interlock bricks";
  const address = t ? d.addressTa : d.addressEn;
  const finalFor = t ? "இறுதி விலை மதிப்பீடு பெறுபவர்" : "Final Quotation For";
  const lName = t ? "பெயர்" : "Name";
  const lAddress = t ? "முகவரி" : "Address";
  const lPhone = t ? "தொலைபேசி எண்" : "Phone No";
  const lDate = t ? "தேதி" : "Date";
  const lState = t ? "மாநிலம்" : "State";
  const stateValue = t ? "தமிழ்நாடு" : "Tamilnadu";
  const hItem = t ? "பொருள் பெயர்" : "Item Name";
  const hQty = t ? "அளவு" : "Quantity";
  const hRate = t ? "யூனிட் விலை" : "Price / Unit";
  const hAmount = t ? "மொத்த தொகை" : "Amount";
  const terms = t ? d.termsTa : d.termsEn;
  const ourScope = t ? d.ourScopeTa : d.ourScopeEn;
  const clientScope = t ? d.clientScopeTa : d.clientScopeEn;
  const hTerms = t ? "விதிமுறைகள் மற்றும் நிபந்தனைகள்" : "Terms and Conditions";
  const hClientScope = t ? "வாடிக்கையாளர் பொறுப்பு" : "Client Scope";
  const hOurScope = t ? "எங்கள் பொறுப்பு" : "Our Scope";
  const hPayTo = "Pay To"; // kept in Latin on both pages, matching the reference
  const totalLabel = t ? "மொத்த தொகை" : "Total Amount";
  // The signature attribution stays in Latin script on BOTH pages in the
  // reference document (unlike every other label) — matched here rather
  // than translated.
  const forCompany = `For ${d.factoryName}`;
  const proprietor = "Proprietor";

  return `
  <section class="page ${t ? "ta" : ""}">
    <div class="header">
      <div class="brand">
        ${d.logoDataUrl ? `<img class="logo" src="${d.logoDataUrl}" alt="" />` : ""}
        <div>
          <div class="brand-name">RD</div>
          <div class="brand-sub ${t ? "ta" : ""}">${esc(brandSub)}</div>
          <div class="brand-addr ${t ? "ta" : ""}">${esc(address)}</div>
        </div>
      </div>
      <div class="contact">
        <div>${t ? "தொலைபேசி" : "Phone No"} : ${esc(d.phone)}</div>
        <div>${t ? "மின்னஞ்சல்" : "Email"} : ${esc(d.email)}</div>
      </div>
    </div>

    <div class="title ${t ? "ta" : ""}">${title}</div>

    <div class="meta">
      <div>
        <div class="field ${t ? "ta" : ""}"><span class="label">${finalFor}</span></div>
        <div class="field ${t ? "ta" : ""}"><span class="label">${lName}</span> : ${esc(d.customerName || "-")}</div>
        <div class="field ${t ? "ta" : ""}"><span class="label">${lAddress}</span> : ${esc(d.customerPlace || "-")}</div>
        <div class="field ${t ? "ta" : ""}"><span class="label">${lPhone}</span> : ${esc(d.customerPhone || "-")}</div>
      </div>
      <div style="text-align:right">
        <div class="field ${t ? "ta" : ""}">${lDate} : ${esc(d.dateLabel)}</div>
        <div class="field ${t ? "ta" : ""}">${lState} : ${esc(stateValue)}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="${t ? "ta" : ""}">${hItem}</th>
          <th class="${t ? "ta" : ""}">${hQty}</th>
          <th class="${t ? "ta" : ""}">${hRate}</th>
          <th class="${t ? "ta" : ""}">${hAmount}</th>
        </tr>
      </thead>
      <tbody>${itemRows(d.items, lang)}</tbody>
    </table>

    <div class="total-row">
      <div class="total-box ${t ? "ta" : ""}">${totalLabel} : ${d.total.toLocaleString("en-IN")}</div>
    </div>

    <div class="cols">
      <div class="col">
        <h3 class="${t ? "ta" : ""}">${hTerms} :</h3>
        ${bulletList(terms, lang)}
        <h3 class="${t ? "ta" : ""}">${hClientScope} :</h3>
        ${bulletList(clientScope, lang)}
      </div>
      <div class="col">
        <h3>${hPayTo} :</h3>
        ${
          d.upiQrDataUrl
            ? `<div class="qr-box"><img src="${d.upiQrDataUrl}" alt="UPI QR" /><div>${esc(d.paymentLine)}</div></div>`
            : `<div class="qr-box">${esc(d.paymentLine)}</div>`
        }
        <h3 class="${t ? "ta" : ""}">${hOurScope} :</h3>
        ${bulletList(ourScope, lang)}
        <div class="sign">
          <div>${esc(forCompany)}</div>
          ${
            d.signatureImageDataUrl
              ? `<img class="signature" src="${d.signatureImageDataUrl}" alt="Signature" />`
              : `<div style="height:36px"></div>`
          }
          <div>${proprietor}</div>
        </div>
      </div>
    </div>
  </section>`;
}

export function buildQuotationHtml(d: QuotePdfData): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(d.number)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil:wght@400;700&family=Noto+Sans:wght@400;700&display=swap');
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans', Arial, sans-serif; margin: 0; color: #0B1220; }
  .ta, .ta * { font-family: 'Noto Sans Tamil', 'Noto Sans', sans-serif; }
  /* min-height, NOT a fixed height with overflow:hidden. The reference
     document fits each language on exactly one page and the sizes below
     are tuned to keep it that way, so in practice this still renders as
     two pages — but "it should fit" cannot be enforced by clipping.
     A fixed 297mm height with overflow:hidden silently DELETED any line
     item past roughly the fifteenth from the rendered PDF: the rows were
     simply not painted, no error was raised anywhere, and the customer
     received a quotation whose visible items did not add up to its
     printed total. Letting the page grow instead means a genuinely large
     quotation spills onto an extra sheet — visibly imperfect, which is
     the right failure mode for a money document, and still a spacing bug
     to fix rather than something to ignore.
     Regression cover: scripts/e2e/run-pdf.ts TC-PDF-03. */
  /* Sizes below are calibrated against the owner's actual reference file
     (RD Interlock Quotation Salem 17 — pdf2htmlEX export), not eyeballed:
     its title text measures ~88.7px on a 794px-wide (210mm @96dpi) page,
     its header/contact text ~40px, its smallest body text ~28px. Full 1:1
     scale doesn't fit one A4 page alongside real (non-placeholder) line
     items and 16 bullet points, so these are scaled down together to the
     largest size that still fits — title first (highest confidence
     measurement), everything else at roughly the same relative proportion
     the reference uses rather than an independent guess per element. */
  .page { width: 210mm; min-height: 297mm; padding: 7mm 11mm; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #0B1220; padding-bottom:4px; margin-bottom:5px; }
  .brand { display:flex; gap:8px; align-items:flex-start; }
  .brand img.logo { width:46px; height:46px; object-fit:contain; }
  .brand-name { font-size:30px; font-weight:800; line-height:1; color:#0B1220; }
  .brand-sub { font-size:18px; font-weight:700; margin-top:1px; }
  .brand-addr { font-size:11.5px; color:#475569; margin-top:2px; max-width:280px; line-height:1.25; }
  .contact { text-align:right; font-size:13px; color:#334155; }
  .title { text-align:center; font-size:46px; font-weight:800; margin:3px 0 5px; padding-bottom:4px; border-bottom:3px solid #0B1220; }
  .meta { display:flex; justify-content:space-between; margin-bottom:5px; }
  .field { font-size:14px; margin-bottom:1px; }
  .label { font-weight:700; }
  table { width:100%; border-collapse:collapse; margin-bottom:3px; }
  th { background:${TEAL}; color:#0B1220; font-size:14px; font-weight:700; padding:5px 8px; border:1px solid #0B1220; }
  td { border:1px solid #94A3B8; font-size:14px; padding:5px 8px; }
  td.item { text-align:left; font-weight:600; }
  td.num { text-align:center; }
  .total-row { display:flex; justify-content:flex-end; margin:3px 0 5px; }
  .total-box { background:${TEAL}; padding:4px 14px; font-weight:700; font-size:15px; }
  .cols { display:flex; gap:20px; }
  .col { flex:1; min-width:0; }
  h3 { font-size:15px; margin:5px 0 2px; }
  ul { margin:0; padding-left:15px; font-size:13px; line-height:1.28; }
  li { margin-bottom:1px; }
  .qr-box { text-align:center; margin:3px 0 7px; font-size:13px; font-weight:600; }
  .qr-box img { width:92px; height:92px; display:block; margin:0 auto 5px; }
  .sign { margin-top:10px; text-align:right; font-size:13px; font-weight:600; }
  .sign img.signature { height:38px; margin:3px 0; display:inline-block; }
</style>
</head>
<body>
  ${page(d, "ta")}
  ${page(d, "en")}
</body>
</html>`;
}
