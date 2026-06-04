import { prisma } from "./db";

export type ReportKind =
  | "production"
  | "sales"
  | "expense"
  | "tipper"
  | "mason"
  | "loading"
  | "wages"
  | "cashbook";

export type ReportFilter = {
  from: Date;
  to: Date;
  kind: ReportKind;
  clientId?: string;
  brickSizeId?: string;
  categoryId?: string;
  vendorId?: string;
  tipperId?: string;
};

export type LedgerCol = {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  format?: "text" | "money" | "number" | "mono" | "muted";
  width?: string;
};

// A row may have nested children (e.g. add-ons / returns under a delivery).
export type LedgerRow = {
  id: string;
  cells: Record<string, string | number | null>;
  children?: LedgerRow[];
  // optional row-level styling
  emphasis?: "default" | "credit" | "debit";
};

export type LedgerData = {
  title: string;
  unit: string; // e.g. "deliveries", "entries"
  columns: LedgerCol[];
  // Date-grouped sections (newest first), each with its own subtotals
  sections: Array<{
    dateKey: string; // ISO date 'YYYY-MM-DD'
    dateLabel: string;
    rows: LedgerRow[];
    subtotals?: Partial<Record<string, number>>;
  }>;
  totals?: Partial<Record<string, number>>;
  // Money-typed columns we should sum for totals row
  moneyKeys?: string[];
  numberKeys?: string[];
};

const monthShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function dateLabel(d: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yest = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return `${d.getDate()} ${monthShort[d.getMonth()]} ${d.getFullYear()}`;
}

// Group rows by date and return a structured ledger
function groupByDate<T extends { date: Date }>(
  items: T[],
  toRow: (it: T) => LedgerRow,
  moneyKeys: string[],
  numberKeys: string[] = []
) {
  // sort newest first
  const sorted = [...items].sort((a, b) => b.date.getTime() - a.date.getTime());
  const map = new Map<
    string,
    { dateKey: string; dateLabel: string; rows: LedgerRow[]; date: Date }
  >();
  for (const it of sorted) {
    const day = new Date(it.date);
    day.setHours(0, 0, 0, 0);
    const key = isoDate(day);
    if (!map.has(key)) {
      map.set(key, { dateKey: key, dateLabel: dateLabel(day), rows: [], date: day });
    }
    map.get(key)!.rows.push(toRow(it));
  }
  const sections = Array.from(map.values()).map((s) => {
    const sub: Record<string, number> = {};
    for (const r of s.rows) {
      const allRows = [r, ...(r.children ?? [])];
      for (const row of allRows) {
        for (const k of moneyKeys.concat(numberKeys)) {
          if (typeof row.cells[k] === "number") {
            sub[k] = (sub[k] ?? 0) + (row.cells[k] as number);
          }
        }
      }
    }
    return { dateKey: s.dateKey, dateLabel: s.dateLabel, rows: s.rows, subtotals: sub };
  });
  // Grand totals
  const totals: Record<string, number> = {};
  for (const s of sections) {
    for (const [k, v] of Object.entries(s.subtotals ?? {})) {
      totals[k] = (totals[k] ?? 0) + (v as number);
    }
  }
  return { sections, totals };
}

export async function getReportData(filter: ReportFilter): Promise<LedgerData> {
  const dateRange = { gte: filter.from, lte: filter.to };

  switch (filter.kind) {
    case "production": {
      const rows = await prisma.productionEntry.findMany({
        where: {
          date: dateRange,
          ...(filter.brickSizeId ? { brickSizeId: filter.brickSizeId } : {}),
        },
        include: {
          brickSize: true,
          shares: { include: { operator: true } },
          batch: true,
        },
      });
      const moneyKeys = ["wage"];
      const numberKeys = ["bricks", "cement"];
      const { sections, totals } = groupByDate(
        rows,
        (r) => ({
          id: r.id,
          cells: {
            time: `${String(r.date.getHours()).padStart(2, "0")}:${String(r.date.getMinutes()).padStart(2, "0")}`,
            batch: r.batch?.code ?? "—",
            size: r.brickSize.label,
            bricks: r.brickCount,
            cement: r.cementBagsUsed,
            rate: `₹${r.ratePerBrick}`,
            wage: r.totalWage,
            operators: r.shares.map((s) => s.operator.name).join(", "),
          },
        }),
        moneyKeys,
        numberKeys
      );
      return {
        title: "Production",
        unit: "entries",
        moneyKeys,
        numberKeys,
        columns: [
          { key: "time", header: "Time", format: "mono", width: "60px" },
          { key: "batch", header: "Batch", format: "mono", width: "70px" },
          { key: "size", header: "Size", width: "60px" },
          { key: "bricks", header: "Bricks", format: "number", align: "right" },
          { key: "cement", header: "Cement", format: "number", align: "right" },
          { key: "rate", header: "Rate", format: "muted", align: "right", width: "60px" },
          { key: "wage", header: "Wage", format: "money", align: "right" },
          { key: "operators", header: "Operators" },
        ],
        sections,
        totals,
      };
    }

    case "sales": {
      const deliveries = await prisma.delivery.findMany({
        where: {
          date: dateRange,
          ...(filter.clientId ? { order: { clientId: filter.clientId } } : {}),
        },
        include: {
          order: { include: { client: true, payments: true } },
          items: { include: { brickSize: true, constructionType: true } },
          addOns: true,
          returns: true,
        },
      });
      const moneyKeys = ["amount", "paid", "pending"];
      const numberKeys = ["qty"];

      const items = deliveries.map((d) => {
        // Roll up items, add-ons, returns into a parent + children row
        const itemTotal = d.items.reduce((s, i) => s + i.total, 0);
        const addOnTotal = d.addOns.reduce((s, a) => s + a.total, 0);
        const refundTotal = d.returns.reduce((s, r) => s + r.refundAmount, 0);
        const lineTotal = itemTotal + addOnTotal - refundTotal;
        const orderPaid = d.order.payments.reduce((s, p) => s + p.amount, 0);
        const orderTotal = d.order.payments.length
          ? d.order.payments[0].orderId
          : null;
        // For the per-delivery view we don't have allocation of the order's
        // payments to this specific delivery — show line total and a
        // "running" pending against the order as a hint.
        const orderItemsTotal = d.order ? d.order.payments.reduce((s) => s, 0) : 0;
        void orderTotal;
        void orderItemsTotal;

        const parentRow: LedgerRow = {
          id: d.id,
          cells: {
            client: d.order.client.name,
            location: d.order.client.location ?? "",
            line: d.items
              .map((i) => `${i.quantity.toLocaleString("en-IN")} × ${i.brickSize.label} ${i.constructionType.name}`)
              .join(", "),
            qty: d.items.reduce((s, i) => s + i.quantity, 0),
            rate: d.items[0] ? `₹${d.items[0].pricePerBrick}` : "—",
            amount: lineTotal,
            paid: orderPaid,
            pending: Math.max(0, lineTotal - orderPaid),
            truck: d.truckPlate ?? "—",
          },
          children: [],
        };

        for (const a of d.addOns) {
          parentRow.children!.push({
            id: a.id,
            emphasis: "credit",
            cells: {
              client: "",
              location: "",
              line: `+ ${a.name} (${a.quantity} ${a.unit} @ ₹${a.pricePerUnit})`,
              qty: 0,
              rate: "",
              amount: a.total,
              paid: 0,
              pending: 0,
              truck: "",
            },
          });
        }
        for (const r of d.returns) {
          parentRow.children!.push({
            id: r.id,
            emphasis: "debit",
            cells: {
              client: "",
              location: "",
              line: `− Return ${r.brickCount.toLocaleString("en-IN")} bricks${r.notes ? ` (${r.notes})` : ""}`,
              qty: -r.brickCount,
              rate: "",
              amount: -r.refundAmount,
              paid: 0,
              pending: 0,
              truck: "",
            },
          });
        }
        return { date: d.date, row: parentRow };
      });

      const { sections, totals } = groupByDate(
        items,
        (it) => it.row,
        moneyKeys,
        numberKeys
      );

      return {
        title: "Sales (Deliveries)",
        unit: "deliveries",
        moneyKeys,
        numberKeys,
        columns: [
          { key: "client", header: "Client", format: "text", width: "150px" },
          { key: "location", header: "Site", format: "muted", width: "100px" },
          { key: "line", header: "Items" },
          { key: "qty", header: "Qty", format: "number", align: "right" },
          { key: "rate", header: "Rate", format: "muted", align: "right", width: "70px" },
          { key: "amount", header: "Amount", format: "money", align: "right" },
          { key: "paid", header: "Paid", format: "money", align: "right" },
          { key: "pending", header: "Pending", format: "money", align: "right" },
          { key: "truck", header: "Truck", format: "mono", width: "100px" },
        ],
        sections,
        totals,
      };
    }

    case "expense": {
      const rows = await prisma.expense.findMany({
        where: {
          date: dateRange,
          ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
          ...(filter.vendorId ? { vendorId: filter.vendorId } : {}),
        },
        include: { category: true, vendor: true },
      });
      const moneyKeys = ["amount"];
      const { sections, totals } = groupByDate(
        rows,
        (e) => ({
          id: e.id,
          emphasis: "debit",
          cells: {
            title: e.title,
            category: e.category.name,
            vendor: e.vendor?.name ?? "—",
            notes: e.notes ?? "",
            amount: e.amount,
          },
        }),
        moneyKeys
      );
      return {
        title: "Expenses",
        unit: "entries",
        moneyKeys,
        columns: [
          { key: "title", header: "Title", format: "text" },
          { key: "category", header: "Category", format: "muted" },
          { key: "vendor", header: "Vendor", format: "muted" },
          { key: "notes", header: "Notes", format: "muted" },
          { key: "amount", header: "Amount", format: "money", align: "right" },
        ],
        sections,
        totals,
      };
    }

    case "tipper": {
      const rows = await prisma.tipperLoad.findMany({
        where: {
          date: dateRange,
          ...(filter.tipperId ? { tipperId: filter.tipperId } : {}),
          ...(filter.vendorId ? { vendorId: filter.vendorId } : {}),
        },
        include: { tipper: true, vendor: true, brickSize: true },
      });
      const moneyKeys = ["earned", "paid"];
      const numberKeys = ["qty"];
      const { sections, totals } = groupByDate(
        rows,
        (l) => ({
          id: l.id,
          cells: {
            tipper: l.tipper.name,
            owner: l.tipper.ownership === "own" ? "RD" : l.vendor?.name ?? "vendor",
            load: l.loadType === "bricks" ? `${l.brickSize?.label ?? "—"} bricks` : l.materialName ?? "Material",
            qty: l.quantity,
            route: `${l.fromLocation ?? "—"} → ${l.toLocation ?? "—"}`,
            earned: l.rentDirection === "in" ? l.rentAmount : 0,
            paid: l.rentDirection === "out" ? l.rentAmount : 0,
          },
        }),
        moneyKeys,
        numberKeys
      );
      return {
        title: "Tipper loads",
        unit: "loads",
        moneyKeys,
        numberKeys,
        columns: [
          { key: "tipper", header: "Tipper", format: "text" },
          { key: "owner", header: "Owner", format: "muted", width: "80px" },
          { key: "load", header: "Load" },
          { key: "qty", header: "Qty", format: "number", align: "right" },
          { key: "route", header: "Route", format: "muted" },
          { key: "earned", header: "Earned", format: "money", align: "right" },
          { key: "paid", header: "Paid", format: "money", align: "right" },
        ],
        sections,
        totals,
      };
    }

    case "mason": {
      const settings = await prisma.settings.findUnique({ where: { id: "default" } });
      const cementPer1000 = settings?.cementBagsPer1000 ?? 18;
      const rows = await prisma.masonWork.findMany({
        where: {
          date: dateRange,
          ...(filter.brickSizeId ? { brickSizeId: filter.brickSizeId } : {}),
        },
        include: { mason: true, brickSize: true, constructionType: true },
      });
      const moneyKeys = ["total"];
      const numberKeys = ["bricks", "cement"];
      const { sections, totals } = groupByDate(
        rows,
        (w) => ({
          id: w.id,
          cells: {
            mason: w.mason.name,
            site: w.siteName,
            type: `${w.brickSize.label} · ${w.constructionType.name}`,
            bricks: w.brickCount,
            cement: Math.round((w.brickCount / 1000) * cementPer1000 * 10) / 10,
            rate: `₹${w.ratePerBrick}`,
            total: w.totalAmount,
          },
        }),
        moneyKeys,
        numberKeys
      );
      return {
        title: "Mason work",
        unit: "entries",
        moneyKeys,
        numberKeys,
        columns: [
          { key: "mason", header: "Mason", format: "text" },
          { key: "site", header: "Site", format: "text" },
          { key: "type", header: "Size · Type", format: "muted" },
          { key: "bricks", header: "Bricks", format: "number", align: "right" },
          { key: "cement", header: "Cement bags", format: "number", align: "right" },
          { key: "rate", header: "Rate", format: "muted", align: "right", width: "60px" },
          { key: "total", header: "Total", format: "money", align: "right" },
        ],
        sections,
        totals,
      };
    }

    case "loading": {
      const rows = await prisma.loadingWork.findMany({
        where: { date: dateRange },
        include: { loader: true, brickSize: true },
      });
      const moneyKeys = ["total"];
      const numberKeys = ["bricks"];
      const { sections, totals } = groupByDate(
        rows,
        (w) => ({
          id: w.id,
          cells: {
            loader: w.loader.name,
            size: w.brickSize?.label ?? "Mixed",
            bricks: w.brickCount,
            rate: `₹${w.ratePerBrick}`,
            total: w.totalAmount,
          },
        }),
        moneyKeys,
        numberKeys
      );
      return {
        title: "Loading wages",
        unit: "entries",
        moneyKeys,
        numberKeys,
        columns: [
          { key: "loader", header: "Loader", format: "text" },
          { key: "size", header: "Size", format: "muted" },
          { key: "bricks", header: "Bricks", format: "number", align: "right" },
          { key: "rate", header: "Rate", format: "muted", align: "right", width: "60px" },
          { key: "total", header: "Total", format: "money", align: "right" },
        ],
        sections,
        totals,
      };
    }

    case "wages": {
      const advances = await prisma.advance.findMany({
        where: { date: dateRange },
        include: { operator: true, mason: true, loader: true, employee: true },
      });
      const payouts = await prisma.employeePayout.findMany({
        where: { date: dateRange },
        include: { employee: true },
      });
      type Entry = {
        id: string;
        date: Date;
        person: string;
        role: string;
        kind: string;
        notes: string;
        settled: string;
        amount: number;
      };
      const entries: Entry[] = [
        ...advances.map((a) => ({
          id: a.id,
          date: a.date,
          person: a.operator?.name ?? a.mason?.name ?? a.loader?.name ?? a.employee?.name ?? "—",
          role: a.personType,
          kind: "Advance",
          notes: a.notes ?? "",
          settled: a.settled ? "Yes" : "Open",
          amount: a.amount,
        })),
        ...payouts.map((p) => ({
          id: p.id,
          date: p.date,
          person: p.employee.name,
          role: "employee",
          kind: "Salary",
          notes: p.notes ?? "",
          settled: "Paid",
          amount: p.netPaid,
        })),
      ];
      const moneyKeys = ["amount"];
      const { sections, totals } = groupByDate(
        entries,
        (e) => ({
          id: e.id,
          emphasis: "debit",
          cells: {
            person: e.person,
            role: e.role,
            kind: e.kind,
            notes: e.notes,
            settled: e.settled,
            amount: e.amount,
          },
        }),
        moneyKeys
      );
      return {
        title: "Wages & advances",
        unit: "entries",
        moneyKeys,
        columns: [
          { key: "person", header: "Person", format: "text" },
          { key: "role", header: "Role", format: "muted" },
          { key: "kind", header: "Kind" },
          { key: "notes", header: "Notes", format: "muted" },
          { key: "settled", header: "Status", format: "muted" },
          { key: "amount", header: "Amount", format: "money", align: "right" },
        ],
        sections,
        totals,
      };
    }

    case "cashbook": {
      const rows = await prisma.cashEntry.findMany({
        where: { date: dateRange },
      });
      const moneyKeys = ["in", "out"];
      // Compute a running balance from a known starting point
      const settings = await prisma.settings.findUnique({ where: { id: "default" } });
      const earlierIn = await prisma.cashEntry.aggregate({
        _sum: { amount: true },
        where: { direction: "in", date: { lt: filter.from } },
      });
      const earlierOut = await prisma.cashEntry.aggregate({
        _sum: { amount: true },
        where: { direction: "out", date: { lt: filter.from } },
      });
      const opening =
        (settings?.cashOpening ?? 0) +
        (earlierIn._sum.amount ?? 0) -
        (earlierOut._sum.amount ?? 0);

      // Build chronological, then running balance per row
      const sortedAsc = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
      let running = opening;
      const balanceById = new Map<string, number>();
      for (const c of sortedAsc) {
        running += c.direction === "in" ? c.amount : -c.amount;
        balanceById.set(c.id, running);
      }

      const { sections, totals } = groupByDate(
        rows,
        (c) => ({
          id: c.id,
          emphasis: c.direction === "in" ? "credit" : "debit",
          cells: {
            title: c.title,
            category: c.category,
            source: c.source,
            method: c.method,
            in: c.direction === "in" ? c.amount : 0,
            out: c.direction === "out" ? c.amount : 0,
            balance: balanceById.get(c.id) ?? 0,
          },
        }),
        moneyKeys
      );

      return {
        title: "Cashbook",
        unit: "entries",
        moneyKeys: ["in", "out", "balance"],
        columns: [
          { key: "title", header: "Title", format: "text" },
          { key: "category", header: "Category", format: "muted" },
          { key: "source", header: "Source", format: "muted" },
          { key: "method", header: "Method", format: "muted" },
          { key: "in", header: "In", format: "money", align: "right" },
          { key: "out", header: "Out", format: "money", align: "right" },
          { key: "balance", header: "Balance", format: "money", align: "right" },
        ],
        sections,
        totals,
      };
    }
  }
}

// ─── Summary tab data ─────────────────────────────────────────────────

export type SummaryData = {
  netProfit: number;
  income: { total: number; sales: number; transport: number };
  expense: {
    total: number;
    labour: number;
    materials: number;
    transport: number;
    other: number;
  };
  topCategories: Array<{ name: string; amount: number; pct: number }>;
  staffPayments: { salary: number; paid: number; pending: number };
  transportBusiness: { income: number; expense: number; profit: number; loads: number };
};

export async function getSummaryData(from: Date, to: Date): Promise<SummaryData> {
  const dateRange = { gte: from, lte: to };

  const [cashEntries, expenses, tipperLoads, payouts] = await Promise.all([
    prisma.cashEntry.findMany({ where: { date: dateRange } }),
    prisma.expense.findMany({
      where: { date: dateRange },
      include: { category: true },
    }),
    prisma.tipperLoad.findMany({ where: { date: dateRange }, include: { tipper: true } }),
    prisma.employeePayout.findMany({
      where: { date: dateRange },
      include: { employee: true },
    }),
  ]);

  const sales = cashEntries
    .filter((c) => c.direction === "in" && c.source === "sale")
    .reduce((s, c) => s + c.amount, 0);
  const transportIncome = cashEntries
    .filter((c) => c.direction === "in" && c.source === "tipper")
    .reduce((s, c) => s + c.amount, 0);
  const totalIncome = sales + transportIncome;

  const labourCats = ["Salary", "Bonus", "Wages"];
  const materialCats = ["Cement", "Flyash", "Powder", "Chips", "Admixer", "Sludge"];
  const transportCats = ["Diesel", "Oil", "Spares", "EMI", "Bearings", "Tipper rent"];

  let labour = 0,
    materials = 0,
    transport = 0,
    other = 0;
  // From wages source
  for (const c of cashEntries) {
    if (c.direction !== "out") continue;
    if (c.source === "wage" || c.source === "advance") labour += c.amount;
    else if (c.source === "tipper") transport += c.amount;
    else if (materialCats.includes(c.category)) materials += c.amount;
    else if (transportCats.includes(c.category)) transport += c.amount;
    else if (labourCats.includes(c.category)) labour += c.amount;
    else other += c.amount;
  }
  const totalExpense = labour + materials + transport + other;

  // Top categories by total
  const catMap: Record<string, number> = {};
  for (const e of expenses) catMap[e.category.name] = (catMap[e.category.name] ?? 0) + e.amount;
  const topCategoriesAll = Object.entries(catMap)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  const maxCat = Math.max(...topCategoriesAll.map((c) => c.amount), 1);
  const topCategories = topCategoriesAll.map((c) => ({
    ...c,
    pct: Math.round((c.amount / maxCat) * 100),
  }));

  // Staff payment status
  const employees = await prisma.employee.findMany({ where: { active: true } });
  let salary = 0;
  for (const e of employees) {
    if (e.payType === "monthly") salary += e.payRate;
  }
  const paid = payouts.reduce((s, p) => s + p.netPaid, 0);
  const pending = Math.max(0, salary - paid);

  // Transport P&L
  const tIncome = tipperLoads
    .filter((l) => l.rentDirection === "in")
    .reduce((s, l) => s + l.rentAmount, 0);
  const tExpense = tipperLoads
    .filter((l) => l.rentDirection === "out")
    .reduce((s, l) => s + l.rentAmount, 0);
  const tipperOwnExpense = cashEntries
    .filter(
      (c) =>
        c.direction === "out" &&
        ["Diesel", "Oil", "Spares", "EMI"].includes(c.category)
    )
    .reduce((s, c) => s + c.amount, 0);

  return {
    netProfit: totalIncome - totalExpense,
    income: { total: totalIncome, sales, transport: transportIncome },
    expense: { total: totalExpense, labour, materials, transport, other },
    topCategories,
    staffPayments: { salary, paid, pending },
    transportBusiness: {
      income: tIncome,
      expense: tExpense + tipperOwnExpense,
      profit: tIncome - (tExpense + tipperOwnExpense),
      loads: tipperLoads.length,
    },
  };
}
