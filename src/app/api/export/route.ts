import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";
import { getReportData, ReportKind } from "@/lib/reports";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const kind = (sp.get("kind") ?? "production") as ReportKind;
  const format = sp.get("format") ?? "xlsx";
  const fromStr = sp.get("from");
  const toStr = sp.get("to");
  const from = fromStr ? new Date(fromStr) : new Date();
  const to = toStr ? new Date(toStr) : new Date();
  to.setHours(23, 59, 59, 999);

  const data = await getReportData({
    from,
    to,
    kind,
    clientId: sp.get("clientId") ?? undefined,
    brickSizeId: sp.get("brickSizeId") ?? undefined,
    categoryId: sp.get("categoryId") ?? undefined,
    vendorId: sp.get("vendorId") ?? undefined,
    tipperId: sp.get("tipperId") ?? undefined,
  });

  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const factoryName = settings?.factoryName ?? "RD Interlock Bricks";
  const dateLabel = `${from.toDateString()} - ${to.toDateString()}`;
  const safeName = `${data.title.replace(/[^a-z0-9]+/gi, "_")}_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;

  // Flatten sections into rows for export (with date column injected at front)
  type FlatRow = {
    date: string;
    isSubtotal?: boolean;
    isChild?: boolean;
    cells: Record<string, string | number | null>;
  };
  const flat: FlatRow[] = [];
  for (const sec of data.sections) {
    for (const row of sec.rows) {
      flat.push({ date: sec.dateLabel, cells: row.cells });
      for (const child of row.children ?? []) {
        flat.push({ date: "", isChild: true, cells: child.cells });
      }
    }
    if (sec.subtotals && Object.keys(sec.subtotals).length > 0) {
      const sub: Record<string, string | number | null> = {};
      for (const [k, v] of Object.entries(sec.subtotals)) {
        sub[k] = v as number;
      }
      flat.push({
        date: `${sec.dateLabel} subtotal`,
        isSubtotal: true,
        cells: sub,
      });
    }
  }

  const columnsWithDate = [{ key: "_date", header: "Date" }, ...data.columns];

  // ─── Excel ───────────────────────────────────────────────────────────
  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    wb.creator = factoryName;
    wb.created = new Date();
    const ws = wb.addWorksheet(data.title);

    // Logo
    const pngLogo = path.join(process.cwd(), "public", "logo.png");
    if (fs.existsSync(pngLogo)) {
      const imgId = wb.addImage({ filename: pngLogo, extension: "png" });
      ws.addImage(imgId, "A1:A4");
    }

    // Letterhead
    ws.mergeCells("B1:H1");
    ws.getCell("B1").value = factoryName;
    ws.getCell("B1").font = { bold: true, size: 18 };
    ws.mergeCells("B2:H2");
    ws.getCell("B2").value = data.title;
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

    const headerRow = 6;
    columnsWithDate.forEach((c, i) => {
      const cell = ws.getCell(headerRow, i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1220" } };
      cell.alignment = { horizontal: "left", vertical: "middle" };
    });

    flat.forEach((row, ri) => {
      columnsWithDate.forEach((c, ci) => {
        const cell = ws.getCell(headerRow + 1 + ri, ci + 1);
        const v = c.key === "_date" ? row.date : row.cells[c.key];
        cell.value = v;
        if (typeof v === "number") {
          const dataCol = data.columns.find((d) => d.key === c.key);
          if (dataCol?.format === "money") {
            cell.numFmt = '"₹"#,##0.00;[Red]"−₹"#,##0.00';
          } else {
            cell.numFmt = "#,##0";
          }
        }
        if (row.isSubtotal) {
          cell.font = { bold: true };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
        } else if (row.isChild) {
          cell.font = { italic: true, color: { argb: "FF64748B" } };
        }
      });
    });

    // Grand total row
    if (data.totals) {
      const totalRow = headerRow + 1 + flat.length;
      columnsWithDate.forEach((c, i) => {
        const cell = ws.getCell(totalRow, i + 1);
        if (i === 0) cell.value = "GRAND TOTAL";
        else if (data.totals?.[c.key] != null) {
          cell.value = data.totals[c.key];
          const dataCol = data.columns.find((d) => d.key === c.key);
          if (dataCol?.format === "money") cell.numFmt = '"₹"#,##0.00';
          else cell.numFmt = "#,##0";
        }
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1220" } };
      });
    }

    columnsWithDate.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      let maxLen = c.header.length;
      flat.forEach((r) => {
        const v = String(c.key === "_date" ? r.date : r.cells[c.key] ?? "");
        if (v.length > maxLen) maxLen = v.length;
      });
      col.width = Math.min(40, Math.max(10, maxLen + 2));
    });

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeName}.xlsx"`,
      },
    });
  }

  // ─── PDF ─────────────────────────────────────────────────────────────
  if (format === "pdf") {
    const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on("end", () => resolve(Buffer.concat(chunks)))
    );

    const pngLogo = path.join(process.cwd(), "public", "logo.png");
    if (fs.existsSync(pngLogo)) {
      try {
        doc.image(pngLogo, 36, 30, { width: 50, height: 50 });
      } catch {
        /* ignore */
      }
    }
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#0B1220").text(factoryName, 96, 36);
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#E11D2C").text(data.title, 96, 56);
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

    let y = 110;
    const pageWidth = doc.page.width - 72;

    // Proportional column widths from content length, so wide text columns
    // (e.g. Operators) get more room while numeric columns stay compact. Each
    // weight is capped so one long cell can't dominate, with a floor per column.
    const weights = columnsWithDate.map((c) => {
      let maxLen = c.header.length;
      for (const r of flat) {
        const v = c.key === "_date" ? r.date : r.cells[c.key];
        const s = v == null ? "" : String(v);
        if (s.length > maxLen) maxLen = s.length;
      }
      return Math.max(5, Math.min(maxLen, 26));
    });
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const colWidths = weights.map((w) => (w / weightSum) * pageWidth);

    // Respect each column's alignment (numbers right-aligned, text left).
    const alignFor = (key: string): "left" | "right" | "center" =>
      key === "_date" ? "left" : data.columns.find((d) => d.key === key)?.align ?? "left";

    // Header
    doc.rect(36, y, pageWidth, 22).fill("#0B1220");
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
    let x = 36 + 4;
    columnsWithDate.forEach((c, i) => {
      doc.text(c.header, x, y + 7, { width: colWidths[i] - 8, align: alignFor(c.key), lineBreak: false });
      x += colWidths[i];
    });
    y += 22;

    doc.font("Helvetica").fontSize(8).fillColor("#0B1220");
    let lastDate = "";
    for (const row of flat) {
      if (y > doc.page.height - 80) {
        doc.addPage();
        y = 50;
      }
      const isDateChange = row.date && row.date !== lastDate;
      if (isDateChange) lastDate = row.date;
      const bg = row.isSubtotal ? "#F1F5F9" : row.isChild ? "#F8FAFC" : "#FFFFFF";
      doc.rect(36, y, pageWidth, 18).fill(bg);
      doc.fillColor(row.isSubtotal ? "#0B1220" : "#0B1220");
      if (row.isSubtotal) doc.font("Helvetica-Bold");
      else doc.font("Helvetica");
      x = 36 + 4;
      columnsWithDate.forEach((c, i) => {
        const v = c.key === "_date" ? row.date : row.cells[c.key];
        let text = "";
        const dataCol = data.columns.find((d) => d.key === c.key);
        if (typeof v === "number") {
          const isMoney = dataCol?.format === "money";
          text = isMoney
            ? `${v < 0 ? "−" : ""}₹${Math.abs(v).toLocaleString("en-IN")}`
            : v.toLocaleString("en-IN");
          if (v < 0) doc.fillColor("#DC2626");
        } else {
          text = v == null ? "" : String(v);
        }
        // Constrain to a single line (height ≈ one line) so long text like the
        // operators list is ellipsized instead of wrapping into the next row.
        doc.text(text, x, y + 5, {
          width: colWidths[i] - 8,
          align: alignFor(c.key),
          height: 10,
          ellipsis: true,
        });
        doc.fillColor("#0B1220");
        x += colWidths[i];
      });
      y += 18;
    }

    // Grand total
    if (data.totals) {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = 50;
      }
      doc.rect(36, y, pageWidth, 22).fill("#0B1220");
      doc.fillColor("#FFFFFF").font("Helvetica-Bold");
      x = 36 + 4;
      columnsWithDate.forEach((c, i) => {
        let text = "";
        if (i === 0) text = "GRAND TOTAL";
        else if (data.totals?.[c.key] != null) {
          const v = Number(data.totals[c.key]);
          const dataCol = data.columns.find((d) => d.key === c.key);
          const isMoney = dataCol?.format === "money";
          text = isMoney ? `₹${v.toLocaleString("en-IN")}` : v.toLocaleString("en-IN");
        }
        doc.text(text, x, y + 7, { width: colWidths[i] - 8, align: alignFor(c.key), lineBreak: false });
        x += colWidths[i];
      });
    }

    doc.end();
    const buf = await done;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName}.pdf"`,
      },
    });
  }

  return NextResponse.json({ error: "unknown format" }, { status: 400 });
}
