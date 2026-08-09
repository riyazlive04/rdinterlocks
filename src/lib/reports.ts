import { prisma } from "./db";

export type ReportKind =
  | "production"
  | "sales"
  | "expense"
  | "tipper"
  | "tipperpl"
  | "avm"
  | "die"
  | "mason"
  | "loading"
  | "wages"
  | "salarysummary"
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
  personId?: string;
  // Salary summary only: roll the range up by week or by month.
  period?: "week" | "month";
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
  // What the per-section subtotal row is called. Date-grouped reports say
  // "Day total"; the summary reports group by week / month / vendor instead.
  subtotalLabel?: string;
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
            batch: r.batch?.code ?? "-",
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
          { key: "wage", header: "Salary", format: "money", align: "right" },
          { key: "operators", header: "Operators" },
        ],
        sections,
        totals,
      };
    }

    case "sales": {
      // Order-based sales ledger: every order in the range shows up — whether
      // or not it has been delivered yet — with ordered value, paid and
      // pending. Deliveries, add-ons and returns hang under each order as
      // sub-detail rows. Money math mirrors the client-detail page exactly
      // (Amount = ordered + add-ons − returns; Pending = Amount − Paid).
      const orders = await prisma.order.findMany({
        where: {
          date: dateRange,
          ...(filter.clientId ? { clientId: filter.clientId } : {}),
          ...(filter.brickSizeId
            ? { items: { some: { brickSizeId: filter.brickSizeId } } }
            : {}),
        },
        include: {
          client: true,
          items: { include: { brickSize: true, constructionType: true } },
          payments: true,
          deliveries: {
            include: {
              items: { include: { brickSize: true } },
              addOns: true,
              returns: true,
            },
            orderBy: { date: "desc" },
          },
        },
      });
      const moneyKeys = ["amount", "paid", "pending"];
      const numberKeys = ["qty"];

      const shortDate = (d: Date) => `${d.getDate()} ${monthShort[d.getMonth()]}`;

      const items = orders.map((o) => {
        const orderTotal = o.items.reduce((s, i) => s + i.total, 0);
        const orderedQty = o.items.reduce((s, i) => s + i.quantity, 0);
        const addOnTotal = o.deliveries.reduce(
          (s, d) => s + d.addOns.reduce((x, a) => x + a.total, 0),
          0
        );
        const refundTotal = o.deliveries.reduce(
          (s, d) => s + d.returns.reduce((x, r) => x + r.refundAmount, 0),
          0
        );
        const paid = o.payments.reduce((s, p) => s + p.amount, 0);
        // Total billed value of the order (add-ons carry on children so the
        // grand total still adds up; keep the parent on the plain order value).
        const billed = orderTotal + addOnTotal - refundTotal;

        const parentRow: LedgerRow = {
          id: o.id,
          cells: {
            client: o.client.name,
            location: o.client.location ?? "",
            line: o.items
              .map(
                (i) =>
                  `${i.quantity.toLocaleString("en-IN")} × ${i.brickSize.label} ${i.constructionType.name}`
              )
              .join(", "),
            qty: orderedQty,
            rate: o.items[0] ? `₹${o.items[0].pricePerBrick}` : "-",
            amount: orderTotal,
            paid,
            pending: Math.max(0, billed - paid),
            status: o.status,
          },
          children: [],
        };

        // Deliveries (informational — money stays on the order/add-on rows so
        // nothing is double-counted in the totals).
        for (const d of o.deliveries) {
          const delivered = d.items.reduce((s, i) => s + i.quantity, 0);
          parentRow.children!.push({
            id: `d-${d.id}`,
            cells: {
              client: "",
              location: "",
              line: `→ Delivered ${delivered.toLocaleString("en-IN")} bricks · ${shortDate(
                d.date
              )}${d.truckPlate ? ` · ${d.truckPlate}` : ""}`,
              qty: 0,
              rate: "",
              amount: 0,
              paid: 0,
              pending: 0,
              status: "",
            },
          });
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
                status: "",
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
                line: `− Return ${r.brickCount.toLocaleString("en-IN")} bricks${
                  r.notes ? ` (${r.notes})` : ""
                }`,
                qty: 0,
                rate: "",
                amount: -r.refundAmount,
                paid: 0,
                pending: 0,
                status: "",
              },
            });
          }
        }
        return { date: o.date, row: parentRow };
      });

      const { sections, totals } = groupByDate(
        items,
        (it) => it.row,
        moneyKeys,
        numberKeys
      );

      return {
        title: "Sales (Orders)",
        unit: "orders",
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
          { key: "status", header: "Status", format: "muted", width: "90px" },
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
            vendor: e.vendor?.name ?? "-",
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
      const numberKeys = ["qty", "returned"];
      const { sections, totals } = groupByDate(
        rows,
        (l) => ({
          id: l.id,
          cells: {
            tipper: l.tipper.name,
            owner: l.tipper.ownership === "own" ? "RD" : l.vendor?.name ?? "vendor",
            load: l.loadType === "bricks" ? `${l.brickSize?.label ?? "-"} bricks` : l.materialName ?? "Material",
            qty: l.quantity,
            returned: l.returnBricks,
            route: `${l.fromLocation ?? "-"} → ${l.toLocation ?? "-"}`,
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
          { key: "returned", header: "Returned", format: "number", align: "right" },
          { key: "route", header: "Route", format: "muted" },
          { key: "earned", header: "Earned", format: "money", align: "right" },
          { key: "paid", header: "Paid", format: "money", align: "right" },
        ],
        sections,
        totals,
      };
    }

    case "tipperpl": {
      // Profit & loss per truck. Income is the rent our own tippers earned;
      // cost is what vendors charged for their trips plus the running expenses
      // tagged to a tipper (diesel, oil, spares, EMI).
      //
      // The transport expense auto-written by a loading entry is deliberately
      // left out: for an own tipper it is the internal counterpart of the
      // income above, and for a rented one the same rupee is already counted as
      // the vendor's rent. Those rows carry a loadGroupId, which is how they
      // are told apart from a real running cost.
      const [tippers, loads, expenses] = await Promise.all([
        prisma.tipper.findMany({
          where: filter.tipperId ? { id: filter.tipperId } : {},
          include: { vendor: true },
          orderBy: { name: "asc" },
        }),
        prisma.tipperLoad.findMany({
          where: {
            date: dateRange,
            ...(filter.tipperId ? { tipperId: filter.tipperId } : {}),
          },
        }),
        prisma.expense.findMany({
          where: {
            date: dateRange,
            tipperId: { not: null },
            loadGroupId: null,
            ...(filter.tipperId ? { tipperId: filter.tipperId } : {}),
          },
          include: { category: true },
        }),
      ]);

      const rows: LedgerRow[] = [];
      const totals: Record<string, number> = { income: 0, rent: 0, running: 0, profit: 0 };

      for (const t of tippers) {
        const mine = loads.filter((l) => l.tipperId === t.id);
        const income = mine
          .filter((l) => l.rentDirection === "in")
          .reduce((s, l) => s + l.rentAmount, 0);
        const rent = mine
          .filter((l) => l.rentDirection === "out")
          .reduce((s, l) => s + l.rentAmount, 0);
        const running = expenses
          .filter((e) => e.tipperId === t.id)
          .reduce((s, e) => s + e.amount, 0);
        const profit = income - rent - running;
        if (mine.length === 0 && running === 0) continue;
        totals.income += income;
        totals.rent += rent;
        totals.running += running;
        totals.profit += profit;

        const row: LedgerRow = {
          id: t.id,
          emphasis: profit >= 0 ? "credit" : "debit",
          cells: {
            tipper: t.name,
            owner: t.ownership === "own" ? "RD (own)" : t.vendor?.name ?? "Rented",
            trips: mine.length,
            income,
            rent,
            running,
            profit,
          },
          children: [],
        };
        // Break the running costs down so a bad month is explainable.
        const byCategory: Record<string, number> = {};
        for (const e of expenses.filter((x) => x.tipperId === t.id)) {
          byCategory[e.category.name] = (byCategory[e.category.name] ?? 0) + e.amount;
        }
        for (const [name, amount] of Object.entries(byCategory)) {
          row.children!.push({
            id: `${t.id}-${name}`,
            emphasis: "debit",
            cells: {
              tipper: "",
              owner: "",
              trips: 0,
              income: 0,
              rent: 0,
              running: 0, // already counted on the parent
              profit: 0,
              detail: `${name} ${Math.round(amount).toLocaleString("en-IN")}`,
            },
          });
        }
        rows.push(row);
      }

      return {
        title: "Tipper profit & loss",
        unit: "tippers",
        moneyKeys: ["income", "rent", "running", "profit"],
        numberKeys: ["trips"],
        subtotalLabel: "Total",
        columns: [
          { key: "tipper", header: "Tipper", format: "text" },
          { key: "owner", header: "Owner", format: "muted", width: "110px" },
          { key: "trips", header: "Trips", format: "number", align: "right" },
          { key: "income", header: "Rent earned", format: "money", align: "right" },
          { key: "rent", header: "Rent paid", format: "money", align: "right" },
          { key: "running", header: "Running cost", format: "money", align: "right" },
          { key: "profit", header: "Profit", format: "money", align: "right" },
          { key: "detail", header: "Cost breakdown", format: "muted" },
        ],
        sections: [
          {
            dateKey: "all",
            dateLabel: "Per tipper",
            rows,
            subtotals: totals,
          },
        ],
        totals,
      };
    }

    case "avm": {
      // What each rented-tipper vendor charged us, what we handed over, and
      // what is still owed. Advance and rent-balance payments are shown apart
      // because the office thinks of them separately.
      const [vendors, loads, payments] = await Promise.all([
        prisma.vendor.findMany({
          where: { ...(filter.vendorId ? { id: filter.vendorId } : {}) },
          orderBy: { name: "asc" },
        }),
        prisma.tipperLoad.findMany({
          where: { date: dateRange, rentDirection: "out" },
        }),
        prisma.vendorPayment.findMany({ where: { date: dateRange } }),
      ]);

      const rows: LedgerRow[] = [];
      const totals: Record<string, number> = {
        trips: 0,
        charged: 0,
        advance: 0,
        settled: 0,
        balance: 0,
      };

      for (const v of vendors) {
        const trips = loads.filter((l) => l.vendorId === v.id);
        const charged = trips.reduce((s, l) => s + l.rentAmount, 0);
        const advance = payments
          .filter((p) => p.vendorId === v.id && p.kind === "advance")
          .reduce((s, p) => s + p.amount, 0);
        const settled = payments
          .filter((p) => p.vendorId === v.id && p.kind === "rent")
          .reduce((s, p) => s + p.amount, 0);
        if (charged === 0 && advance === 0 && settled === 0) continue;
        const balance = charged - advance - settled;
        totals.trips += trips.length;
        totals.charged += charged;
        totals.advance += advance;
        totals.settled += settled;
        totals.balance += balance;
        rows.push({
          id: v.id,
          emphasis: balance > 0 ? "debit" : "credit",
          cells: {
            vendor: v.name,
            trips: trips.length,
            charged,
            advance,
            settled,
            balance,
            note: balance > 0 ? "Still to pay" : balance < 0 ? "Paid ahead" : "Settled",
          },
        });
      }

      return {
        title: "AVM - advance & rent",
        unit: "vendors",
        moneyKeys: ["charged", "advance", "settled", "balance"],
        numberKeys: ["trips"],
        subtotalLabel: "Total",
        columns: [
          { key: "vendor", header: "Vendor", format: "text" },
          { key: "trips", header: "Trips", format: "number", align: "right" },
          { key: "charged", header: "Rent charged", format: "money", align: "right" },
          { key: "advance", header: "Advance paid", format: "money", align: "right" },
          { key: "settled", header: "Balance paid", format: "money", align: "right" },
          { key: "balance", header: "Still due", format: "money", align: "right" },
          { key: "note", header: "Status", format: "muted", width: "110px" },
        ],
        sections: [{ dateKey: "all", dateLabel: "Per vendor", rows, subtotals: totals }],
        totals,
      };
    }

    case "die": {
      // Every die face that was in service during the range, what it cost and
      // how many bricks it pressed. The purchase price is split evenly over the
      // two sides, so a die that never got flipped shows its true cost per brick
      // only once side 2 has run too.
      const [dies, entries] = await Promise.all([
        prisma.die.findMany({
          include: { brickSize: true, vendor: true, usages: { orderBy: { side: "asc" } } },
          orderBy: { purchasedAt: "asc" },
        }),
        prisma.productionEntry.findMany({
          select: { date: true, brickCount: true, brickSizeId: true },
        }),
      ]);

      const rows: LedgerRow[] = [];
      const totals: Record<string, number> = { cost: 0, bricks: 0 };

      for (const d of dies) {
        for (const u of d.usages) {
          const start = u.startedAt;
          const end = u.endedAt ?? filter.to;
          // Only show a side that was actually in service inside the range.
          if (start > filter.to || end < filter.from) continue;
          const bricks = entries
            .filter(
              (e) =>
                e.date >= start &&
                e.date <= end &&
                e.date >= filter.from &&
                e.date <= filter.to &&
                (!d.brickSizeId || e.brickSizeId === d.brickSizeId)
            )
            .reduce((s, e) => s + e.brickCount, 0);
          const sideCost = d.cost / 2;
          totals.cost += sideCost;
          totals.bricks += bricks;
          rows.push({
            id: u.id,
            cells: {
              die: d.code,
              side: `Side ${u.side}`,
              size: d.brickSize?.label ?? "any",
              vendor: d.vendor?.name ?? "-",
              from: `${start.getDate()} ${monthShort[start.getMonth()]}`,
              to: u.endedAt
                ? `${u.endedAt.getDate()} ${monthShort[u.endedAt.getMonth()]}`
                : "running",
              bricks,
              cost: Math.round(sideCost),
              per1000: bricks > 0 ? Math.round((sideCost / bricks) * 1000) : 0,
            },
          });
        }
      }

      return {
        title: "Dies used & cost",
        unit: "die sides",
        moneyKeys: ["cost", "per1000"],
        numberKeys: ["bricks"],
        subtotalLabel: "Total",
        columns: [
          { key: "die", header: "Die", format: "text", width: "80px" },
          { key: "side", header: "Side", format: "text", width: "70px" },
          { key: "size", header: "Size", format: "muted", width: "70px" },
          { key: "vendor", header: "Bought from", format: "muted" },
          { key: "from", header: "In", format: "mono", width: "70px" },
          { key: "to", header: "Out", format: "mono", width: "70px" },
          { key: "bricks", header: "Bricks", format: "number", align: "right" },
          { key: "cost", header: "Cost share", format: "money", align: "right" },
          { key: "per1000", header: "₹ / 1000", format: "money", align: "right" },
        ],
        sections: [{ dateKey: "all", dateLabel: "Die by die", rows, subtotals: totals }],
        // per1000 is a rate — summing it would be meaningless.
        totals: { cost: totals.cost, bricks: totals.bricks },
      };
    }

    case "salarysummary":
      return salarySummary(filter);

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
        where: {
          date: dateRange,
          // "none" asks for the entries nobody attributed to a customer —
          // the ones worth chasing up.
          ...(filter.clientId === "none"
            ? { clientId: null }
            : filter.clientId
              ? { clientId: filter.clientId }
              : {}),
        },
        include: {
          loader: true,
          operator: true,
          employee: true,
          brickSize: true,
          client: true,
          tipper: true,
        },
      });
      const moneyKeys = ["total"];
      // Slabs travel with the bricks on one entry but are counted in their own
      // column — adding a slab to a brick tally would make both numbers useless.
      const numberKeys = ["bricks", "slabs"];
      const { sections, totals } = groupByDate(
        rows,
        (w) => {
          const isSlab = w.loadType === "lintel";
          // Unloading reuses the same pieces - count them once (on loading) so
          // the report's totals aren't doubled.
          const counted = w.phase === "unloading" ? 0 : w.brickCount;
          return {
            id: w.id,
            cells: {
              loader:
                (w.loader?.name ?? w.operator?.name ?? w.employee?.name ?? "-") +
                (w.phase === "unloading" ? " · unload" : ""),
              client: w.client?.name ?? "(no customer)",
              tipper: w.tipper?.name ?? "",
              size: isSlab ? "Lintel slab" : w.brickSize?.label ?? "Mixed",
              bricks: isSlab ? 0 : counted,
              slabs: isSlab ? counted : 0,
              rate: `₹${w.ratePerBrick}`,
              total: w.totalAmount,
            },
          };
        },
        moneyKeys,
        numberKeys
      );
      return {
        title: "Loading salary",
        unit: "entries",
        moneyKeys,
        numberKeys,
        columns: [
          { key: "loader", header: "Worker", format: "text" },
          { key: "client", header: "Customer", format: "text" },
          { key: "tipper", header: "Tipper", format: "muted" },
          { key: "size", header: "Size", format: "muted" },
          { key: "bricks", header: "Bricks", format: "number", align: "right" },
          { key: "slabs", header: "Slabs", format: "number", align: "right" },
          { key: "rate", header: "Rate", format: "muted", align: "right", width: "60px" },
          { key: "total", header: "Total", format: "money", align: "right" },
        ],
        sections,
        totals,
      };
    }

    case "wages": {
      // Everything a worker earns or is given: daily earnings (production
      // shares, loading/unloading, mason work) shown as Earned, plus Advances
      // and Salary paid — each in its own column so daily/grand totals add up.
      const [shares, loadingWorks, masonWorks, advances, employeePayouts, workerPayouts, leaves, employees] =
        await Promise.all([
          prisma.productionShare.findMany({
            where: { productionEntry: { date: dateRange } },
            include: { operator: true, productionEntry: true },
          }),
          prisma.loadingWork.findMany({
            where: { date: dateRange },
            include: { loader: true, operator: true, employee: true },
          }),
          prisma.masonWork.findMany({ where: { date: dateRange }, include: { mason: true } }),
          prisma.advance.findMany({
            where: { date: dateRange },
            include: { operator: true, mason: true, loader: true, employee: true },
          }),
          prisma.employeePayout.findMany({
            where: { date: dateRange },
            include: { employee: true },
          }),
          prisma.workerPayout.findMany({
            where: { date: dateRange },
            include: { operator: true, mason: true, loader: true, employee: true },
          }),
          prisma.leave.findMany({
            where: { date: dateRange },
            include: { operator: true, mason: true, loader: true, employee: true },
          }),
          prisma.employee.findMany({ where: { active: true } }),
        ]);

      type Entry = {
        id: string;
        pid: string | null;
        date: Date;
        person: string;
        role: string;
        kind: string;
        status: string;
        notes: string;
        earned: number | null;
        advance: number | null;
        paid: number | null;
        leave?: number | null;
      };

      let entries: Entry[] = [
        ...shares.map((s) => ({
          id: `ps-${s.id}`,
          pid: s.operatorId,
          date: s.productionEntry.date,
          person: s.operator.name,
          role: "operator",
          kind: "Production",
          status: "Earned",
          notes: `${s.brickCount.toLocaleString("en-IN")} bricks`,
          earned: s.amount,
          advance: null,
          paid: null,
        })),
        ...loadingWorks.map((w) => ({
          id: `lw-${w.id}`,
          pid: w.loaderId ?? w.operatorId ?? w.employeeId,
          date: w.date,
          person: w.loader?.name ?? w.operator?.name ?? w.employee?.name ?? "-",
          role: w.workerType,
          kind: w.phase === "unloading" ? "Unloading" : "Loading",
          status: "Earned",
          notes: "",
          earned: w.totalAmount,
          advance: null,
          paid: null,
        })),
        ...masonWorks.map((w) => ({
          id: `mw-${w.id}`,
          pid: w.masonId,
          date: w.date,
          person: w.mason.name,
          role: "mason",
          kind: "Mason",
          status: "Earned",
          notes: w.siteName,
          earned: w.totalAmount,
          advance: null,
          paid: null,
        })),
        ...advances.map((a) => ({
          id: `ad-${a.id}`,
          pid: a.operatorId ?? a.masonId ?? a.loaderId ?? a.employeeId,
          date: a.date,
          person: a.operator?.name ?? a.mason?.name ?? a.loader?.name ?? a.employee?.name ?? "-",
          role: a.personType,
          kind: "Advance",
          status: a.settled ? "Settled" : "Pending",
          notes: a.notes ?? "",
          earned: null,
          advance: a.amount,
          paid: null,
        })),
        ...employeePayouts.map((p) => ({
          id: `ep-${p.id}`,
          pid: p.employeeId,
          date: p.date,
          person: p.employee.name,
          role: "employee",
          kind: "Salary paid",
          status: "Paid",
          notes: p.notes ?? "",
          earned: null,
          advance: null,
          paid: p.netPaid,
        })),
        ...workerPayouts.map((p) => ({
          id: `wp-${p.id}`,
          pid: p.operatorId ?? p.masonId ?? p.loaderId ?? p.employeeId,
          date: p.date,
          person: p.operator?.name ?? p.mason?.name ?? p.loader?.name ?? p.employee?.name ?? "-",
          role: p.personType,
          kind: "Salary paid",
          status: "Paid",
          notes: p.notes ?? "",
          earned: null,
          advance: null,
          paid: p.netPaid,
        })),
      ];

      // Employee accrued salary for the range (running, before payout). Daily
      // pay = rate × working days (range days − leaves); monthly = full rate.
      const daysInRange = Math.max(
        1,
        Math.round((filter.to.getTime() - filter.from.getTime()) / 86400000) + 1
      );
      const leaveCount = (empId: string) => leaves.filter((l) => l.employeeId === empId).length;
      for (const e of employees) {
        let earned = 0;
        let note = "";
        if (e.payType === "monthly") {
          earned = e.payRate;
          note = "monthly salary";
        } else if (e.payType === "daily") {
          const lv = leaveCount(e.id);
          const wd = Math.max(0, daysInRange - lv);
          earned = e.payRate * wd;
          note = `${wd} day${wd === 1 ? "" : "s"} × ₹${e.payRate}${lv ? ` · ${lv} leave` : ""}`;
        }
        if (earned > 0) {
          entries.push({
            id: `ea-${e.id}`,
            pid: e.id,
            date: filter.to,
            person: e.name,
            role: e.role,
            kind: "Salary",
            status: "Accrued",
            notes: note,
            earned,
            advance: null,
            paid: null,
          });
        }
      }

      // Leave entries (date-wise) for any worker.
      for (const l of leaves) {
        entries.push({
          id: `lv-${l.id}`,
          pid: l.operatorId ?? l.loaderId ?? l.masonId ?? l.employeeId,
          date: l.date,
          person: l.operator?.name ?? l.loader?.name ?? l.mason?.name ?? l.employee?.name ?? "-",
          role: l.personType,
          kind: "Leave",
          status: "Leave",
          notes: l.reason ?? "",
          earned: null,
          advance: null,
          paid: null,
          leave: 1,
        });
      }

      if (filter.personId) entries = entries.filter((e) => e.pid === filter.personId);

      const moneyKeys = ["earned", "advance", "paid"];
      const numberKeys = ["leave"];
      const { sections, totals } = groupByDate(
        entries,
        (e) => ({
          id: e.id,
          cells: {
            person: e.person,
            role: e.role,
            kind: e.kind,
            status: e.status,
            notes: e.notes,
            leave: e.leave ?? null,
            earned: e.earned,
            advance: e.advance,
            paid: e.paid,
          },
        }),
        moneyKeys,
        numberKeys
      );
      return {
        title: "Earnings, advances & leave",
        unit: "entries",
        moneyKeys,
        numberKeys,
        columns: [
          { key: "person", header: "Person", format: "text" },
          { key: "role", header: "Role", format: "muted" },
          { key: "kind", header: "Kind" },
          { key: "status", header: "Status", format: "muted" },
          { key: "notes", header: "Notes", format: "muted" },
          { key: "leave", header: "Leave", format: "number", align: "right" },
          { key: "earned", header: "Earned", format: "money", align: "right" },
          { key: "advance", header: "Advance", format: "money", align: "right" },
          { key: "paid", header: "Paid", format: "money", align: "right" },
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

// ─── Labour salary: weekly / monthly roll-up ──────────────────────────

// Monday of the week a date falls in.
function startOfWeek(d: Date) {
  const w = new Date(d);
  w.setHours(0, 0, 0, 0);
  w.setDate(w.getDate() - ((w.getDay() - 1 + 7) % 7));
  return w;
}

function startOfMonthOf(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function dayCount(from: Date, to: Date) {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
}

/**
 * One row per worker per week (or per month): everything they earned, what
 * they took as advance, what has been paid out, and what is still owed.
 *
 * This is the sheet the office settles wages from — the per-entry Salary report
 * is the detail behind it.
 */
async function salarySummary(filter: ReportFilter): Promise<LedgerData> {
  const period = filter.period ?? "month";
  const dateRange = { gte: filter.from, lte: filter.to };
  const bucketOf = (d: Date) => (period === "week" ? startOfWeek(d) : startOfMonthOf(d));

  const [shares, loadingWorks, masonWorks, advances, employeePayouts, workerPayouts, leaves, employees] =
    await Promise.all([
      prisma.productionShare.findMany({
        where: { productionEntry: { date: dateRange } },
        include: { operator: true, productionEntry: true },
      }),
      prisma.loadingWork.findMany({
        where: { date: dateRange },
        include: { loader: true, operator: true, employee: true },
      }),
      prisma.masonWork.findMany({ where: { date: dateRange }, include: { mason: true } }),
      prisma.advance.findMany({
        where: { date: dateRange },
        include: { operator: true, mason: true, loader: true, employee: true },
      }),
      prisma.employeePayout.findMany({ where: { date: dateRange }, include: { employee: true } }),
      prisma.workerPayout.findMany({
        where: { date: dateRange },
        include: { operator: true, mason: true, loader: true, employee: true },
      }),
      prisma.leave.findMany({ where: { date: dateRange } }),
      prisma.employee.findMany({ where: { active: true } }),
    ]);

  type Cell = {
    bucket: Date;
    pid: string;
    person: string;
    role: string;
    earned: number;
    advance: number;
    paid: number;
    leave: number;
  };
  const cells = new Map<string, Cell>();
  const keyOf = (bucket: Date, pid: string) => `${isoDate(bucket)}|${pid}`;

  const add = (
    date: Date,
    pid: string | null,
    person: string,
    role: string,
    field: "earned" | "advance" | "paid" | "leave",
    amount: number
  ) => {
    if (!pid || amount === 0) return;
    if (filter.personId && pid !== filter.personId) return;
    const bucket = bucketOf(date);
    const k = keyOf(bucket, pid);
    if (!cells.has(k)) {
      cells.set(k, { bucket, pid, person, role, earned: 0, advance: 0, paid: 0, leave: 0 });
    }
    cells.get(k)![field] += amount;
  };

  for (const s of shares) {
    add(s.productionEntry.date, s.operatorId, s.operator.name, "operator", "earned", s.amount);
  }
  for (const w of loadingWorks) {
    add(
      w.date,
      w.loaderId ?? w.operatorId ?? w.employeeId,
      w.loader?.name ?? w.operator?.name ?? w.employee?.name ?? "-",
      w.workerType,
      "earned",
      w.totalAmount
    );
  }
  for (const w of masonWorks) {
    add(w.date, w.masonId, w.mason.name, "mason", "earned", w.totalAmount);
  }
  for (const a of advances) {
    add(
      a.date,
      a.operatorId ?? a.masonId ?? a.loaderId ?? a.employeeId,
      a.operator?.name ?? a.mason?.name ?? a.loader?.name ?? a.employee?.name ?? "-",
      a.personType,
      "advance",
      a.amount
    );
  }
  for (const p of employeePayouts) {
    add(p.date, p.employeeId, p.employee.name, "employee", "paid", p.netPaid);
  }
  for (const p of workerPayouts) {
    add(
      p.date,
      p.operatorId ?? p.masonId ?? p.loaderId ?? p.employeeId,
      p.operator?.name ?? p.mason?.name ?? p.loader?.name ?? p.employee?.name ?? "-",
      p.personType,
      "paid",
      p.netPaid
    );
  }

  // Salaried staff don't earn per piece, so accrue their pay across the period.
  // Monthly pay is spread at rate/30 a day; daily pay counts working days only,
  // which is what marking a leave is for.
  const bucketsInRange: Array<{ start: Date; end: Date }> = [];
  {
    let cursor = bucketOf(filter.from);
    while (cursor <= filter.to) {
      const next =
        period === "week"
          ? new Date(cursor.getTime() + 7 * 86400000)
          : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const start = cursor < filter.from ? filter.from : cursor;
      const endCandidate = new Date(next.getTime() - 1);
      const end = endCandidate > filter.to ? filter.to : endCandidate;
      bucketsInRange.push({ start, end });
      cursor = next;
    }
  }

  for (const e of employees) {
    if (e.payRate <= 0) continue;
    for (const b of bucketsInRange) {
      const days = dayCount(b.start, b.end);
      const lv = leaves.filter(
        (l) => l.employeeId === e.id && l.date >= b.start && l.date <= b.end
      ).length;
      let earned = 0;
      if (e.payType === "monthly") earned = (e.payRate / 30) * days;
      else if (e.payType === "daily") earned = e.payRate * Math.max(0, days - lv);
      if (earned > 0) add(b.start, e.id, e.name, e.role, "earned", Math.round(earned));
      if (lv > 0) add(b.start, e.id, e.name, e.role, "leave", lv);
    }
  }

  // Leaves for non-employee workers, so the sheet shows who was off.
  for (const l of leaves) {
    if (l.employeeId) continue;
    const pid = l.operatorId ?? l.masonId ?? l.loaderId;
    if (!pid) continue;
    const bucket = bucketOf(l.date);
    const cell = cells.get(keyOf(bucket, pid));
    if (cell) cell.leave += 1;
  }

  // Newest period first, and inside it the biggest earner first.
  const byBucket = new Map<string, Cell[]>();
  for (const c of cells.values()) {
    const k = isoDate(c.bucket);
    if (!byBucket.has(k)) byBucket.set(k, []);
    byBucket.get(k)!.push(c);
  }

  const label = (bucket: Date) => {
    if (period === "month") {
      return `${monthShort[bucket.getMonth()]} ${bucket.getFullYear()}`;
    }
    const end = new Date(bucket.getTime() + 6 * 86400000);
    return `Week ${bucket.getDate()} ${monthShort[bucket.getMonth()]} - ${end.getDate()} ${
      monthShort[end.getMonth()]
    } ${end.getFullYear()}`;
  };

  const sections = Array.from(byBucket.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => {
      const rows: LedgerRow[] = list
        .sort((a, b) => b.earned - a.earned || a.person.localeCompare(b.person))
        .map((c) => ({
          id: `${key}-${c.pid}`,
          cells: {
            person: c.person,
            role: c.role,
            leave: c.leave || null,
            earned: c.earned || null,
            advance: c.advance || null,
            paid: c.paid || null,
            balance: Math.round(c.earned - c.advance - c.paid),
          },
        }));
      const subtotals: Record<string, number> = {};
      for (const r of rows) {
        for (const k of ["earned", "advance", "paid", "balance", "leave"]) {
          const v = r.cells[k];
          if (typeof v === "number") subtotals[k] = (subtotals[k] ?? 0) + v;
        }
      }
      return { dateKey: key, dateLabel: label(list[0].bucket), rows, subtotals };
    });

  const totals: Record<string, number> = {};
  for (const s of sections) {
    for (const [k, v] of Object.entries(s.subtotals)) totals[k] = (totals[k] ?? 0) + v;
  }

  return {
    title: period === "week" ? "Labour salary - weekly" : "Labour salary - monthly",
    unit: "workers",
    moneyKeys: ["earned", "advance", "paid", "balance"],
    numberKeys: ["leave"],
    subtotalLabel: period === "week" ? "Week total" : "Month total",
    columns: [
      { key: "person", header: "Person", format: "text" },
      { key: "role", header: "Role", format: "muted", width: "90px" },
      { key: "leave", header: "Leave", format: "number", align: "right", width: "70px" },
      { key: "earned", header: "Earned", format: "money", align: "right" },
      { key: "advance", header: "Advance", format: "money", align: "right" },
      { key: "paid", header: "Paid", format: "money", align: "right" },
      { key: "balance", header: "Still due", format: "money", align: "right" },
    ],
    sections,
    totals,
  };
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
