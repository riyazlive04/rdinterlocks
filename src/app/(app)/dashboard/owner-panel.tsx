import Link from "next/link";
import type { Session } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, PageHeader, Pill, EmptyState } from "@/components/ui";
import { Icon, IconName } from "@/components/icons";
import {
  formatINR,
  formatNumber,
  formatLongDate,
  startOfDay,
  endOfDay,
  relativeTime,
} from "@/lib/format";
import { stageForAge } from "@/lib/stock";
import { can } from "@/lib/access";
import { roleLabel } from "@/lib/roles";
import { collectionsQueue } from "@/lib/outstanding";

/**
 * The whole-business dashboard — Owner and Manager share it.
 *
 * One panel for both on purpose: the factory runs with the owner and the
 * manager seeing the same system (see isFullAccess in lib/roles.ts), so a
 * second, thinner manager dashboard would only be a place for the two of them
 * to disagree about the numbers.
 *
 * It keeps everything the single dashboard always showed — production, stock,
 * cash, pending orders, smart alerts, raw material — and adds the operational
 * signals the four-role split created: what is waiting on a review, a send,
 * an approval, a machine or an owner. Every figure is a link to the screen
 * that resolves it; a dashboard number nobody can act on is decoration.
 *
 * Money stays behind `can(session, "revenue")` throughout, exactly as before.
 */
export default async function OwnerPanel({ session }: { session: Session }) {
  const canRevenue = can(session, "revenue");
  const today = startOfDay();
  const todayEnd = endOfDay();
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
    dueLeads,
    openLeadCount,
    // The four-role additions.
    awaitingReview,
    awaitingSend,
    pendingPayments,
    pendingPaymentTotals,
    queuedOrders,
    unassignedLeads,
    onDuty,
    overdueTasks,
    overdueTaskCount,
  ] = await Promise.all([
    prisma.productionEntry.aggregate({
      where: { date: { gte: today, lte: todayEnd } },
      _sum: { brickCount: true, totalWage: true, cementBagsUsed: true, damagedCount: true },
    }),
    prisma.stockBatch.findMany({
      where: { remaining: { gt: 0 } },
      select: { producedAt: true, remaining: true, source: true },
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
    prisma.lead.findMany({
      where: { status: "open", followUpDate: { lte: todayEnd } },
      orderBy: { followUpDate: "asc" },
      select: { id: true, customerName: true, place: true, followUpDate: true },
    }),
    prisma.lead.count({ where: { status: "open" } }),
    // Quotations sitting with the reviewer, and approved ones not yet out.
    // supersededById: null keeps superseded revisions out of both counts.
    prisma.quotation.count({ where: { status: "in_review", supersededById: null } }),
    prisma.quotation.count({ where: { status: "approved", supersededById: null } }),
    // Payments awaiting approval. This is the manager's own action item — a
    // recorded payment nobody approves blocks the order behind it, so it gets
    // a card of its own rather than a line in the alert list.
    prisma.quotationPayment.findMany({
      where: { status: "pending" },
      orderBy: { recordedAt: "asc" },
      take: 6,
      include: {
        quotation: { select: { id: true, number: true, customerName: true } },
        recordedBy: { select: { name: true } },
      },
    }),
    prisma.quotationPayment.aggregate({
      where: { status: "pending" },
      _sum: { amount: true },
      _count: true,
    }),
    // Same entry condition as the production queue itself, so the number here
    // and the number there can never disagree.
    prisma.order.count({
      where: {
        approvedAt: { not: null },
        status: { notIn: ["complete", "cancelled"] },
        fulfilmentStage: "queued",
      },
    }),
    prisma.lead.count({ where: { status: "open", ownerUserId: null } }),
    prisma.dutySession.findMany({
      where: { endedAt: null },
      orderBy: { startedAt: "asc" },
      include: { user: { select: { id: true, name: true, role: true } } },
    }),
    prisma.task.findMany({
      // "not done", not "is open": the live database defaults Task.status to
      // `wip`, so filtering on "open" exactly hid every in-progress task
      // from this panel while the tasks page listed it.
      where: { status: { not: "done" }, dueDate: { lt: today } },
      orderBy: { dueDate: "asc" },
      take: 5,
      include: { assignedTo: { select: { name: true } } },
    }),
    prisma.task.count({ where: { status: { not: "done" }, dueDate: { lt: today } } }),
  ]);

  const cashIn = cashEntries.filter((e) => e.direction === "in").reduce((s, e) => s + e.amount, 0);
  const cashOut = cashEntries
    .filter((e) => e.direction === "out")
    .reduce((s, e) => s + e.amount, 0);
  const cashBalance = (settings?.cashOpening ?? 0) + cashIn - cashOut;

  // Stage is derived from each batch's age + the configurable thresholds.
  const dryingDays = settings?.dryingDays ?? 3;
  const curingDays = settings?.curingDays ?? 10;
  const stageMap: Record<string, number> = { produced: 0, drying: 0, curing: 0, ready: 0 };
  for (const b of stockBatches) {
    // Returned bricks were cured long before they came back, so they're
    // sellable right away rather than re-ageing from their return date.
    const st =
      b.source === "return"
        ? "ready"
        : stageForAge(b.producedAt, dryingDays, curingDays, todayEnd);
    stageMap[st] += b.remaining;
  }

  // Due from clients, from lib/outstanding.ts.
  //
  // This was computed inline over `pendingOrders`, which is `take: 5` — so
  // the headline receivables figure on the owner's home screen was the due on
  // the five most recent open orders, not the total, and understated it
  // silently with no sign on screen that it was a sample. It also counted
  // order-linked payments only and ignored add-ons and returns.
  const collections = await collectionsQueue();
  const totalDue = collections.totals.debt;

  const pendingPaymentCount = pendingPaymentTotals._count;
  const pendingPaymentValue = pendingPaymentTotals._sum.amount ?? 0;

  // Smart alerts
  type Alert = {
    severity: "high" | "medium" | "low";
    title: string;
    sub: string;
    href: string;
  };
  const alerts: Alert[] = [];

  // Things with a deadline come first — a missed follow-up or a late delivery
  // costs an order today, whereas a reorder nudge can wait an hour.
  for (const l of dueLeads.slice(0, 3)) {
    alerts.push({
      severity: "high",
      title: `Follow up ${l.customerName || "unnamed lead"}`,
      sub: `${l.place || "Place not captured"} · due ${
        l.followUpDate?.toLocaleDateString("en-IN") ?? "-"
      }`,
      href: `/leads/${l.id}`,
    });
  }
  if (dueLeads.length > 3) {
    alerts.push({
      severity: "medium",
      title: `${dueLeads.length - 3} more follow-ups due`,
      sub: `${openLeadCount} open leads in total`,
      href: "/leads?due=1",
    });
  }
  for (const o of overdueDispatches) {
    alerts.push({
      severity: "high",
      title: `${o.client.name} delivery overdue`,
      sub: `Expected ${o.expectedDeliveryDate?.toLocaleDateString("en-IN") ?? "-"}`,
      href: `/clients/${o.clientId}`,
    });
  }
  // A payment waiting on this desk stalls the order behind it, so it ranks
  // with the deadline items rather than with the housekeeping ones.
  if (pendingPaymentCount > 0) {
    alerts.push({
      severity: "high",
      title: `${pendingPaymentCount} payment${pendingPaymentCount === 1 ? "" : "s"} awaiting your approval`,
      sub: canRevenue
        ? `${formatINR(pendingPaymentValue)} recorded, not yet approved`
        : "Recorded by the desk, not yet approved",
      href: "/payments",
    });
  }
  if (unassignedLeads > 0) {
    alerts.push({
      severity: "medium",
      title: `${unassignedLeads} open lead${unassignedLeads === 1 ? "" : "s"} with no owner`,
      sub: "Nobody is calling these",
      href: "/leads?owner=unassigned",
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

  // Low materials are collapsed into one row once there are several. Listing
  // them individually used to fill all six visible slots on a factory that is
  // simply running its stock low, hiding every other alert behind it.
  const lowMaterials = materialStock.filter(
    (ms) => ms.reorderAt > 0 && ms.quantity <= ms.reorderAt
  );
  if (lowMaterials.length > 2) {
    const critical = lowMaterials.filter((ms) => ms.quantity <= ms.reorderAt / 2).length;
    alerts.push({
      severity: critical > 0 ? "high" : "medium",
      title: `${lowMaterials.length} materials low on stock`,
      sub: `${lowMaterials
        .slice(0, 3)
        .map((ms) => ms.material.name)
        .join(", ")}${lowMaterials.length > 3 ? "…" : ""}${critical > 0 ? ` · ${critical} critical` : ""}`,
      href: "/settings/material-stock",
    });
  } else {
    for (const ms of lowMaterials) {
      alerts.push({
        severity: ms.quantity <= ms.reorderAt / 2 ? "high" : "medium",
        title: `Low ${ms.material.name} stock`,
        sub: `${ms.quantity.toFixed(1)} ${ms.material.unit} left · reorder at ${ms.reorderAt}`,
        href: "/settings/material-stock",
      });
    }
  }

  // Only six are shown, so make sure the six are the most severe. Array.sort is
  // stable, which keeps the deadline-first ordering above within each severity.
  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

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

  // The action strip. Ordered by who is blocked: a payment blocks an order, a
  // review blocks a send, a send blocks a customer, and so on down.
  const actions: Array<{
    label: string;
    count: number;
    sub: string;
    href: string;
    icon: IconName;
  }> = [
    {
      label: "Payments to approve",
      count: pendingPaymentCount,
      sub: "Blocks the order",
      href: "/payments",
      icon: "Receipt",
    },
    {
      label: "Quotes to review",
      count: awaitingReview,
      sub: "Waiting on a reviewer",
      href: "/quotations/review",
      icon: "Check",
    },
    {
      label: "Quotes to send",
      count: awaitingSend,
      sub: "Approved, not sent",
      href: "/quotations/send",
      icon: "FileText",
    },
    {
      label: "Queued for production",
      count: queuedOrders,
      sub: "Paid, not started",
      href: "/fulfilment",
      icon: "Truck",
    },
    {
      label: "Unassigned leads",
      count: unassignedLeads,
      sub: "Nobody owns these",
      href: "/leads?owner=unassigned",
      icon: "Mic",
    },
    {
      label: "Overdue tasks",
      count: overdueTaskCount,
      sub: "Across the team",
      href: "/tasks",
      icon: "Flag",
    },
  ];

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
          { label: "Leads", href: "/leads", icon: "Mic", tone: "blue" },
          { label: "Sale", href: "/clients", icon: "Receipt", tone: "blue" },
          { label: "Cash", href: "/cash/new", icon: "Cash", tone: "ink" },
          { label: "Mason", href: "/mason/new", icon: "Hammer", tone: "blue" },
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

      {/* What is waiting on somebody. Every tile is the screen that clears it. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-5">
        {actions.map((a) => {
          const Ic = Icon[a.icon];
          const idle = a.count === 0;
          return (
            <Link
              key={a.label}
              href={a.href}
              className={`rounded-2xl p-3 border transition ${
                idle
                  ? "bg-white border-slate-200 hover:border-slate-400"
                  : "bg-white border-brand-red/30 hover:border-brand-red shadow-card"
              }`}
            >
              <div className="flex items-center justify-between">
                <Ic size={15} color={idle ? "#94A3B8" : "#E11D2C"} />
                <span
                  className={`num display text-[20px] font-bold leading-none ${
                    idle ? "text-slate-300" : "text-brand-red"
                  }`}
                >
                  {formatNumber(a.count)}
                </span>
              </div>
              <div className="text-[11px] font-semibold text-ink mt-1.5 leading-tight">
                {a.label}
              </div>
              <div className="text-[10px] text-slate-500 leading-tight">
                {idle ? "All clear" : a.sub}
              </div>
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
        {canRevenue && (
          <KPI
            label="Cash in hand"
            value={formatINR(cashBalance, { compact: true })}
            sub={`In ${formatINR(cashIn, { compact: true })} · Out ${formatINR(cashOut, { compact: true })}`}
            tone="blue"
            icon={<Icon.Cash size={18} color="#fff" />}
          />
        )}
        <KPI
          label="Due from clients"
          value={formatINR(totalDue, { compact: true })}
          sub={
            collections.totals.buckets.d60plus > 0
              ? `${collections.totals.clients} clients · ${formatINR(collections.totals.buckets.d60plus, { compact: true })} over 60d`
              : `${collections.totals.clients} client${collections.totals.clients === 1 ? "" : "s"} owing`
          }
          tone="red"
          icon={<Icon.Receipt size={18} color="#fff" />}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Payments awaiting approval. The manager's own queue, so it sits
            above everything else on the grid rather than under the chart. */}
        <Card className="lg:col-span-2">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">Payments awaiting your approval</div>
              <div className="text-xs text-slate-500">
                Recorded by the desk · an order cannot start until you approve
              </div>
            </div>
            <Link href="/payments" className="text-xs font-semibold text-brand-blue">
              Approve →
            </Link>
          </div>
          {pendingPayments.length === 0 ? (
            <div className="text-center text-sm text-slate-500 py-6">
              Nothing waiting on you.
            </div>
          ) : (
            <>
              <div className="divide-y divide-slate-100">
                {pendingPayments.map((p) => (
                  <Link
                    key={p.id}
                    href="/payments"
                    className="flex items-center gap-3 py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded-lg"
                  >
                    <div className="w-7 h-7 rounded-lg bg-brand-redLight text-brand-red flex items-center justify-center flex-shrink-0">
                      <Icon.Receipt size={13} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-ink truncate">
                        {p.quotation.customerName || p.quotation.number}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {p.method}
                        {p.recordedBy ? ` · by ${p.recordedBy.name}` : ""}
                        {` · ${relativeTime(p.recordedAt)}`}
                      </div>
                    </div>
                    {canRevenue ? (
                      <div className="num text-[13px] font-bold text-ink flex-shrink-0">
                        {formatINR(p.amount)}
                      </div>
                    ) : (
                      <Pill tone="warning">Pending</Pill>
                    )}
                  </Link>
                ))}
              </div>
              {pendingPaymentCount > pendingPayments.length && (
                <div className="text-[11px] text-slate-500 mt-2">
                  {pendingPaymentCount - pendingPayments.length} more waiting.
                </div>
              )}
              {canRevenue && (
                <div className="text-[11px] text-slate-500 mt-2">
                  {formatINR(pendingPaymentValue)} unapproved in total.
                </div>
              )}
            </>
          )}
        </Card>

        {/* Who is actually at work right now. */}
        <Card className="lg:col-span-1">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">On duty now</div>
              <div className="text-xs text-slate-500">Open shifts</div>
            </div>
            <Link href="/duty" className="text-xs font-semibold text-brand-blue">
              Duty log →
            </Link>
          </div>
          <div className="display num text-2xl font-bold text-ink leading-none">
            {formatNumber(onDuty.length)}
          </div>
          {onDuty.length === 0 ? (
            <div className="text-[12px] text-slate-500 mt-2">
              Nobody has started a shift today.
            </div>
          ) : (
            <div className="mt-2 space-y-1.5">
              {onDuty.map((d) => (
                <div key={d.id} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  <span className="text-[12px] font-semibold text-ink truncate">
                    {d.user.name}
                  </span>
                  <span className="text-[10px] text-slate-500 truncate">
                    {roleLabel(d.user.role)}
                    {d.location ? ` · ${d.location}` : ""}
                  </span>
                  <span className="flex-1" />
                  <span className="text-[10px] text-slate-500 flex-shrink-0">
                    {relativeTime(d.startedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

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
            <div className="text-base font-bold text-ink">Production - last 7 days</div>
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
                  {d.bricks > 0 ? formatNumber(d.bricks) : "-"}
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

        {/* Today's activity — cash movements, gated behind revenue access */}
        {canRevenue && (
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
        )}

        {/* Overdue tasks across the team. The owner's delegation blind spot:
            a task nobody did is invisible until somebody looks at /tasks. */}
        <Card className="lg:col-span-1">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">Overdue tasks</div>
              <div className="text-xs text-slate-500">Open past their due date</div>
            </div>
            <Link href="/tasks" className="text-xs font-semibold text-brand-blue">
              All tasks →
            </Link>
          </div>
          {overdueTasks.length === 0 ? (
            <div className="text-center text-sm text-slate-500 py-6">Nothing overdue.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {overdueTasks.map((t) => (
                <Link
                  key={t.id}
                  href="/tasks"
                  className="block py-2 hover:bg-slate-50 -mx-2 px-2 rounded-lg"
                >
                  <div className="text-[12px] font-semibold text-ink truncate">{t.title}</div>
                  <div className="text-[10px] text-slate-500 truncate">
                    {t.assignedTo.name}
                    {t.dueDate ? ` · due ${t.dueDate.toLocaleDateString("en-IN")}` : ""}
                  </div>
                </Link>
              ))}
              {overdueTaskCount > overdueTasks.length && (
                <div className="text-[11px] text-slate-500 pt-2">
                  {overdueTaskCount - overdueTasks.length} more overdue.
                </div>
              )}
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
              { k: "Drying", v: stageMap.drying, c: "#F59E0B", age: "1-3 d" },
              { k: "Curing", v: stageMap.curing, c: "#1F4FFF", age: "4-10 d" },
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

        {/* Raw material stock */}
        <Card className="lg:col-span-3">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">Raw material stock</div>
              <div className="text-xs text-slate-500">On hand · drawn down by production</div>
            </div>
            <Link
              href="/settings/material-stock"
              className="text-[11px] font-semibold text-brand-blue hover:underline"
            >
              Manage
            </Link>
          </div>
          {materialStock.length === 0 ? (
            <div className="text-xs text-slate-400 py-2">
              No materials yet. <Link href="/settings/materials" className="text-brand-blue underline">Add materials</Link>.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[...materialStock]
                .sort((a, b) => a.material.name.localeCompare(b.material.name))
                .map((ms) => {
                  const low = ms.reorderAt > 0 && ms.quantity <= ms.reorderAt;
                  return (
                    <div
                      key={ms.id}
                      className={`rounded-xl p-3 text-center border ${
                        low ? "bg-red-50 border-red-200" : "bg-slate-50 border-transparent"
                      }`}
                    >
                      <div className={`num display text-lg font-bold ${low ? "text-red-600" : "text-ink"}`}>
                        {ms.quantity.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                      </div>
                      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                        {ms.material.name}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {ms.material.unit}
                        {low ? " · low" : ""}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
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
