import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, PageHeader, Pill, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatShortDate, startOfDay, startOfMonth } from "@/lib/format";
import { DeleteCashEntry } from "./delete-button";

export default async function CashbookPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; direction?: string; source?: string }>;
}) {
  const sp = await searchParams;
  const today = startOfDay();
  const from = sp?.from ? new Date(sp.from) : startOfMonth();
  const to = sp?.to ? new Date(sp.to) : today;
  to.setHours(23, 59, 59, 999);

  const where: Record<string, unknown> = { date: { gte: from, lte: to } };
  if (sp?.direction) where.direction = sp.direction;
  if (sp?.source) where.source = sp.source;

  const [entries, settings, allEntries] = await Promise.all([
    prisma.cashEntry.findMany({ where, orderBy: { date: "desc" } }),
    prisma.settings.findUnique({ where: { id: "default" } }),
    prisma.cashEntry.findMany(),
  ]);

  const cashIn = allEntries.filter((e) => e.direction === "in").reduce((s, e) => s + e.amount, 0);
  const cashOut = allEntries.filter((e) => e.direction === "out").reduce((s, e) => s + e.amount, 0);
  const balance = (settings?.cashOpening ?? 0) + cashIn - cashOut;

  const periodIn = entries.filter((e) => e.direction === "in").reduce((s, e) => s + e.amount, 0);
  const periodOut = entries.filter((e) => e.direction === "out").reduce((s, e) => s + e.amount, 0);

  // Group by date
  const groups: Record<string, typeof entries> = {};
  for (const e of entries) {
    const k = e.date.toDateString();
    (groups[k] ??= []).push(e);
  }

  return (
    <>
      <PageHeader
        title="Cashbook"
        sub="All cash in and out — auto-tracked from operations + manual entries"
        right={
          <Link
            href="/cash/new"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold shadow-red"
          >
            <Icon.Plus size={16} stroke={2.4} /> Manual entry
          </Link>
        }
      />

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Cash in hand
          </div>
          <div className="num display text-2xl font-bold mt-0.5">{formatINR(balance)}</div>
        </Card>
        <Card padding="tight" className="border-2 border-emerald-200">
          <div className="text-[10px] text-emerald-700 font-semibold uppercase tracking-wider">
            Cash in (period)
          </div>
          <div className="num display text-2xl font-bold mt-0.5 text-emerald-700">
            +{formatINR(periodIn)}
          </div>
        </Card>
        <Card padding="tight" className="border-2 border-red-200">
          <div className="text-[10px] text-brand-red font-semibold uppercase tracking-wider">
            Cash out (period)
          </div>
          <div className="num display text-2xl font-bold mt-0.5 text-brand-red">
            −{formatINR(periodOut)}
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {[
          { k: "all", label: "All", direction: null, source: null },
          { k: "in", label: "In only", direction: "in", source: null },
          { k: "out", label: "Out only", direction: "out", source: null },
          { k: "manual", label: "Manual", direction: null, source: "manual" },
          { k: "expense", label: "Expense", direction: null, source: "expense" },
          { k: "sale", label: "Sales", direction: null, source: "sale" },
          { k: "advance", label: "Advance", direction: null, source: "advance" },
          { k: "tipper", label: "Tipper", direction: null, source: "tipper" },
          { k: "wage", label: "Wage", direction: null, source: "wage" },
        ].map((t) => {
          const url = new URLSearchParams();
          if (t.direction) url.set("direction", t.direction);
          if (t.source) url.set("source", t.source);
          if (sp?.from) url.set("from", sp.from);
          if (sp?.to) url.set("to", sp.to);
          const isActive =
            (t.direction ?? null) === (sp?.direction ?? null) &&
            (t.source ?? null) === (sp?.source ?? null);
          return (
            <Link
              key={t.k}
              href={`/cash${url.toString() ? `?${url.toString()}` : ""}`}
              className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${
                isActive
                  ? "bg-ink text-white"
                  : "bg-white text-slate-700 border border-slate-200"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {Object.keys(groups).length === 0 ? (
        <EmptyState title="No entries in this period" />
      ) : (
        Object.entries(groups).map(([dateKey, items]) => {
          const d = new Date(dateKey);
          const dayLabel =
            new Date().toDateString() === dateKey
              ? "Today"
              : new Date(Date.now() - 86400000).toDateString() === dateKey
                ? "Yesterday"
                : formatShortDate(d);
          const dayIn = items.filter((i) => i.direction === "in").reduce((s, i) => s + i.amount, 0);
          const dayOut = items.filter((i) => i.direction === "out").reduce((s, i) => s + i.amount, 0);
          return (
            <div key={dateKey} className="mb-4">
              <div className="flex items-baseline justify-between mb-2 px-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {dayLabel} · {formatShortDate(d)}
                </div>
                <div className="flex gap-3 text-[11px] font-semibold">
                  <span className="text-emerald-700">+{formatINR(dayIn)}</span>
                  <span className="text-brand-red">−{formatINR(dayOut)}</span>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-900/[.06] divide-y divide-slate-100 overflow-hidden">
                {items.map((it) => (
                  <div key={it.id} className="flex items-center gap-3 p-3">
                    <div
                      className={`w-1 self-stretch rounded ${
                        it.direction === "in" ? "bg-emerald-500" : "bg-brand-red"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-ink">{it.title}</div>
                      <div className="text-[11px] text-slate-500">
                        {it.category} · {it.method} {it.notes ? `· ${it.notes}` : ""}
                      </div>
                    </div>
                    <Pill tone={it.source === "manual" ? "slate" : "blue"}>{it.source}</Pill>
                    <div
                      className={`num text-[14px] font-bold ${
                        it.direction === "in" ? "text-emerald-700" : "text-ink"
                      }`}
                    >
                      {it.direction === "in" ? "+" : "−"}
                      {formatINR(it.amount)}
                    </div>
                    <DeleteCashEntry id={it.id} canDelete={it.source === "manual"} />
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
