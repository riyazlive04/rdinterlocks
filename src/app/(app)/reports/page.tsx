import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, startOfDay, startOfMonth, formatISODate } from "@/lib/format";
import { getReportData, getSummaryData, ReportKind } from "@/lib/reports";
import { LedgerView } from "@/components/ledger";
import { CustomRange } from "./custom-range";
import { ReportFilter } from "./report-filter";
import { requireArea } from "@/lib/auth";
import { can } from "@/lib/access";

const kinds: Array<{ k: ReportKind | "summary"; label: string }> = [
  { k: "summary", label: "Summary" },
  { k: "production", label: "Production" },
  { k: "sales", label: "Sales" },
  { k: "expense", label: "Expense" },
  { k: "tipper", label: "Tipper" },
  { k: "mason", label: "Mason" },
  { k: "loading", label: "Loading" },
  { k: "wages", label: "Salary" },
  { k: "cashbook", label: "Cashbook" },
];

const presetRanges = [
  { k: "today", label: "Today" },
  { k: "week", label: "This week" },
  { k: "month", label: "This month" },
  { k: "30d", label: "Last 30 days" },
  { k: "year", label: "This year" },
  { k: "custom", label: "Custom" },
];

function rangeFor(preset: string, fromStr?: string, toStr?: string) {
  const today = startOfDay();
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  switch (preset) {
    case "today":
      return { from: today, to: end };
    case "week": {
      const w = new Date(today);
      const diff = (w.getDay() - 1 + 7) % 7;
      w.setDate(w.getDate() - diff);
      return { from: w, to: end };
    }
    case "month":
      return { from: startOfMonth(), to: end };
    case "30d":
      return { from: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000), to: end };
    case "year": {
      const y = new Date(today.getFullYear(), 0, 1);
      return { from: y, to: end };
    }
    case "custom": {
      const pf = fromStr ? new Date(fromStr) : startOfMonth();
      const pt = toStr ? new Date(toStr) : end;
      // Guard against malformed date inputs so a bad value can never
      // throw a Prisma "invalid date" error and 500 the page.
      const f = isNaN(pf.getTime()) ? startOfMonth() : pf;
      const t = isNaN(pt.getTime()) ? end : pt;
      t.setHours(23, 59, 59, 999);
      return { from: f, to: t };
    }
    default:
      return { from: startOfMonth(), to: end };
  }
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    range?: string;
    from?: string;
    to?: string;
    clientId?: string;
    brickSizeId?: string;
    categoryId?: string;
    vendorId?: string;
    tipperId?: string;
    personId?: string;
  }>;
}) {
  const session = await requireArea("reports");
  const canRevenue = can(session, "revenue");
  // Summary (net profit/income) and Cashbook expose revenue — hide them from
  // users without the "revenue" permission.
  const visibleKinds = canRevenue
    ? kinds
    : kinds.filter((k) => k.k !== "summary" && k.k !== "cashbook");

  const sp = await searchParams;
  let kind = (sp?.kind ?? (canRevenue ? "summary" : "production")) as ReportKind | "summary";
  if (!canRevenue && (kind === "summary" || kind === "cashbook")) kind = "production";
  const range = sp?.range ?? "month";
  const { from, to } = rangeFor(range, sp?.from, sp?.to);

  const [clients, sizes, categories, vendors, tippers, operators, masons, loaders, employees] =
    await Promise.all([
      prisma.client.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
      prisma.expenseCategory.findMany({ orderBy: { order: "asc" } }),
      prisma.vendor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.tipper.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.operator.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.mason.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.loader.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    ]);

  const people = [
    ...operators.map((o) => ({ value: o.id, label: `${o.name} · operator` })),
    ...masons.map((m) => ({ value: m.id, label: `${m.name} · mason` })),
    ...loaders.map((l) => ({ value: l.id, label: `${l.name} · loader` })),
    ...employees.map((e) => ({ value: e.id, label: `${e.name} · ${e.role}` })),
  ];

  const buildUrl = (overrides: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      kind,
      range,
      from: range === "custom" ? sp?.from : undefined,
      to: range === "custom" ? sp?.to : undefined,
      clientId: sp?.clientId,
      brickSizeId: sp?.brickSizeId,
      categoryId: sp?.categoryId,
      vendorId: sp?.vendorId,
      tipperId: sp?.tipperId,
      personId: sp?.personId,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) u.set(k, v);
    }
    return `/reports${u.toString() ? `?${u.toString()}` : ""}`;
  };

  const exportUrl = (format: "xlsx" | "pdf") => {
    if (kind === "summary") return "#";
    const u = new URLSearchParams();
    u.set("kind", kind);
    u.set("from", formatISODate(from));
    u.set("to", formatISODate(to));
    u.set("format", format);
    if (sp?.clientId) u.set("clientId", sp.clientId);
    if (sp?.brickSizeId) u.set("brickSizeId", sp.brickSizeId);
    if (sp?.categoryId) u.set("categoryId", sp.categoryId);
    if (sp?.vendorId) u.set("vendorId", sp.vendorId);
    if (sp?.tipperId) u.set("tipperId", sp.tipperId);
    if (sp?.personId) u.set("personId", sp.personId);
    return `/api/export?${u.toString()}`;
  };

  const periodLabel = `${from.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })} → ${to.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <>
      <PageHeader
        title="Reports"
        sub={`${kinds.find((k) => k.k === kind)?.label ?? "Summary"} · ${periodLabel}`}
        right={
          kind !== "summary" && (
            <div className="flex gap-2">
              <a
                href={exportUrl("xlsx")}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700"
              >
                <Icon.Download size={15} stroke={2.2} /> Excel
              </a>
              <a
                href={exportUrl("pdf")}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold hover:bg-brand-redDark"
              >
                <Icon.Download size={15} stroke={2.2} /> PDF
              </a>
            </div>
          )
        }
      />

      {/* Tabs + period in one card */}
      <Card className="mb-4">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {visibleKinds.map((t) => (
              <Link
                key={t.k}
                href={buildUrl({ kind: t.k })}
                className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${
                  kind === t.k
                    ? "bg-ink text-white"
                    : "bg-white text-slate-700 border border-slate-200 hover:border-slate-400"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Period
            </span>
            {presetRanges.map((p) => (
              <Link
                key={p.k}
                href={buildUrl({ range: p.k, from: undefined, to: undefined })}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap ${
                  range === p.k
                    ? "bg-brand-red text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {p.label}
              </Link>
            ))}
            {range === "custom" && (
              <CustomRange
                params={{
                  kind,
                  clientId: sp?.clientId,
                  brickSizeId: sp?.brickSizeId,
                  categoryId: sp?.categoryId,
                  vendorId: sp?.vendorId,
                  tipperId: sp?.tipperId,
                }}
                fromDefault={sp?.from ?? formatISODate(from)}
                toDefault={sp?.to ?? formatISODate(to)}
              />
            )}
          </div>

          {/* Per-tab filters */}
          {kind !== "summary" && (
            <div className="flex flex-wrap gap-2 items-center pt-1">
              {kind === "sales" && clients.length > 0 && (
                <FilterDropdown
                  label="Client"
                  value={sp?.clientId}
                  options={clients.map((c) => ({ value: c.id, label: c.name }))}
                  buildHref={(v) => buildUrl({ clientId: v })}
                />
              )}
              {["production", "mason", "tipper", "sales"].includes(kind) && sizes.length > 0 && (
                <FilterDropdown
                  label="Brick size"
                  value={sp?.brickSizeId}
                  options={sizes.map((s) => ({ value: s.id, label: s.label }))}
                  buildHref={(v) => buildUrl({ brickSizeId: v })}
                />
              )}
              {kind === "expense" && (
                <FilterDropdown
                  label="Category"
                  value={sp?.categoryId}
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                  buildHref={(v) => buildUrl({ categoryId: v })}
                />
              )}
              {(kind === "expense" || kind === "tipper") && vendors.length > 0 && (
                <FilterDropdown
                  label="Vendor"
                  value={sp?.vendorId}
                  options={vendors.map((v) => ({ value: v.id, label: v.name }))}
                  buildHref={(v) => buildUrl({ vendorId: v })}
                />
              )}
              {kind === "tipper" && tippers.length > 0 && (
                <FilterDropdown
                  label="Tipper"
                  value={sp?.tipperId}
                  options={tippers.map((t) => ({ value: t.id, label: t.name }))}
                  buildHref={(v) => buildUrl({ tipperId: v })}
                />
              )}
              {kind === "wages" && people.length > 0 && (
                <FilterDropdown
                  label="Person"
                  value={sp?.personId}
                  options={people}
                  buildHref={(v) => buildUrl({ personId: v })}
                />
              )}
            </div>
          )}
        </div>
      </Card>

      {kind === "summary" ? (
        <SummarySection from={from} to={to} />
      ) : (
        <LedgerSection
          kind={kind as ReportKind}
          from={from}
          to={to}
          clientId={sp?.clientId}
          brickSizeId={sp?.brickSizeId}
          categoryId={sp?.categoryId}
          vendorId={sp?.vendorId}
          tipperId={sp?.tipperId}
          personId={sp?.personId}
        />
      )}
    </>
  );
}

async function SummarySection({ from, to }: { from: Date; to: Date }) {
  const s = await getSummaryData(from, to);
  const profitColor = s.netProfit >= 0 ? "text-emerald-700" : "text-brand-red";
  return (
    <div className="space-y-4">
      {/* Hero net profit */}
      <Card className="!p-6">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Net Profit
            </div>
            <div className={`display num text-4xl md:text-5xl font-bold tracking-tight mt-1 ${profitColor}`}>
              {s.netProfit >= 0 ? "+" : "−"}
              {formatINR(Math.abs(s.netProfit))}
            </div>
          </div>
          <div className="text-right text-[12px] text-slate-500">
            <div>
              <span className="text-emerald-700 font-semibold">{formatINR(s.income.total)}</span>{" "}
              income
            </div>
            <div className="mt-0.5">
              <span className="text-brand-red font-semibold">{formatINR(s.expense.total)}</span>{" "}
              expense
            </div>
          </div>
        </div>
      </Card>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Income split */}
        <Card>
          <div className="text-base font-bold text-ink mb-3">Income breakdown</div>
          <Row label="Sales" amount={s.income.sales} total={s.income.total} color="#1F4FFF" />
          <Row label="Transport rent" amount={s.income.transport} total={s.income.total} color="#10B981" />
          <div className="border-t border-slate-100 pt-2 mt-2 flex justify-between text-[13px] font-bold">
            <span>Total income</span>
            <span className="num text-emerald-700">{formatINR(s.income.total)}</span>
          </div>
        </Card>

        {/* Expense split */}
        <Card>
          <div className="text-base font-bold text-ink mb-3">Expense breakdown</div>
          <Row label="Labour & Salary" amount={s.expense.labour} total={s.expense.total} color="#E11D2C" />
          <Row label="Materials" amount={s.expense.materials} total={s.expense.total} color="#F59E0B" />
          <Row label="Transport ops" amount={s.expense.transport} total={s.expense.total} color="#1F4FFF" />
          <Row label="Other" amount={s.expense.other} total={s.expense.total} color="#64748B" />
          <div className="border-t border-slate-100 pt-2 mt-2 flex justify-between text-[13px] font-bold">
            <span>Total expense</span>
            <span className="num text-brand-red">{formatINR(s.expense.total)}</span>
          </div>
        </Card>
      </div>

      {/* Top categories + staff status */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <div className="text-base font-bold text-ink mb-3">Top expense categories</div>
          {s.topCategories.length === 0 ? (
            <div className="text-center text-sm text-slate-500 py-6">No expenses in this period.</div>
          ) : (
            <div className="space-y-2.5">
              {s.topCategories.map((c) => (
                <div key={c.name}>
                  <div className="flex justify-between text-[12px] mb-0.5">
                    <span className="font-semibold">{c.name}</span>
                    <span className="num font-semibold">{formatINR(c.amount)}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-red rounded-full" style={{ width: `${c.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="text-base font-bold text-ink mb-3">Staff payment status (this period)</div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Salary" value={formatINR(s.staffPayments.salary)} />
            <Stat label="Paid" value={formatINR(s.staffPayments.paid)} color="text-emerald-700" />
            <Stat label="Pending" value={formatINR(s.staffPayments.pending)} color="text-brand-red" />
          </div>
        </Card>
      </div>

      {/* Transport business */}
      <Card>
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-base font-bold text-ink">Transport business (P&L)</div>
          <div className="text-[11px] text-slate-500">{s.transportBusiness.loads} loads</div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat
            label="Income"
            value={formatINR(s.transportBusiness.income)}
            color="text-emerald-700"
          />
          <Stat
            label="Expense"
            value={formatINR(s.transportBusiness.expense)}
            color="text-brand-red"
          />
          <Stat
            label="Profit"
            value={formatINR(s.transportBusiness.profit)}
            color={s.transportBusiness.profit >= 0 ? "text-emerald-700" : "text-brand-red"}
          />
        </div>
      </Card>
    </div>
  );
}

function Row({
  label,
  amount,
  total,
  color,
}: {
  label: string;
  amount: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
  return (
    <div className="py-1.5">
      <div className="flex justify-between text-[12px]">
        <span>
          {label} <span className="text-slate-400">· {pct}%</span>
        </span>
        <span className="num font-semibold">{formatINR(amount)}</span>
      </div>
      <div className="h-1 bg-slate-100 rounded-full overflow-hidden mt-1">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-slate-50 rounded-xl p-2.5 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={`num display text-base font-bold mt-0.5 ${color ?? "text-ink"}`}>{value}</div>
    </div>
  );
}

async function LedgerSection({
  kind,
  from,
  to,
  ...filters
}: {
  kind: ReportKind;
  from: Date;
  to: Date;
  clientId?: string;
  brickSizeId?: string;
  categoryId?: string;
  vendorId?: string;
  tipperId?: string;
  personId?: string;
}) {
  const data = await getReportData({ from, to, kind, ...filters });
  const totalEntries = data.sections.reduce((s, sec) => s + sec.rows.length, 0);
  return (
    <>
      {data.totals && Object.keys(data.totals).length > 0 && (
        <Card className="mb-3">
          <div className="flex flex-wrap gap-x-6 gap-y-2 items-baseline">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Entries
              </div>
              <div className="num display text-lg font-bold mt-0.5">{formatNumber(totalEntries)}</div>
            </div>
            {Object.entries(data.totals).map(([k, v]) => {
              const col = data.columns.find((c) => c.key === k);
              if (!col) return null;
              return (
                <div key={k}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {col.header}
                  </div>
                  <div
                    className={`num display text-lg font-bold mt-0.5 ${
                      col.format === "money" && (v as number) < 0
                        ? "text-brand-red"
                        : col.format === "money"
                          ? "text-ink"
                          : ""
                    }`}
                  >
                    {col.format === "money"
                      ? formatINR(v as number)
                      : formatNumber(v as number)}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <LedgerView data={data} />
    </>
  );
}

function FilterDropdown({
  label,
  value,
  options,
  buildHref,
}: {
  label: string;
  value?: string;
  options: Array<{ value: string; label: string }>;
  buildHref: (v: string | undefined) => string;
}) {
  const opts = [
    { label: "(Any)", href: buildHref(undefined), active: !value },
    ...options.map((o) => ({ label: o.label, href: buildHref(o.value), active: value === o.value })),
  ];
  return <ReportFilter label={label} hasValue={!!value} options={opts} />;
}
