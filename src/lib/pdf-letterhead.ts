import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";

// The factory letterhead (logo, name, document title, date, address/phone/
// gstin) drawn identically at the top of every generated document — the
// Excel/PDF report export today, and any future pdfkit-based document.
// Extracted from api/export/route.ts so a second caller can reuse it without
// duplicating the layout; the two functions below are byte-for-byte what was
// inlined there before.

export type LetterheadInfo = {
  factoryName: string;
  title: string;
  dateLabel: string;
  settings: { address?: string | null; phone?: string | null; gstin?: string | null } | null;
};

export function drawXlsxLetterhead(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, info: LetterheadInfo) {
  const { factoryName, title, dateLabel, settings } = info;

  const pngLogo = path.join(process.cwd(), "public", "logo.png");
  if (fs.existsSync(pngLogo)) {
    const imgId = wb.addImage({ filename: pngLogo, extension: "png" });
    ws.addImage(imgId, "A1:A4");
  }

  ws.mergeCells("B1:H1");
  ws.getCell("B1").value = factoryName;
  ws.getCell("B1").font = { bold: true, size: 18 };
  ws.mergeCells("B2:H2");
  ws.getCell("B2").value = title;
  ws.getCell("B2").font = { bold: true, size: 14, color: { argb: "FFE11D2C" } };
  ws.mergeCells("B3:H3");
  ws.getCell("B3").value = dateLabel;
  ws.getCell("B3").font = { italic: true, color: { argb: "FF64748B" } };
  if (settings?.address || settings?.phone || settings?.gstin) {
    ws.mergeCells("B4:H4");
    ws.getCell("B4").value = [settings?.address, settings?.phone, settings?.gstin]
      .filter(Boolean)
      .join(" · ");
    ws.getCell("B4").font = { size: 10, color: { argb: "FF64748B" } };
  }
}

export function drawPdfLetterhead(doc: InstanceType<typeof PDFDocument>, info: LetterheadInfo) {
  const { factoryName, title, dateLabel, settings } = info;

  const pngLogo = path.join(process.cwd(), "public", "logo.png");
  if (fs.existsSync(pngLogo)) {
    try {
      doc.image(pngLogo, 36, 30, { width: 50, height: 50 });
    } catch {
      /* ignore */
    }
  }
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#0B1220").text(factoryName, 96, 36);
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#E11D2C").text(title, 96, 56);
  doc.font("Helvetica").fontSize(9).fillColor("#64748B").text(dateLabel, 96, 72);
  if (settings?.address || settings?.phone || settings?.gstin) {
    doc
      .fontSize(8)
      .text(
        [settings?.address, settings?.phone, settings?.gstin].filter(Boolean).join(" · "),
        96,
        85
      );
  }
}
