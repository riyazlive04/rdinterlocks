import Link from "next/link";
import type { Session } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, PageHeader, Pill, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatLongDate, startOfDay, endOfDay } from "@/lib/format";
import { can } from "@/lib/access";
import {
  FULFILMENT_STAGES,
  STAGE_LABEL,
  STAGE_SUB,
  STAGE_TONE,
  normalizeStage,
  waitingLabel,
  type FulfilmentStage,
} from "../fulfilment/stage";
import { unallocatedStock, type AllocatableOrder } from "@/lib/allocation";

const QUEUE_PREVIEW = 60;
const PER_STAGE_PREVIEW = 3;

/**
 * The supervisor's dashboard — the shop floor, and nothing else.
 *
 * Deliberately free of leads and quotations: a supervisor who logs in at 6am
 * needs to know what to put on the machine, what is cured enough to go out,
 * what was made today, and what they personally owe somebody. The selling
 * side of the business is not their screen and would only push those four
 * things below the fold.
 *
 * The stage vocabulary and the "waiting 3d" phrasing are imported from the
 * production queue rather than restated, so the dashboard and the queue can
 * never label the same order differently.
 */
export default async function SupervisorPanel({ session }: { session: Session }) {
  const canRevenue = can(session, "revenue");
  const today = startOfDay();
  const todayEnd = endOfDay();

  const [orders, readyStock, brickSizes, todayEntries, todayTotals, myTasks] = await Promise.all([
    prisma.order.findMany({
      // Same entry condition as /fulfilment: payment approved, still live.
      where: {
        approvedAt: { not: null },
        status: { notIn: ["complete", "cancelled"] },
      },
      // Oldest-waiting first, so the head of each stage column below is the
      // order that has been sitting longest.
      orderBy: { stageChangedAt: "asc" },
      take: QUEUE_PREVIEW,
      include: {
        client: { select: { id: true, name: true, location: true } },
        items: { select: { id: true, quantity: true, brickSize: { select: { label: true } } } },
      },
    }),
    prisma.stockBatch.groupBy({
      by: ["brickSizeId"],
      where: { stage: "ready", remaining: { gt: 0 } },
      _sum: { remaining: true },
    }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" }, select: { id: true, label: true } }),
    prisma.productionEntry.findMany({
      where: { date: { gte: today, lte: todayEnd } },
      orderBy: { createdAt: "desc" },
      include: { brickSize: { select: { label: true } }, machine: { select: { name: true } } },
    }),
    prisma.productionEntry.aggregate({
      where: { date: { gte: today, lte: todayEnd } },
      _sum: { brickCount: true, damagedCount: true, cementBagsUsed: true, totalWage: true },
    }),
    prisma.task.findMany({
      // "not done", not "is open": the live database defaults Task.status to
      // `wip`, so filtering on "open" exactly hid every in-progress task
      // from this panel while the tasks page listed it.
      where: { assignedToId: session.userId, status: { not: "done" } },
      // Dated tasks first and earliest-due at the top; undated ones trail.
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: 8,
      include: { createdBy: { select: { name: true } } },
    }),
  ]);

  const readyBySize = new Map(readyStock.map((r) => [r.brickSizeId, r._sum.remaining ?? 0]));
  const totalReady = [...readyBySize.values()].reduce((s, v) => s + v, 0);

  // How much of that is actually FREE.
  //
  // This tile used to show the whole ready total as though it were available,
  // while /fulfilment showed most of it already committed to orders in the
  // queue — the same bricks read as free here and spoken for there. Both now
  // read lib/allocation.ts.
  //
  // A second query rather than reusing `orders` above: that one is
  // `take: QUEUE_PREVIEW`, and allocating against a truncated queue would
  // under-count what is committed and overstate what is free.
  const liveQueue = await prisma.order.findMany({
    where: { approvedAt: { not: null }, status: { notIn: ["complete", "cancelled"] } },
    select: {
      id: true,
      stageChangedAt: true,
      fulfilmentStage: true,
      items: { select: { brickSizeId: true, quantity: true } },
      deliveries: { select: { items: { select: { brickSizeId: true, quantity: true } } } },
    },
  });
  const allocatable: AllocatableOrder[] = liveQueue.map((o) => ({
    id: o.id,
    stageChangedAt: o.stageChangedAt,
    fulfilmentStage: normalizeStage(o.fulfilmentStage),
    ordered: o.items,
    delivered: o.deliveries.flatMap((d) => d.items),
  }));
  const freeBySize = unallocatedStock(allocatable, readyBySize);
  const totalFree = [...freeBySize.values()].reduce((s, v) => s + Math.max(0, v), 0);
  const totalCommitted = totalReady - totalFree;

  type QueueOrder = (typeof orders)[number];
  const byStage = new Map<FulfilmentStage, QueueOrder[]>(
    FULFILMENT_STAGES.map((s) => [s, []])
  );
  for (const o of orders) byStage.get(normalizeStage(o.fulfilmentStage))!.push(o);

  const overdueTasks = myTasks.filter((t) => t.dueDate && t.dueDate < today).length;

  return (
    <>
      <PageHeader
        title={`Hi, ${session.name}`}
        sub={formatLongDate(new Date())}
        right={
          <Link
            href="/fulfilment"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold shadow-red hover:bg-brand-redDark"
          >
            <Icon.Truck size={16} />
            <span className="hidden sm:inline">Production queue</span>
          </Link>
        }
      />

      {/* What to do first. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
        {[
          { label: "Production", href: "/production/new", icon: "Brick" as const },
          { label: "Queue", href: "/fulfilment", icon: "Truck" as const },
          { label: "Deliveries", href: "/deliveries", icon: "Box" as const },
          { label: "Daily entry", href: "/day", icon: "Calendar" as const },
        ].map((q) => {
          const Ic = Icon[q.icon];
          return (
            <Link
              key={q.label}
              href={q.href}
              className="bg-white rounded-2xl p-3 border border-slate-200 hover:border-slate-400 transition flex items-center gap-2.5"
            >
              <div className="w-9 h-9 rounded-xl bg-brand-redLight text-brand-red flex items-center justify-center flex-shrink-0">
                <Ic size={17} />
              </div>
              <span className="text-[12px] font-semibold text-ink">{q.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard
          label="Queued"
          value={formatNumber(byStage.get("queued")!.length)}
          sub="Paid, not started"
          tone={byStage.get("queued")!.length > 0 ? "red" : "default"}
        />
        <StatCard
          label="Produced today"
          value={formatNumber(todayTotals._sum.brickCount ?? 0)}
          sub={`${todayTotals._sum.damagedCount ?? 0} damaged · ${(todayTotals._sum.cementBagsUsed ?? 0).toFixed(1)} bags`}
          tone="ink"
        />
        <StatCard
          label="Ready in godown"
          value={formatNumber(totalReady)}
          sub={
            totalCommitted > 0
              ? `${formatNumber(totalFree)} free · ${formatNumber(totalCommitted)} committed`
              : "Cured, and none of it spoken for"
          }
          tone="success"
        />
        <StatCard
          label="My open tasks"
          value={formatNumber(myTasks.length)}
          sub={overdueTasks > 0 ? `${overdueTasks} overdue` : "Nothing overdue"}
          tone={overdueTasks > 0 ? "red" : "default"}
        />
      </div>

      {/* The queue, oldest first in every stage. Links through rather than
          duplicating the controls — the stage only moves on /fulfilment. */}
      <Card className="mb-4">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-base font-bold text-ink">Order queue</div>
            <div className="text-xs text-slate-500">Longest waiting at the top of each column</div>
          </div>
          <Link href="/fulfilment" className="text-xs font-semibold text-brand-blue">
            Open queue →
          </Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {FULFILMENT_STAGES.map((stage) => {
            const group = byStage.get(stage)!;
            return (
              <div key={stage} className="bg-slate-50 rounded-xl p-3">
                <div className="flex items-baseline justify-between">
                  <Pill tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Pill>
                  <span className="num display text-lg font-bold text-ink leading-none">
                    {formatNumber(group.length)}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">{STAGE_SUB[stage]}</div>
                {group.length === 0 ? (
                  <div className="text-[11px] text-slate-400 mt-2">Empty.</div>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {group.slice(0, PER_STAGE_PREVIEW).map((o) => (
                      <Link
                        key={o.id}
                        href="/fulfilment"
                        className="block bg-white rounded-lg px-2 py-1.5 border border-slate-200 hover:border-slate-400"
                      >
                        <div className="text-[12px] font-semibold text-ink truncate">
                          {o.client.name}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {o.items
                            .map((i) => `${i.brickSize.label} ${formatNumber(i.quantity)}`)
                            .join(" · ") || "No items"}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          waiting {waitingLabel(o.stageChangedAt)}
                        </div>
                      </Link>
                    ))}
                    {group.length > PER_STAGE_PREVIEW && (
                      <div className="text-[10px] text-slate-500">
                        +{group.length - PER_STAGE_PREVIEW} more
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Stock readiness by size — what can actually go out today. */}
        <Card className="lg:col-span-1">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">Ready stock by size</div>
              <div className="text-xs text-slate-500">Cured batches, remaining count</div>
            </div>
          </div>
          {readyBySize.size === 0 ? (
            <div className="text-[12px] text-slate-500 py-4 text-center">
              Nothing cured yet. Nothing can be dispatched.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {brickSizes
                .filter((b) => (readyBySize.get(b.id) ?? 0) > 0)
                .map((b) => (
                  <div key={b.id} className="bg-slate-50 rounded-xl p-3 text-center">
                    <div className="num display text-lg font-bold text-ink">
                      {formatNumber(readyBySize.get(b.id) ?? 0)}
                    </div>
                    <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                      {b.label}
                    </div>
                    {/* Free, spelled out in words — the number above is the
                        godown count, not what the next order can have. */}
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {formatNumber(Math.max(0, freeBySize.get(b.id) ?? 0))} free
                    </div>
                  </div>
                ))}
            </div>
          )}
        </Card>

        {/* Today's production entries. */}
        <Card className="lg:col-span-2">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">Production today</div>
              <div className="text-xs text-slate-500">
                {formatNumber(todayEntries.length)} entr
                {todayEntries.length === 1 ? "y" : "ies"} recorded
              </div>
            </div>
            <Link href="/production/new" className="text-xs font-semibold text-brand-blue">
              New entry →
            </Link>
          </div>
          {todayEntries.length === 0 ? (
            <div className="text-[12px] text-slate-500 py-6 text-center">
              Nothing recorded today yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {todayEntries.map((e) => (
                <Link
                  key={e.id}
                  href="/production"
                  className="flex items-center gap-3 py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded-lg"
                >
                  <div className="w-7 h-7 rounded-lg bg-brand-redLight text-brand-red flex items-center justify-center flex-shrink-0">
                    <Icon.Brick size={13} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-ink truncate">
                      {e.brickSize.label} · {formatNumber(e.brickCount)}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {e.shift === "night" ? "Night" : "Day"} shift
                      {e.machine ? ` · ${e.machine.name}` : ""}
                      {e.damagedCount > 0 ? ` · ${e.damagedCount} damaged` : ""}
                      {` · ${e.cementBagsUsed.toFixed(1)} bags`}
                    </div>
                  </div>
                  {/* Wages are money, so they follow the revenue gate like
                      every other total on the dashboard. */}
                  {canRevenue && (
                    <div className="num text-[12px] font-bold text-ink flex-shrink-0">
                      {formatINR(e.totalWage, { compact: true })}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
          {canRevenue && todayEntries.length > 0 && (
            <div className="text-[11px] text-slate-500 mt-2">
              {formatINR(todayTotals._sum.totalWage ?? 0)} in operator wages today.
            </div>
          )}
        </Card>

        {/* Their own tasks. Not the team's — a supervisor does not need the
            telecallers' list to get through their morning. */}
        <Card className="lg:col-span-3">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-base font-bold text-ink">My tasks</div>
              <div className="text-xs text-slate-500">Open and assigned to me</div>
            </div>
            <Link href="/tasks" className="text-xs font-semibold text-brand-blue">
              All tasks →
            </Link>
          </div>
          {myTasks.length === 0 ? (
            <div className="text-[12px] text-slate-500 py-6 text-center">
              Nothing assigned to you.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {myTasks.map((t) => {
                const overdue = !!t.dueDate && t.dueDate < today;
                return (
                  <Link
                    key={t.id}
                    href="/tasks"
                    className="flex items-center gap-3 py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded-lg"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-ink truncate">{t.title}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {t.createdBy ? `From ${t.createdBy.name}` : "No sender recorded"}
                        {t.details ? ` · ${t.details}` : ""}
                      </div>
                    </div>
                    {t.dueDate ? (
                      <Pill tone={overdue ? "red" : "slate"}>
                        {overdue ? "Overdue " : "Due "}
                        {t.dueDate.toLocaleDateString("en-IN")}
                      </Pill>
                    ) : (
                      <Pill tone="slate">No date</Pill>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
