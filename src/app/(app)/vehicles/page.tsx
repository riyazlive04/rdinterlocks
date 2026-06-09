import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, PageHeader, Pill, EmptyState } from "@/components/ui";
import { requireArea } from "@/lib/auth";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatShortDate, startOfMonth } from "@/lib/format";

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireArea("vehicles");
  const sp = await searchParams;
  const tab = sp?.tab ?? "fleet";

  const monthStart = startOfMonth();
  const monthEnd = new Date();
  monthEnd.setHours(23, 59, 59, 999);

  const [tippers, expensesThisMonth, allLoads] = await Promise.all([
    prisma.tipper.findMany({
      where: { active: true },
      include: { vendor: true },
      orderBy: { name: "asc" },
    }),
    prisma.expense.findMany({
      where: {
        date: { gte: monthStart, lte: monthEnd },
        tipperId: { not: null },
      },
      include: { category: true, vendor: true },
    }),
    prisma.tipperLoad.findMany({
      where: { date: { gte: monthStart, lte: monthEnd } },
      include: { tipper: true, brickSize: true },
    }),
  ]);

  // Roll up per-tipper stats
  const stats: Record<
    string,
    {
      loadsThisMonth: number;
      expenseThisMonth: number;
      incomeThisMonth: number;
      emiPaid: number;
    }
  > = {};
  for (const t of tippers) {
    stats[t.id] = {
      loadsThisMonth: 0,
      expenseThisMonth: 0,
      incomeThisMonth: 0,
      emiPaid: 0,
    };
  }
  for (const l of allLoads) {
    const s = stats[l.tipperId];
    if (!s) continue;
    s.loadsThisMonth++;
    if (l.rentDirection === "in") s.incomeThisMonth += l.rentAmount;
    else s.expenseThisMonth += l.rentAmount;
  }
  for (const e of expensesThisMonth) {
    if (!e.tipperId) continue;
    const s = stats[e.tipperId];
    if (!s) continue;
    s.expenseThisMonth += e.amount;
    if (e.category.name === "EMI") s.emiPaid += e.amount;
  }

  const totalEmi = tippers
    .filter((t) => t.ownership === "own" && t.emiAmount > 0)
    .reduce((s, t) => s + t.emiAmount, 0);

  return (
    <>
      <PageHeader
        title="Vehicles & EMI"
        sub="Fleet, EMI schedule, and per-tipper P&L"
        right={
          <Link
            href="/settings/tippers"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200"
          >
            <Icon.Settings size={16} /> Manage
          </Link>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4">
        {[
          { k: "fleet", label: "Fleet" },
          { k: "emi", label: "EMI" },
          { k: "expenses", label: "Expenses" },
        ].map((t) => (
          <Link
            key={t.k}
            href={`/vehicles?tab=${t.k}`}
            className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${
              tab === t.k
                ? "bg-ink text-white"
                : "bg-white text-slate-700 border border-slate-200"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tippers.length === 0 ? (
        <EmptyState
          title="No vehicles registered"
          sub="Add tippers in Settings to start tracking EMI and per-vehicle P&L."
          action={
            <Link
              href="/settings/tippers"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-red text-white text-[13px] font-semibold"
            >
              <Icon.Plus size={16} /> Add tipper
            </Link>
          }
        />
      ) : tab === "emi" ? (
        <Card>
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">EMI schedule (own vehicles)</div>
              <div className="text-xs text-slate-500">
                Total monthly outflow:{" "}
                <span className="num font-bold text-brand-red">{formatINR(totalEmi)}</span>
              </div>
            </div>
            <Link
              href="/expense/new"
              className="text-xs font-semibold text-brand-blue"
            >
              + Pay EMI
            </Link>
          </div>
          {tippers.filter((t) => t.ownership === "own" && t.emiAmount > 0).length === 0 ? (
            <div className="text-center text-sm text-slate-500 py-6">
              No own vehicles with EMI configured.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-100">
              {tippers
                .filter((t) => t.ownership === "own" && t.emiAmount > 0)
                .map((t) => {
                  const paid = stats[t.id]?.emiPaid ?? 0;
                  const status =
                    paid >= t.emiAmount ? "paid" : paid > 0 ? "partial" : "due";
                  return (
                    <div
                      key={t.id}
                      className="flex items-center gap-3 p-3"
                    >
                      <div className="w-10 h-10 rounded-xl bg-brand-blueLight flex items-center justify-center">
                        <Icon.Truck size={18} color="#1F4FFF" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-ink">{t.name}</div>
                        <div className="text-[11px] mono text-slate-500">{t.plate}</div>
                      </div>
                      <div className="text-right">
                        <div className="num text-[13px] font-bold text-ink">
                          {formatINR(t.emiAmount)}
                        </div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider">
                          / month
                        </div>
                      </div>
                      <div className="text-right ml-3">
                        <div className="num text-[12px] text-slate-700">
                          Paid {formatINR(paid)}
                        </div>
                        <Pill
                          tone={
                            status === "paid"
                              ? "success"
                              : status === "partial"
                                ? "warning"
                                : "red"
                          }
                        >
                          {status}
                        </Pill>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </Card>
      ) : tab === "expenses" ? (
        <Card>
          <div className="text-base font-bold text-ink mb-3">
            Vehicle expenses · this month
          </div>
          {expensesThisMonth.length === 0 ? (
            <div className="text-center text-sm text-slate-500 py-6">
              No vehicle-tagged expenses yet.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-100">
              {expensesThisMonth.map((e) => {
                const tipper = tippers.find((t) => t.id === e.tipperId);
                return (
                  <div key={e.id} className="flex items-center gap-3 p-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-ink">{e.title}</div>
                      <div className="text-[11px] text-slate-500">
                        {formatShortDate(e.date)} · {e.category.name}{" "}
                        {tipper ? `· ${tipper.name}` : ""}
                      </div>
                    </div>
                    <div className="num text-[13px] font-bold text-brand-red">
                      −{formatINR(e.amount)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : (
        // Fleet tab (default)
        <div className="grid sm:grid-cols-2 gap-3">
          {tippers.map((t) => {
            const s = stats[t.id];
            const profit = (s?.incomeThisMonth ?? 0) - (s?.expenseThisMonth ?? 0);
            return (
              <Card key={t.id}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-brand-blueLight flex items-center justify-center">
                    <Icon.Truck size={22} color="#1F4FFF" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-bold text-ink">{t.name}</div>
                    <div className="mono text-[11px] text-slate-500">{t.plate ?? "-"}</div>
                  </div>
                  <Pill tone={t.ownership === "own" ? "success" : "blue"}>
                    {t.ownership === "own" ? "RD-own" : t.vendor?.name ?? "vendor"}
                  </Pill>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      Loads · this month
                    </div>
                    <div className="num font-bold mt-0.5">
                      {formatNumber(s?.loadsThisMonth ?? 0)}
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      EMI / mo
                    </div>
                    <div className="num font-bold mt-0.5">
                      {t.emiAmount > 0 ? formatINR(t.emiAmount) : "-"}
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      Income
                    </div>
                    <div className="num font-bold mt-0.5 text-emerald-700">
                      {formatINR(s?.incomeThisMonth ?? 0)}
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      Expense
                    </div>
                    <div className="num font-bold mt-0.5 text-brand-red">
                      {formatINR(s?.expenseThisMonth ?? 0)}
                    </div>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between items-baseline">
                  <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
                    Net (this month)
                  </span>
                  <span
                    className={`num display text-base font-bold ${
                      profit >= 0 ? "text-emerald-700" : "text-brand-red"
                    }`}
                  >
                    {profit >= 0 ? "+" : "−"}
                    {formatINR(Math.abs(profit))}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
