import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, PageHeader, Pill, EmptyState } from "@/components/ui";
import { Icon, IconName } from "@/components/icons";
import {
  formatINR,
  formatNumber,
  formatLongDate,
  startOfDay,
  endOfDay,
  startOfWeek,
  relativeTime,
} from "@/lib/format";

export default async function DashboardPage() {
  const session = await requireSession();
  const today = startOfDay();
  const todayEnd = endOfDay();
  const weekStart = startOfWeek();
  const last7 = new Date(today.getTime() - 6 * 86400000);

  const [
    todayProduction,
    stockBatches,
    cashEntries,
    pendingOrders,
    todayActivity,
    overdueAdvances,
    materialStock,
    settings,
    weekProduction,
    overdueDispatches,
  ] = await Promise.all([
    prisma.productionEntry.aggregate({
      where: { date: { gte: today, lte: todayEnd } },
      _sum: { brickCount: true, totalWage: true, cementBagsUsed: true, damagedCount: true },
    }),
    prisma.stockBatch.groupBy({
      by: ["stage"],
      _sum: { remaining: true },
      where: { stage: { in: ["produced", "drying", "curing", "ready"] } },
    }),
    prisma.cashEntry.findMany(),
    prisma.order.findMany({
      where: { status: { in: ["open", "partial"] } },
      include: {
        client: true,
        items: true,
        deliveries: { include: { items: true } },
        payments: true,
      },
      orderBy: { date: "desc" },
      take: 5,
    }),
    prisma.cashEntry.findMany({
      where: { date: { gte: today } },
      orderBy: { date: "desc" },
      take: 6,
    }),
    prisma.advance.findMany({ where: { settled: false } }),
    prisma.materialStock.findMany({ include: { material: true } }),
    prisma.settings.findUnique({ where: { id: "default" } }),
    prisma.productionEntry.findMany({
      where: { date: { gte: last7 } },
      select: { date: true, brickCount: true },
    }),
    prisma.order.findMany({
      where: {
        status: { in: ["open", "partial"] },
        expectedDeliveryDate: { lt: today },
      },
      include: { client: true },
    }),
  ]);

  const cashIn = cashEntries.filter((e) => e.direction === "in").reduce((s, e) => s + e.amount, 0);
  const cashOut = cashEntries
    .filter((e) => e.direction === "out")
    .reduce((s, e) => s + e.amount, 0);
  const cashBalance = (settings?.cashOpening ?? 0) + cashIn - cashOut;

  const stageMap: Record<string, number> = { produced: 0, drying: 0, curing: 0, ready: 0 };
  for (const s of stockBatches) {
    stageMap[s.stage] = s._sum.remaining ?? 0;
  }

  const totalDue = pendingOrders.reduce((s, o) => {
    const ordered = o.items.reduce((x, i) => x + i.total, 0);
    const paid = o.payments.reduce((x, p) => x + p.amount, 0);
    return s + Math.max(0, ordered - paid);
  }, 0);

  // Smart alerts
  type Alert = {
    severity: "high" | "medium" | "low";
    title: string;
    sub: string;
    href: string;
  };
  const alerts: Alert[] = [];
  for (const ms of materialStock) {
    if (ms.reorderAt > 0 && ms.quantity <= ms.reorderAt) {
      alerts.push({
        severity: ms.quantity <= ms.reorderAt / 2 ? "high" : "medium",
        title: `Low ${ms.material.name} stock`,
        sub: `${ms.quantity.toFixed(1)} ${ms.material.unit} left · reorder at ${ms.reorderAt}`,
        href: "/settings/materials",
      });
    }
  }
  for (const o of overdueDispatches) {
    alerts.push({
      severity: "high",
      title: `${o.client.name} delivery overdue`,
      sub: `Expected ${o.expectedDeliveryDate?.toLocaleDateString("en-IN") ?? "—"}`,
      href: `/clients/${o.clientId}`,
    });
  }
  if (overdueAdvances.length > 0) {
    const total = overdueAdvances.reduce((s, a) => s + a.amount, 0);
    alerts.push({
      severity: "medium",
      title: `${overdueAdvances.length} open advances`,
      sub: `${formatINR(total)} not yet settled`,
      href: "/employees",
    });
  }

  // 7-day production chart
  const days: Array<{ key: string; label: string; bricks: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const k = d.toDateString();
    days.push({
      key: k,
      label: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()],
      bricks: 0,
    });
  }
  for (const e of weekProduction) {
    const k = new Date(e.date).toDateString();
    const slot = days.find((d) => d.key === k);
    if (slot) slot.bricks += e.brickCount;
  }
  const maxBars = Math.max(...days.map((d) => d.bricks), 1);

  return (
    <>
      <PageHeader
        title={`Hi, ${session.name}`}
        sub={formatLongDate(new Date())}
        right={
          <Link
            href="/production/new"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold shadow-red hover:bg-brand-redDark"
          >
            <Icon.Plus size={16} stroke={2.4} />
            <span className="hidden sm:inline">New entry</span>
          </Link>
        }
      />

      {/* Quick action grid */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-5">
        {[
          { label: "Production", href: "/production/new", icon: "Brick", tone: "red" },
          { label: "Sale", href: "/clients", icon: "Receipt", tone: "blue" },
          { label: "Cash", href: "/cash/new", icon: "Cash", tone: "ink" },
          { label: "Mason", href: "/mason/new", icon: "Hammer", tone: "blue" },
          { label: "Tipper", href: "/tipper/new", icon: "Truck", tone: "ink" },
          { label: "Expense", href: "/expense/new", icon: "Tag", tone: "red" },
        ].map((q) => {
          const Ic = Icon[q.icon as IconName];
          const cls =
            q.tone === "red"
              ? "bg-brand-redLight text-brand-red"
              : q.tone === "blue"
                ? "bg-brand-blueLight text-brand-blue"
                : "bg-slate-100 text-slate-700";
          return (
            <Link
              key={q.label}
              href={q.href}
              className="bg-white rounded-2xl p-3 border border-slate-200 hover:border-slate-400 transition flex flex-col items-center gap-1.5"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${cls}`}>
                <Ic size={18} />
              </div>
              <span className="text-[11px] font-semibold text-ink">{q.label}</span>
            </Link>
          );
        })}
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KPI
          label="Production today"
          value={formatNumber(todayProduction._sum.brickCount ?? 0)}
          sub={`${(todayProduction._sum.cementBagsUsed ?? 0).toFixed(1)} cement bags · ${todayProduction._sum.damagedCount ?? 0} damaged`}
          tone="ink"
          icon={<Icon.Brick size={18} color="#fff" />}
        />
        <KPI
          label="Ready stock"
          value={formatNumber(stageMap.ready)}
          sub={`${formatNumber(stageMap.drying + stageMap.curing)} curing`}
          tone="default"
          icon={<Icon.Stack size={18} color="#475569" />}
        />
        <KPI
          label="Cash in hand"
          value={formatINR(cashBalance, { compact: true })}
          sub={`In ${formatINR(cashIn, { compact: true })} · Out ${formatINR(cashOut, { compact: true })}`}
          tone="blue"
          icon={<Icon.Cash size={18} color="#fff" />}
        />
        <KPI
          label="Due from clients"
          value={formatINR(totalDue, { compact: true })}
          sub={`${pendingOrders.length} active orders`}
          tone="red"
          icon={<Icon.Receipt size={18} color="#fff" />}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Smart Alerts */}
        <Card className="lg:col-span-1">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-base font-bold text-ink">Smart alerts</div>
            <span className="text-[11px] font-semibold text-slate-500">{alerts.length}</span>
          </div>
          {alerts.length === 0 ? (
            <div className="text-center text-sm text-slate-500 py-6">All clear.</div>
          ) : (
            <div className="space-y-2">
              {alerts.slice(0, 6).map((a, i) => (
                <Link
                  key={i}
                  href={a.href}
                  className="block bg-slate-50 hover:bg-slate-100 rounded-xl p-2.5 transition"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        a.severity === "high"
                          ? "bg-brand-red"
                          : a.severity === "medium"
                            ? "bg-amber-500"
                            : "bg-slate-400"
                      }`}
                    />
                    <Pill tone={a.severity === "high" ? "red" : "warning"}>
                      {a.severity.toUpperCase()}
                    </Pill>
                  </div>
                  <div className="text-[12px] font-semibold text-ink mt-1">{a.title}</div>
                  <div className="text-[11px] text-slate-500">{a.sub}</div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* 7-day production chart */}
        <Card className="lg:col-span-2">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-base font-bold text-ink">Production — last 7 days</div>
            <Link href="/reports?kind=production" className="text-xs font-semibold text-brand-blue">
              See report →
            </Link>
          </div>
          <div className="flex items-end gap-2 h-32">
            {days.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end h-24 justify-center">
                  <div
                    className={`w-full rounded-t ${
                      i === days.length - 1 ? "bg-brand-red" : "bg-brand-blue/70"
                    }`}
                    style={{
                      height: `${(d.bricks / maxBars) * 100}%`,
                      minHeight: d.bricks > 0 ? 4 : 0,
                    }}
                  />
                </div>
                <div className="text-[10px] text-slate-500 font-medium">{d.label}</div>
                <div className="num text-[10px] font-semibold text-slate-700">
                  {d.bricks > 0 ? formatNumber(d.bricks) : "—"}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Pending orders */}
        <Card className="lg:col-span-2">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">Pending orders</div>
              <div className="text-xs text-slate-500">Outstanding deliveries and payments</div>
            </div>
            <Link href="/clients" className="text-xs font-semibold text-brand-blue">
              View all
            </Link>
          </div>
          {pendingOrders.length === 0 ? (
            <EmptyState title="No pending orders" sub="Add an order from the Clients page." />
          ) : (
            <div className="divide-y divide-slate-100">
              {pendingOrders.map((o) => {
                const ordered = o.items.reduce((s, i) => s + i.total, 0);
                const delivered = o.deliveries.reduce(
                  (s, d) => s + d.items.reduce((x, i) => x + i.total, 0),
                  0
                );
                const paid = o.payments.reduce((s, p) => s + p.amount, 0);
                const due = ordered - paid;
                return (
                  <Link
                    key={o.id}
                    href={`/clients/${o.clientId}`}
                    className="flex items-center gap-3 py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded-lg"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-ink truncate">{o.client.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {o.client.location} · ordered {formatINR(ordered)} · delivered{" "}
                        {formatINR(delivered)}
                      </div>
                    </div>
                    {due > 0 ? (
                      <Pill tone="red">{formatINR(due, { compact: true })} due</Pill>
                    ) : (
                      <Pill tone="success">Paid</Pill>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        {/* Today's activity */}
        <Card className="lg:col-span-1">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">Today</div>
              <div className="text-xs text-slate-500">Cash movements</div>
            </div>
            <Link href="/cash" className="text-xs font-semibold text-brand-blue">
              Cashbook →
            </Link>
          </div>
          {todayActivity.length === 0 ? (
            <div className="text-center text-sm text-slate-500 py-6">Nothing recorded.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {todayActivity.map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 py-2">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      a.direction === "in"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-brand-redLight text-brand-red"
                    }`}
                  >
                    {a.direction === "in" ? (
                      <Icon.ArrowDown size={12} stroke={2.2} />
                    ) : (
                      <Icon.ArrowUp size={12} stroke={2.2} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-ink truncate">{a.title}</div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {a.category} · {relativeTime(a.date)}
                    </div>
                  </div>
                  <div
                    className={`num text-[12px] font-bold ${
                      a.direction === "in" ? "text-emerald-700" : "text-ink"
                    }`}
                  >
                    {a.direction === "in" ? "+" : "−"}
                    {formatINR(a.amount, { compact: true })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Stock pipeline */}
        <Card className="lg:col-span-3">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">Stock pipeline</div>
              <div className="text-xs text-slate-500">
                Production → Drying → Curing → Ready
              </div>
            </div>
            <span className="text-[11px] font-semibold text-slate-500 mono">
              {formatNumber(
                stageMap.produced + stageMap.drying + stageMap.curing + stageMap.ready
              )}{" "}
              bricks total
            </span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {[
              { k: "Produced", v: stageMap.produced, c: "#E11D2C", age: "Today" },
              { k: "Drying", v: stageMap.drying, c: "#F59E0B", age: "1–3 d" },
              { k: "Curing", v: stageMap.curing, c: "#1F4FFF", age: "4–10 d" },
              { k: "Ready", v: stageMap.ready, c: "#10B981", age: "Sellable" },
            ].map((s) => (
              <div key={s.k} className="bg-slate-50 rounded-xl p-3 text-center">
                <div
                  className="w-10 h-10 rounded-lg mx-auto flex items-center justify-center mb-2"
                  style={{ background: s.c + "22", border: `2px solid ${s.c}` }}
                >
                  <div className="w-2.5 h-2.5 rounded" style={{ background: s.c }} />
                </div>
                <div className="num display text-lg font-bold text-ink">{formatNumber(s.v)}</div>
                <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                  {s.k}
                </div>
                <div className="text-[10px] text-slate-400">{s.age}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function KPI({
  label,
  value,
  sub,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "red" | "blue" | "ink";
  icon?: React.ReactNode;
}) {
  const toneClass = {
    default: "bg-white border-slate-900/[.06] text-ink",
    red: "bg-brand-red text-white border-transparent shadow-red",
    blue: "bg-brand-blue text-white border-transparent shadow-blue",
    ink: "bg-ink text-white border-transparent",
  }[tone];
  return (
    <div className={`rounded-2xl p-4 border ${toneClass}`}>
      <div className="flex items-center justify-between">
        <span
          className={`text-[10px] font-semibold tracking-wider uppercase ${
            tone === "default" ? "text-slate-500" : "text-white/75"
          }`}
        >
          {label}
        </span>
        {icon}
      </div>
      <div className="display num text-2xl font-bold tracking-tight mt-1.5 leading-none">{value}</div>
      {sub && (
        <div
          className={`text-[11px] mt-1.5 ${
            tone === "default" ? "text-slate-500" : "text-white/75"
          }`}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
