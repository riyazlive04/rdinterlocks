/**
 * Draws the complete RD Interlock business flow as a multi-page PDF.
 *
 *   node scripts/flow-diagram.mjs
 *
 * Page 1 is the whole business on one sheet; pages 2-7 open each stage up with
 * its own boxes and arrows. Everything is drawn with pdfkit primitives, so the
 * file needs no fonts, images or network access.
 */
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

const OUT = path.join(process.cwd(), "docs", "RD-Interlock-Business-Flow.pdf");
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const W = 841.89; // A4 landscape
const H = 595.28;
const M = 36;
const RIGHT = W - M;

const TONES = {
  plain: { fill: "#FFFFFF", stroke: "#CBD5E1", title: "#0B1220", body: "#475569" },
  paper: { fill: "#F1F5F9", stroke: "#CBD5E1", title: "#0B1220", body: "#475569" },
  ink: { fill: "#0E2143", stroke: "#0E2143", title: "#FFFFFF", body: "#C7D2E4" },
  red: { fill: "#FDE7E9", stroke: "#E11D2C", title: "#B0111E", body: "#7F1420" },
  green: { fill: "#E3F5EC", stroke: "#059669", title: "#046C4E", body: "#065F46" },
  blue: { fill: "#E8EDFF", stroke: "#1F4FFF", title: "#1233B8", body: "#1E3A8A" },
  amber: { fill: "#FDF3E3", stroke: "#C97A18", title: "#8A5310", body: "#7C4A0F" },
};

const ARROW = "#475569";
const MUTED = "#64748B";

const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: false });
doc.pipe(fs.createWriteStream(OUT));

// ── primitives ────────────────────────────────────────────────────────

// Anything drawn outside the margins is a layout bug, not a style choice —
// shout about it at build time rather than shipping a clipped diagram.
const problems = [];
let currentPage = 0;
function checkBounds(kind, label, x, y, w, h) {
  if (x < M - 1 || y < 62 || x + w > W - M + 1 || y + h > H - 30) {
    problems.push(
      `p${currentPage} ${kind} "${String(label).slice(0, 34)}" at (${Math.round(x)},${Math.round(y)}) ${Math.round(w)}x${Math.round(h)} escapes the page`
    );
  }
}

function box({ x, y, w, h, title, body, tone = "plain", align = "center", titleSize = 9.5, bodySize = 7.4, radius = 8 }) {
  checkBounds("box", title ?? body ?? "", x, y, w, h);
  const t = TONES[tone];
  doc.lineWidth(1.1).roundedRect(x, y, w, h, radius).fillAndStroke(t.fill, t.stroke);
  let ty = y + 8;
  if (title) {
    doc.fillColor(t.title).font("Helvetica-Bold").fontSize(titleSize);
    doc.text(title, x + 7, ty, { width: w - 14, align });
    ty = doc.y + 2.5;
  }
  if (body) {
    doc.fillColor(t.body).font("Helvetica").fontSize(bodySize);
    doc.text(body, x + 7, ty, { width: w - 14, align, lineGap: 0.8 });
  }
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h };
}

function diamond({ x, y, w, h, title, tone = "amber", size = 9 }) {
  const t = TONES[tone];
  doc
    .lineWidth(1.1)
    .moveTo(x + w / 2, y)
    .lineTo(x + w, y + h / 2)
    .lineTo(x + w / 2, y + h)
    .lineTo(x, y + h / 2)
    .closePath()
    .fillAndStroke(t.fill, t.stroke);
  doc.fillColor(t.title).font("Helvetica-Bold").fontSize(size);
  doc.text(title, x + w * 0.16, y + h / 2 - size * 0.85, { width: w * 0.68, align: "center" });
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h };
}

function head(x, y, angle, color, size = 6.5) {
  const a1 = angle + Math.PI - 0.42;
  const a2 = angle + Math.PI + 0.42;
  doc
    .moveTo(x, y)
    .lineTo(x + size * Math.cos(a1), y + size * Math.sin(a1))
    .lineTo(x + size * Math.cos(a2), y + size * Math.sin(a2))
    .closePath()
    .fill(color);
}

/** arrow through a list of [x,y] points; arrowhead on the final segment. */
function arrow(points, { color = ARROW, dashed = false, label, labelAt = 0.5, width = 1.2 } = {}) {
  for (const [px, py] of points) checkBounds("arrow", label ?? "", px, py, 0, 0);
  doc.lineWidth(width).strokeColor(color);
  if (dashed) doc.dash(4, { space: 3 });
  doc.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) doc.lineTo(points[i][0], points[i][1]);
  doc.stroke();
  if (dashed) doc.undash();

  const [px, py] = points[points.length - 2];
  const [qx, qy] = points[points.length - 1];
  head(qx, qy, Math.atan2(qy - py, qx - px), color);

  if (label) {
    const [ax, ay] = points[0];
    const [bx, by] = points[points.length - 1];
    const lx = ax + (bx - ax) * labelAt;
    const ly = ay + (by - ay) * labelAt;
    doc.font("Helvetica-Bold").fontSize(6.8).fillColor(color);
    const tw = doc.widthOfString(label) + 8;
    doc.rect(lx - tw / 2, ly - 6, tw, 12).fill("#FFFFFF");
    doc.fillColor(color).text(label, lx - tw / 2, ly - 3.6, { width: tw, align: "center" });
  }
}

/** Straight arrow between the facing edges of two boxes. */
const rightTo = (a, b, o) => arrow([[a.r, a.cy], [b.x - 2, b.cy]], o);
const downTo = (a, b, o) => arrow([[a.cx, a.b], [b.cx, b.y - 2]], o);

function pageFrame(no, title, sub) {
  currentPage = no;
  doc.addPage();
  doc.rect(0, 0, W, H).fill("#FFFFFF");
  doc.rect(0, 0, W, 4).fill("#E11D2C");

  doc.fillColor("#0B1220").font("Helvetica-Bold").fontSize(15).text(title, M, 24, { width: 660 });
  if (sub) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(sub, M, 44, { width: 660 });
  }
  doc.fillColor("#CBD5E1").font("Helvetica-Bold").fontSize(24).text(String(no).padStart(2, "0"), RIGHT - 60, 22, {
    width: 60,
    align: "right",
  });
  doc.moveTo(M, 62).lineTo(RIGHT, 62).lineWidth(0.8).strokeColor("#E2E8F0").stroke();

  doc.fillColor("#94A3B8").font("Helvetica").fontSize(7);
  doc.text("RD Interlock Bricks - Factory OS - complete business flow", M, H - 24, { width: 500 });
}

function note(x, y, w, text, tone = "paper") {
  const t = TONES[tone];
  doc.font("Helvetica").fontSize(7.4);
  const h = doc.heightOfString(text, { width: w - 18 }) + 15;
  doc.lineWidth(1).roundedRect(x, y, w, h, 6).fillAndStroke(t.fill, t.stroke);
  doc.fillColor(t.body).font("Helvetica").fontSize(7.4).text(text, x + 9, y + 7, { width: w - 18 });
  return { x, y, w, h, b: y + h, cx: x + w / 2 };
}

function caption(x, y, w, text, color = MUTED, size = 7.2, align = "left") {
  doc.fillColor(color).font("Helvetica-Oblique").fontSize(size).text(text, x, y, { width: w, align });
}

// ══════════════════════════════════════════════════════════════════════
// PAGE 1 — the whole business on one sheet
// ══════════════════════════════════════════════════════════════════════
pageFrame(1, "The whole business, one picture", "Six stages. A job enters at Enquiry and leaves as cash in the book. Every stage feeds the reports.");

const sw = 240;
const gap = 25;
const cols = [M, M + sw + gap, M + 2 * (sw + gap)];

const s1 = box({
  x: cols[0], y: 84, w: sw, h: 104, tone: "blue",
  title: "1 - SET UP  (once)",
  body: "Settings holds every rate and dropdown: factory profile, brick sizes,\nprice matrix, material recipes, people, vendors & tippers,\nexpense categories, user access.",
});
const s2 = box({
  x: cols[1], y: 84, w: sw, h: 104, tone: "plain",
  title: "2 - ENQUIRY",
  body: "A recorded call becomes a Lead automatically, or the office writes the\ncustomer straight into the Sales register - one row, the way the\nnotebook is written today.",
});
const s3 = box({
  x: cols[2], y: 84, w: sw, h: 104, tone: "plain",
  title: "3 - ORDER",
  body: "Client + order + advance saved together.\nThe order then sits in one of three states:\nUpcoming - Active - Completed.",
});

const s4 = box({
  x: cols[0], y: 246, w: sw, h: 104, tone: "plain",
  title: "4 - PRODUCE",
  body: "Machine, shift, size, count and the operators who ran it. Bricks age\nProduced - Drying - Curing - Ready. Material stock falls, dies are\ncounted side by side.",
});
const s5 = box({
  x: cols[1], y: 246, w: sw, h: 104, tone: "plain",
  title: "5 - DISPATCH",
  body: "One loading entry covers the whole trip: 6\" and 8\" together, the crew,\nthe tipper (own or rented) and any charges billed to the customer.",
});
const s6 = box({
  x: cols[2], y: 246, w: sw, h: 104, tone: "green",
  title: "6 - SETTLE",
  body: "Customer pays. AVM gets advance then the rent balance. Workers are\nsettled weekly or monthly. Every rupee lands in the cash book.",
});

rightTo(s1, s2);
rightTo(s2, s3);
// wrap from the end of row 1 down to the start of row 2
arrow([[s3.cx, s3.b], [s3.cx, 214], [s4.cx, 214], [s4.cx, s4.y - 2]]);
rightTo(s4, s5);
rightTo(s5, s6);

const reports = box({
  x: M, y: 402, w: RIGHT - M, h: 62, tone: "ink",
  title: "REPORTS  -  Summary | Production | Sales | Expense | Tipper | Tipper P&L | AVM advance & rent | Dies | Mason | Loading | Salary detail | Salary weekly-monthly | Cashbook",
  body: "Pick any date range, filter it, then download the same figures as Excel or a PDF on the factory letterhead.",
  titleSize: 8.2,
});
downTo(s6, reports);
arrow([[s4.cx, s4.b], [s4.cx, reports.y - 2]], { dashed: true });
arrow([[s5.cx, s5.b], [s5.cx, reports.y - 2]], { dashed: true });

note(M, 478, RIGHT - M,
  "Solid arrows are the path a job takes. Dashed arrows mean the stage feeds the reports without the job moving on. " +
  "Nothing on pages 2-7 is a separate app - it is the same entry seen from a different screen: record it once and Production, Stock, Tipper, Salary, Client and Cash all move together.");

// ══════════════════════════════════════════════════════════════════════
// PAGE 2 — set up
// ══════════════════════════════════════════════════════════════════════
pageFrame(2, "Stage 1 - Set up the factory (done once, changed rarely)", "Everything the daily screens offer as a dropdown or fill in as a rate is defined here first.");

const setup = box({
  x: M, y: 150, w: 170, h: 150, tone: "ink",
  title: "SETTINGS",
  body: "Admin only.\n\nChange a rate here and every\nnew entry picks it up - past\nentries keep what they were\nsaved with.",
});

// Two spines: one feeding the left column, a second one in the gutter between
// the columns feeding the right. Routing the right-hand arrows down their own
// spine keeps them from cutting across the left-hand boxes.
const spineX = M + 205;
const spine2X = M + 497;
doc.lineWidth(1.2).strokeColor(ARROW).moveTo(setup.r, setup.cy).lineTo(spineX, setup.cy).stroke();
doc.moveTo(spineX, 86).lineTo(spineX, 470).stroke();
doc.moveTo(spineX, 86).lineTo(spine2X, 86).stroke();
doc.moveTo(spine2X, 86).lineTo(spine2X, 390).stroke();

const items = [
  ["Factory profile", "Name, address, phone, GST, opening cash, cement bags per 1000, week start & settlement day."],
  ["Brick sizes", "6\", 6\"H, 8\" - add more any time. Each carries its own day and night piece-rate."],
  ["Construction types", "Room, Compound, Godown - the 'Room / Comp' column of the register."],
  ["Price matrix", "For every size x type: sell price, mason rate, production cost. The register auto-fills the rate from here."],
  ["Raw materials + recipe", "Cement, flyash, powder, chips... how much each 1000 bricks eats, opening stock and reorder level."],
  ["People", "Operators, masons, loaders, employees - pay type (daily / monthly) and settlement cadence."],
  ["Vendors & tippers", "AVM and others. Every tipper is flagged OWN or RENTED - that one flag drives the whole money split later."],
  ["Expense categories", "Cement, Diesel, EB, Land Rent, Salary, Interest, Debt, Tipper Due, Ranjith Taken, Mould (Die)..."],
  ["Users & access", "Who may open which section. A separate 'revenue' permission hides profit and cash totals."],
];

const colX = [spineX + 30, spine2X + 22];
items.forEach((it, i) => {
  const c = i < 5 ? 0 : 1;
  const r = i < 5 ? i : i - 5;
  const y = 96 + r * 76;
  const b = box({ x: colX[c], y, w: 230, h: 62, title: it[0], body: it[1], tone: "blue", align: "left", titleSize: 8.6 });
  arrow([[c === 0 ? spineX : spine2X, b.cy], [b.x - 2, b.cy]]);
});

note(M, 330, 170, "Run once at go-live. After that it is only touched when a price changes or a new worker joins.", "amber");

// ══════════════════════════════════════════════════════════════════════
// PAGE 3 — enquiry to order
// ══════════════════════════════════════════════════════════════════════
pageFrame(3, "Stage 2 & 3 - From enquiry to a live order", "Two ways in. Both end at the same place: a customer with an order and a status.");

caption(M, 76, 300, "ROUTE A - the recorded call, handled for you", "#1233B8", 8);
const a1 = box({ x: M, y: 92, w: 132, h: 56, tone: "plain", title: "Customer calls", body: "Call is recorded" });
const a2 = box({ x: M + 162, y: 92, w: 132, h: 56, tone: "plain", title: "Transcriber app", body: "Reads name, place,\nsize, qty, budget" });
const a3 = box({ x: M + 324, y: 92, w: 148, h: 56, tone: "blue", title: "Lead import API", body: "Same call sent twice\nupdates, never duplicates" });
const a4 = box({ x: M + 502, y: 92, w: 132, h: 56, tone: "plain", title: "Leads screen", body: "Follow-up date,\nquotation stage" });
rightTo(a1, a2); rightTo(a2, a3); rightTo(a3, a4);

caption(M, 178, 300, "ROUTE B - the notebook, typed once", "#B0111E", 8);
const b1 = box({ x: M, y: 194, w: 132, h: 60, tone: "plain", title: "Walk-in or phone", body: "Owner writes it down" });
const b2 = box({
  x: M + 162, y: 194, w: 310, h: 60, tone: "red",
  title: "SALES REGISTER - one wide row",
  body: "Date | Number | Name | Location | Size | Room-Comp | Rate | Total bricks | Total amount | Advance | Balance | Note",
  bodySize: 6.9,
});
rightTo(b1, b2);

const merge = box({
  x: M + 250, y: 300, w: 260, h: 70, tone: "ink",
  title: "CLIENT  +  ORDER  +  ADVANCE",
  body: "Saved in one action. A repeat customer is matched on\ntheir phone number instead of being created twice.",
});
arrow([[a4.cx, a4.b], [a4.cx, 278], [merge.r - 40, 278], [merge.r - 40, merge.y - 2]], { label: "convert" });
arrow([[b2.cx, b2.b], [b2.cx, 278], [merge.x + 40, 278], [merge.x + 40, merge.y - 2]]);

const st1 = box({ x: M + 96, y: 420, w: 150, h: 52, tone: "blue", title: "UPCOMING", body: "Nothing delivered and the\ndelivery date is still ahead" });
const st2 = box({ x: M + 286, y: 420, w: 150, h: 52, tone: "amber", title: "ACTIVE", body: "Part delivered, or due\nnow / overdue" });
const st3 = box({ x: M + 476, y: 420, w: 150, h: 52, tone: "green", title: "COMPLETED", body: "Everything ordered\nhas gone out" });
arrow([[merge.cx, merge.b], [merge.cx, 400], [st1.cx, 400], [st1.cx, st1.y - 2]]);
rightTo(st1, st2); rightTo(st2, st3);

const cash1 = box({ x: RIGHT - 150, y: 300, w: 150, h: 70, tone: "green", title: "CASH BOOK  (in)", body: "The advance is booked\nthe moment the row is\nsaved" });
rightTo(merge, cash1);

note(M + 656, 420, RIGHT - M - 656, "Status moves itself as deliveries are recorded - or tap the chip to set it by hand.", "paper");

// ══════════════════════════════════════════════════════════════════════
// PAGE 4 — production
// ══════════════════════════════════════════════════════════════════════
pageFrame(4, "Stage 4 - Making the bricks", "One production entry moves wages, stock and raw material together.");

const i1 = box({ x: M, y: 96, w: 150, h: 48, tone: "blue", title: "Machine + shift", body: "Day or night rate" });
const i2 = box({ x: M, y: 156, w: 150, h: 48, tone: "blue", title: "Brick size + count", body: "Good and damaged" });
const i3 = box({ x: M, y: 216, w: 150, h: 48, tone: "blue", title: "Operators on the line", body: "One or several" });

const prod = box({
  x: M + 208, y: 120, w: 172, h: 124, tone: "ink",
  title: "PRODUCTION ENTRY",
  body: "Piece-rate is taken from the\nsize and shift, then frozen on\nthe entry so a later rate\nchange never rewrites history.",
});
arrow([[i1.r, i1.cy], [M + 186, i1.cy], [M + 186, prod.cy], [prod.x - 2, prod.cy]]);
arrow([[i2.r, i2.cy], [prod.x - 2, prod.cy]]);
arrow([[i3.r, i3.cy], [M + 186, i3.cy], [M + 186, prod.cy], [prod.x - 2, prod.cy]]);

const o1 = box({ x: M + 430, y: 84, w: 180, h: 54, tone: "green", title: "Operator wages", body: "Split across whoever ran the shift" });
const o2 = box({ x: M + 430, y: 150, w: 180, h: 54, tone: "plain", title: "Stock batch created", body: "Coded B-001, B-002..." });
const o3 = box({ x: M + 430, y: 216, w: 180, h: 54, tone: "red", title: "Raw material falls", body: "By recipe - alerts at reorder level" });
arrow([[prod.r, prod.cy], [M + 405, prod.cy], [M + 405, o1.cy], [o1.x - 2, o1.cy]]);
arrow([[prod.r, prod.cy], [o2.x - 2, o2.cy]]);
arrow([[prod.r, prod.cy], [M + 405, prod.cy], [M + 405, o3.cy], [o3.x - 2, o3.cy]]);

const pay = box({ x: RIGHT - 140, y: 84, w: 140, h: 54, tone: "paper", title: "Salary reports & Payroll", body: "" });
rightTo(o1, pay);

caption(M + 430, 274, 400, "the batch then ages by itself:", MUTED, 7.6);
const c1 = box({ x: M + 430, y: 294, w: 78, h: 40, tone: "paper", title: "Produced", body: "day 0", titleSize: 8 });
const c2 = box({ x: M + 516, y: 294, w: 78, h: 40, tone: "paper", title: "Drying", body: "to day 3", titleSize: 8 });
const c3 = box({ x: M + 602, y: 294, w: 78, h: 40, tone: "paper", title: "Curing", body: "to day 10", titleSize: 8 });
const c4 = box({ x: M + 688, y: 294, w: 78, h: 40, tone: "green", title: "READY", body: "sellable", titleSize: 8 });
rightTo(c1, c2); rightTo(c2, c3); rightTo(c3, c4);
arrow([[o2.cx, o2.b], [o2.cx, 286], [c1.cx, 286], [c1.cx, c1.y - 2]]);

// die lane
doc.moveTo(M, 366).lineTo(RIGHT, 366).lineWidth(0.8).strokeColor("#E2E8F0").stroke();
caption(M, 374, 400, "DIES (moulds) - counted alongside production", "#8A5310", 8);

const d1 = box({ x: M, y: 392, w: 138, h: 58, tone: "amber", title: "Buy a new die", body: "Die 1, Die 2, Die 3...\nnumbered for you" });
const d2 = box({ x: M + 168, y: 392, w: 138, h: 58, tone: "plain", title: "Side 1 in service", body: "Opened automatically\non purchase" });
const d3 = box({ x: M + 336, y: 392, w: 138, h: 58, tone: "plain", title: "Turn it over", body: "Side 2 in service" });
const d4 = box({ x: M + 504, y: 392, w: 138, h: 58, tone: "paper", title: "Die finished", body: "Both faces closed -\nbuy the next one" });
const d5 = box({ x: M + 672, y: 392, w: RIGHT - M - 672, h: 58, tone: "red", title: "Expense: Mould (Die)", body: "Booked to the cash\nbook on purchase" });
rightTo(d1, d2); rightTo(d2, d3); rightTo(d3, d4);
arrow([[d4.r, d4.cy], [d5.x - 2, d5.cy]], { dashed: true, label: "next" });
arrow([[d1.cx, d1.b], [d1.cx, 470], [d5.cx, 470], [d5.cx, d5.b + 2]]);

note(M, 486, RIGHT - M, "Bricks pressed between the day a face goes in and the day it comes off are that side's output, so the Dies report can show cost per 1000 bricks for each face. Half the purchase price is charged to each side.", "amber");

// ══════════════════════════════════════════════════════════════════════
// PAGE 5 — loading, tipper, delivery
// ══════════════════════════════════════════════════════════════════════
pageFrame(5, "Stage 5 - Loading, transport and delivery", "The busiest screen: one entry, six things updated. The OWN / RENTED flag decides how the money splits.");

const ready = box({ x: M, y: 100, w: 118, h: 50, tone: "green", title: "READY stock", body: "" });
const load = box({
  x: M + 148, y: 84, w: 214, h: 150, tone: "ink",
  title: "LOADING ENTRY  (one entry)",
  body: "Size lines - 6\" x 2,000 and\n8\" x 900 on the same lorry\n\nLoading crew + rate\nUnloading crew + rate\nTipper used\nCharges: shifting, lintel beam,\ncement...",
  align: "left",
});
arrow([[ready.r, ready.cy], [load.x - 2, load.cy]]);

const w1 = box({ x: M + 396, y: 84, w: 186, h: 46, tone: "green", title: "Wages, per worker", body: "Split by size and phase" });
const w2 = box({ x: M + 396, y: 140, w: 186, h: 46, tone: "blue", title: "Charges billed", body: "Sold = income, bought = expense" });
arrow([[load.r, load.cy], [M + 380, load.cy], [M + 380, w1.cy], [w1.x - 2, w1.cy]]);
arrow([[load.r, load.cy], [M + 380, load.cy], [M + 380, w2.cy], [w2.x - 2, w2.cy]]);

const payroll5 = box({ x: M + 596, y: 84, w: RIGHT - M - 596, h: 46, tone: "paper", title: "Salary reports & Payroll", body: "" });
rightTo(w1, payroll5);

const dec = diamond({ x: M + 380, y: 208, w: 176, h: 76, title: "Tipper\nOWN or RENTED?" });
arrow([[load.r, load.cy], [M + 380, load.cy], [M + 380, 200], [dec.cx, 200], [dec.cx, dec.y - 2]]);

const own1 = box({ x: M + 596, y: 196, w: 170, h: 44, tone: "green", title: "Income on the tipper", body: "Real cash in from the customer" });
const own2 = box({ x: M + 596, y: 248, w: 170, h: 44, tone: "red", title: "Transport expense", body: "Internal - no second cash movement" });
arrow([[dec.r, dec.cy], [M + 578, dec.cy], [M + 578, own1.cy], [own1.x - 2, own1.cy]], { label: "OWN", labelAt: 0.15 });
arrow([[dec.r, dec.cy], [M + 578, dec.cy], [M + 578, own2.cy], [own2.x - 2, own2.cy]]);

const rent1 = box({ x: M + 380, y: 306, w: 216, h: 46, tone: "red", title: "Expense recorded as payable", body: "No cash moves yet" });
const rent2 = box({ x: M + 630, y: 306, w: RIGHT - M - 630, h: 46, tone: "amber", title: "AVM page", body: "Advance, then rent balance" });
arrow([[dec.cx, dec.b], [dec.cx, rent1.y - 2]], { label: "RENTED", labelAt: 0.5 });
rightTo(rent1, rent2);

const pl = box({ x: M + 596, y: 374, w: RIGHT - M - 596, h: 40, tone: "paper", title: "Tipper P&L report", body: "Rent earned less rent paid and running costs", titleSize: 8.5 });
arrow([[own2.cx, own2.b], [own2.cx, pl.y - 2]], { dashed: true });
arrow([[rent2.cx, rent2.b], [rent2.cx, pl.y - 2]], { dashed: true });

const deliv = box({ x: M + 148, y: 306, w: 200, h: 62, tone: "plain", title: "DELIVERY against the order", body: "Moves delivered quantity, order\nstatus and the customer balance" });
arrow([[load.cx, load.b], [load.cx, deliv.y - 2]], { dashed: true, label: "record separately today" });

const mason = box({ x: M, y: 400, w: 300, h: 50, tone: "plain", title: "MASON WORK at the site", body: "Bricks laid x matrix rate = mason wages" });
const wages2 = box({ x: M + 330, y: 400, w: 220, h: 50, tone: "green", title: "Salary reports & Payroll", body: "" });
rightTo(mason, wages2);

note(M, 466, RIGHT - M,
  "Why the split: an own tipper earns the trip money AND charges the brick business for the haul, so the truck can be judged on its own - but only one real payment exists, so only one cash entry is written. " +
  "A rented tipper is a genuine debt to the vendor, so it waits as a payable until the advance or balance is actually handed over on the AVM page. Either way the same rupee is never counted twice.", "amber");

// ══════════════════════════════════════════════════════════════════════
// PAGE 6 — money
// ══════════════════════════════════════════════════════════════════════
pageFrame(6, "Stage 6 - Where all the money meets", "Every screen writes to one ledger. Nothing has to be re-entered in the cash book.");

caption(M, 76, 240, "MONEY IN", "#046C4E", 9);
const in1 = box({ x: M, y: 92, w: 216, h: 40, tone: "green", title: "Order advance", body: "From the register row" });
const in2 = box({ x: M, y: 140, w: 216, h: 40, tone: "green", title: "Customer payment", body: "Balance collected later" });
const in3 = box({ x: M, y: 188, w: 216, h: 40, tone: "green", title: "Own-tipper trip money", body: "Shifting charged to the customer" });
const in4 = box({ x: M, y: 236, w: 216, h: 40, tone: "green", title: "Charges sold on a trip", body: "Lintel beam, cement, shifting" });

const ledger = box({
  x: M + 288, y: 92, w: 210, h: 262, tone: "ink",
  title: "CASH BOOK",
  body: "One line per real movement.\n\nOpening balance\n+  everything on the left\n-  everything on the right\n=  balance today\n\nEach line remembers which\nentry created it, so deleting\nthat entry takes its money\nwith it.",
});
[in1, in2, in3, in4].forEach((b) => arrow([[b.r, b.cy], [M + 262, b.cy], [M + 262, ledger.cy], [ledger.x - 2, ledger.cy]]));

caption(RIGHT - 216, 76, 216, "MONEY OUT", "#B0111E", 9);
const out1 = box({ x: RIGHT - 216, y: 92, w: 216, h: 40, tone: "red", title: "Expenses by category", body: "Cement, diesel, EB, land rent, interest, debt..." });
const out2 = box({ x: RIGHT - 216, y: 140, w: 216, h: 40, tone: "red", title: "AVM advance", body: "Paid before the trips" });
const out3 = box({ x: RIGHT - 216, y: 188, w: 216, h: 40, tone: "red", title: "Tipper due", body: "The rent balance, settled after" });
const out4 = box({ x: RIGHT - 216, y: 236, w: 216, h: 40, tone: "red", title: "Wages & salary paid", body: "Weekly or monthly settlement" });
const out5 = box({ x: RIGHT - 216, y: 284, w: 216, h: 40, tone: "red", title: "Die purchase, EMI", body: "" });
[out1, out2, out3, out4, out5].forEach((b) => arrow([[b.x, b.cy], [RIGHT - 242, b.cy], [RIGHT - 242, ledger.cy], [ledger.r + 2, ledger.cy]]));

doc.moveTo(M, 366).lineTo(RIGHT, 366).lineWidth(0.8).strokeColor("#E2E8F0").stroke();
caption(M + 200, 388, 400, "PAYROLL - how a worker's settlement is worked out", "#0B1220", 8);

const p1 = box({ x: M, y: 406, w: 150, h: 56, tone: "plain", title: "Earned", body: "Production shares +\nloading & unloading +\nmason work" });
const p2 = box({ x: M + 180, y: 406, w: 140, h: 56, tone: "amber", title: "less Advances", body: "Money already taken\nduring the period" });
const p3 = box({ x: M + 350, y: 406, w: 140, h: 56, tone: "ink", title: "= Net payable", body: "" });
const p4 = box({ x: M + 520, y: 406, w: 140, h: 56, tone: "green", title: "Settle", body: "Weekly or monthly,\nper worker type" });
const p5 = box({ x: M + 690, y: 406, w: RIGHT - M - 690, h: 56, tone: "red", title: "Cash out", body: "" });
rightTo(p1, p2); rightTo(p2, p3); rightTo(p3, p4); rightTo(p4, p5);
// Return leg runs below the row, up the gutter between Earned and Advances,
// then across the clear band under the ledger - so it crosses nothing.
arrow([[p5.cx, p5.b], [p5.cx, 480], [M + 165, 480], [M + 165, 374], [ledger.cx, 374], [ledger.cx, ledger.b + 2]], { dashed: true });

note(M, 490, 690, "The Salary weekly / monthly report is this same calculation shown for every worker at once - earned, advance taken, paid, still due - which is the sheet wages are actually settled from.", "paper");

// ══════════════════════════════════════════════════════════════════════
// PAGE 7 — reports, tasks, access
// ══════════════════════════════════════════════════════════════════════
pageFrame(7, "Reading it back - reports, tasks and who sees what", "The last stage: turning the day's entries into something you can check, send or act on.");

const src = [
  "Production entries", "Orders & deliveries", "Expenses", "Tipper loads",
  "Mason work", "Loading work", "Wages & advances", "Cash book",
];
src.forEach((s, i) => {
  const y = 92 + i * 42;
  const b = box({ x: M, y, w: 176, h: 34, tone: "paper", title: s, titleSize: 8.4 });
  arrow([[b.r, b.cy], [M + 214, b.cy], [M + 214, 260], [M + 236, 260]]);
});

const rep = box({
  x: M + 240, y: 92, w: 250, h: 336, tone: "ink",
  title: "REPORTS",
  body: "\nPick a period - today, this week,\nthis month, last 30 days, this\nyear, or any two dates.\n\nFilter by client, brick size,\ncategory, vendor, tipper or\nperson.\n\nEvery tab totals by day and\nshows a grand total.",
});

const tabs = [
  "Summary - profit at a glance",
  "Production - batches & operators",
  "Sales - orders, paid, pending",
  "Expense - by category & vendor",
  "Tipper - every load",
  "Tipper P&L - per truck",
  "AVM - advance, rent, still due",
  "Dies - sides used & cost per 1000",
  "Mason - site by site",
  "Loading - 6\" and 8\" apart",
  "Salary detail - line by line",
  "Salary weekly / monthly",
  "Cashbook - running balance",
];
// New in this release are picked out in amber.
const isNew = (i) => (i >= 5 && i <= 7) || i === 11;
tabs.forEach((t, i) => {
  const y = 92 + i * 25;
  box({ x: M + 512, y, w: 170, h: 21, tone: isNew(i) ? "amber" : "plain", title: t, titleSize: 7.4, align: "left" });
});
arrow([[rep.r, 200], [M + 510, 200]]);

const xl = box({ x: M + 706, y: 150, w: 64, h: 42, tone: "green", title: "Excel", body: ".xlsx", titleSize: 8.5 });
const pdf = box({ x: M + 706, y: 202, w: 64, h: 42, tone: "red", title: "PDF", body: "letterhead", titleSize: 8.5 });
arrow([[M + 682, 171], [xl.x - 2, xl.cy]]);
arrow([[M + 682, 223], [pdf.x - 2, pdf.cy]]);
caption(M + 512, 425, 260, "amber = new in this release", "#8A5310", 7);

doc.moveTo(M, 450).lineTo(RIGHT, 450).lineWidth(0.8).strokeColor("#E2E8F0").stroke();

const t1 = box({ x: M, y: 462, w: 140, h: 46, tone: "blue", title: "Admin assigns a task", body: "To a manager or telecaller" });
const t2 = box({ x: M + 170, y: 462, w: 120, h: 46, tone: "amber", title: "Work in progress", body: "where it starts" });
const t3 = box({ x: M + 320, y: 462, w: 110, h: 46, tone: "green", title: "Completed", body: "" });
const t4 = box({ x: M + 460, y: 462, w: 170, h: 46, tone: "red", title: "Not completed", body: "will not save without a reason" });
rightTo(t1, t2);
arrow([[t2.r, t2.cy], [t3.x - 2, t3.cy]]);
arrow([[t2.cx, t2.b], [t2.cx, 524], [t4.cx, 524], [t4.cx, t4.b + 2]]);

box({ x: M + 660, y: 462, w: RIGHT - M - 660, h: 46, tone: "paper", title: "Access", body: "Admin grants each area;\n'revenue' hides money totals", titleSize: 8.4 });

doc.end();
if (problems.length) {
  console.error(`
${problems.length} layout problem(s):`);
  for (const p of problems) console.error("  - " + p);
  process.exitCode = 1;
} else {
  console.log("Layout check: every box and arrow sits inside the page.");
}
console.log(`Wrote ${OUT}`);
