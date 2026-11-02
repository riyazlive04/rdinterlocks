import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { can } from "@/lib/access";
import { isFullAccess } from "@/lib/roles";
import { Card, EmptyState, PageHeader, Pill, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatShortDate } from "@/lib/format";
import { setOrderFulfilmentStage } from "./actions";
import { StageControl } from "./stage-control";
import {
  FULFILMENT_STAGES,
  STAGE_LABEL,
  STAGE_SUB,
  STAGE_TONE,
  normalizeStage,
  waitingLabel,
  type FulfilmentStage,
} from "./stage";

const QUEUE_LIMIT = 200;

/**
 * The production-and-dispatch queue — the supervisor's working screen.
 *
 * It lists orders whose payment a manager has APPROVED (`approvedAt` set) and
 * which are still live, grouped by `fulfilmentStage`, oldest-waiting first.
 * The approval gate is the point: nothing goes on the machine on the strength
 * of a promise, and nothing the supervisor sees here is unpaid.
 *
 * Alongside each order sits godown readiness — whether there are actually
 * enough `ready` bricks for what is still undelivered on it. A supervisor who
 * only learns that at the lorry has already wasted a trip.
 *
 * This page does NOT move stock. Dispatch is recorded in Deliveries, which
 * draws the batches down; `dispatched` here is the shop-floor note that the
 * lorry went, and the row links across to do the real thing.
 */
export default async function FulfilmentPage() {
  const session = await requireArea("production");
  const canRevenue = can(session, "revenue");
  const canOverride = isFullAccess(session.role);

  const [orders, readyStock, brickSizes] = await Promise.all([
    prisma.order.findMany({
      where: {
        // "Payment approved" is the entry condition for the queue.
        approvedAt: { not: null },
        status: { notIn: ["complete", "cancelled"] },
      },
      // Oldest-waiting first, globally — so within every stage group below,
      // the order that has sat longest is the first one the eye lands on.
      orderBy: { stageChangedAt: "asc" },
      take: QUEUE_LIMIT,
      include: {
        client: { select: { id: true, name: true, location: true } },
        approvedBy: { select: { name: true } },
        items: { include: { brickSize: { select: { id: true, label: true } } } },
        // Needed to know what is still OUTSTANDING on the order: a part-
        // delivered order needs stock for the remainder, not the whole thing.
        deliveries: { include: { items: { select: { brickSizeId: true, quantity: true } } } },
      },
    }),
    prisma.stockBatch.groupBy({
      by: ["brickSizeId"],
      where: { stage: "ready", remaining: { gt: 0 } },
      _sum: { remaining: true },
    }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" }, select: { id: true, label: true } }),
  ]);

  const sizeLabel = new Map(brickSizes.map((b) => [b.id, b.label]));
  const readyBySize = new Map(readyStock.map((r) => [r.brickSizeId, r._sum.remaining ?? 0]));
  const totalReady = [...readyBySize.values()].reduce((s, v) => s + v, 0);

  // Godown readiness.
  //
  // Ready stock is a SHARED pool, so checking each order against the full
  // total independently would tell the supervisor that three orders are all
  // dispatchable when there are only enough bricks for the first. Instead the
  // pool is allocated down the queue in the same oldest-first order the page
  // renders: each order is judged against what is left after the ones ahead
  // of it have taken theirs. Dispatched orders are skipped — their bricks
  // already left the godown, so they are not competing for this pool.
  const pool = new Map(readyBySize);

  type Need = { label: string; need: number; have: number; short: number };
  type Row = {
    order: (typeof orders)[number];
    stage: FulfilmentStage;
    needs: Need[];
    pendingTotal: number;
    shortTotal: number;
    orderedValue: number;
  };

  const rows: Row[] = orders.map((o) => {
    const stage = normalizeStage(o.fulfilmentStage);

    // Ordered minus delivered, per brick size.
    const pending = new Map<string, number>();
    for (const it of o.items) {
      pending.set(it.brickSizeId, (pending.get(it.brickSizeId) ?? 0) + it.quantity);
    }
    for (const d of o.deliveries) {
      for (const it of d.items) {
        pending.set(it.brickSizeId, (pending.get(it.brickSizeId) ?? 0) - it.quantity);
      }
    }

    const needs: Need[] = [];
    for (const [sizeId, qty] of pending) {
      if (qty <= 0) continue;
      if (stage === "dispatched") {
        // Already gone — report it as met rather than claiming a shortfall
        // against stock it no longer needs.
        needs.push({
          label: sizeLabel.get(sizeId) ?? "Unknown size",
          need: qty,
          have: qty,
          short: 0,
        });
        continue;
      }
      const have = pool.get(sizeId) ?? 0;
      const taken = Math.min(qty, have);
      pool.set(sizeId, have - taken);
      needs.push({
        label: sizeLabel.get(sizeId) ?? "Unknown size",
        need: qty,
        have,
        short: qty - taken,
      });
    }

    return {
      order: o,
      stage,
      needs,
      pendingTotal: needs.reduce((s, n) => s + n.need, 0),
      shortTotal: needs.reduce((s, n) => s + n.short, 0),
      orderedValue: o.items.reduce((s, i) => s + i.total, 0),
    };
  });

  const byStage = new Map<FulfilmentStage, Row[]>(FULFILMENT_STAGES.map((s) => [s, []]));
  for (const r of rows) byStage.get(r.stage)!.push(r);

  const dispatchable = rows.filter(
    (r) => r.stage === "ready" && r.shortTotal === 0 && r.pendingTotal > 0
  ).length;
  const shortCount = rows.filter((r) => r.stage !== "dispatched" && r.shortTotal > 0).length;

  return (
    <>
      <PageHeader
        title="Production queue"
        sub="Paid orders, oldest waiting first"
        right={
          <Link
            href="/deliveries"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
          >
            <Icon.Truck size={16} />
            <span className="hidden sm:inline">Deliveries</span>
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard
          label="Queued"
          value={formatNumber(byStage.get("queued")!.length)}
          sub="Nothing started yet"
          tone={byStage.get("queued")!.length > 0 ? "red" : "default"}
        />
        <StatCard
          label="In production"
          value={formatNumber(byStage.get("in_production")!.length)}
          tone="ink"
        />
        <StatCard
          label="Dispatchable now"
          value={formatNumber(dispatchable)}
          sub={`${formatNumber(byStage.get("ready")!.length)} marked ready`}
          tone="success"
        />
        <StatCard
          label="Short on stock"
          value={formatNumber(shortCount)}
          sub={`${formatNumber(totalReady)} bricks ready in godown`}
          tone={shortCount > 0 ? "red" : "default"}
        />
      </div>

      {/* Ready stock by size — the pool every row below is judged against. */}
      <Card className="mb-5">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-base font-bold text-ink">Godown - ready stock</div>
            <div className="text-xs text-slate-500">Cured and sellable, by size</div>
          </div>
          <Link href="/production" className="text-xs font-semibold text-brand-blue">
            Production →
          </Link>
        </div>
        {readyBySize.size === 0 ? (
          <div className="text-xs text-slate-400 py-2">
            No cured stock. Nothing on this queue can go out until a batch reaches ready.
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
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
                </div>
              ))}
          </div>
        )}
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing in the queue"
          sub="An order lands here once a manager approves the payment on it. Until then it sits in Payment approvals."
          action={
            <Link
              href="/clients"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
            >
              <Icon.Users size={16} /> Clients and orders
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {FULFILMENT_STAGES.map((stage) => {
            const group = byStage.get(stage)!;
            return (
              <div key={stage}>
                <div className="flex items-baseline justify-between mb-2">
                  <div>
                    <div className="text-base font-bold text-ink">{STAGE_LABEL[stage]}</div>
                    <div className="text-xs text-slate-500">{STAGE_SUB[stage]}</div>
                  </div>
                  <span className="num text-[11px] font-semibold text-slate-500">
                    {group.length} order{group.length === 1 ? "" : "s"}
                  </span>
                </div>

                {group.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-[12px] text-slate-400">
                    Nothing at this stage.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {group.map((r) => {
                      const o = r.order;
                      const covered = r.shortTotal === 0 && r.pendingTotal > 0;
                      return (
                        <Card key={o.id}>
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Link
                                  href={`/clients/${o.clientId}`}
                                  className="text-[14px] font-bold text-ink underline truncate"
                                >
                                  {o.client.name}
                                </Link>
                                <Pill tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Pill>
                                <Pill tone="slate">Waiting {waitingLabel(o.stageChangedAt)}</Pill>
                                {o.status === "partial" && <Pill tone="info">Part delivered</Pill>}
                              </div>
                              <div className="text-[12px] text-slate-500 truncate mt-0.5">
                                {o.client.location || "Location not captured"}
                                {o.expectedDeliveryDate
                                  ? ` · expected ${formatShortDate(o.expectedDeliveryDate)}`
                                  : ""}
                              </div>

                              {/* Items with quantities — what actually has to
                                  be made, not the money. */}
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {o.items.length === 0 ? (
                                  <span className="text-[11px] text-slate-400">
                                    No items on this order
                                  </span>
                                ) : (
                                  o.items.map((it) => (
                                    <Pill key={it.id} tone="slate">
                                      {it.brickSize.label} · {formatNumber(it.quantity)}
                                    </Pill>
                                  ))
                                )}
                              </div>

                              <div className="text-[11px] text-slate-500 mt-2">
                                Approved {o.approvedAt ? formatShortDate(o.approvedAt) : "-"}
                                {o.approvedBy ? ` by ${o.approvedBy.name}` : ""}
                                {` · ordered ${formatShortDate(o.date)}`}
                              </div>
                            </div>

                            {canRevenue && (
                              <div className="num text-[15px] font-bold text-ink flex-shrink-0">
                                {formatINR(r.orderedValue, { compact: true })}
                              </div>
                            )}
                          </div>

                          {/* Godown readiness for what is still undelivered. */}
                          {r.needs.length === 0 ? (
                            <div className="mt-2 text-[11px] text-slate-400">
                              Everything on this order has been delivered.
                            </div>
                          ) : stage === "dispatched" ? (
                            <div className="mt-2 text-[11px] text-slate-500">
                              {formatNumber(r.pendingTotal)} bricks out on dispatch — record the
                              delivery in{" "}
                              <Link href="/deliveries" className="text-brand-blue underline">
                                Deliveries
                              </Link>
                              .
                            </div>
                          ) : (
                            <div
                              className={`mt-2 rounded-xl px-3 py-2 text-[12px] border ${
                                covered
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                                  : "bg-red-50 border-red-200 text-red-800"
                              }`}
                            >
                              <div className="flex items-center gap-1.5 font-semibold">
                                {covered ? <Icon.Check size={14} /> : <Icon.Bell size={14} />}
                                {covered
                                  ? `Stock available - ${formatNumber(r.pendingTotal)} bricks dispatchable`
                                  : `Short ${formatNumber(r.shortTotal)} of ${formatNumber(r.pendingTotal)} bricks`}
                              </div>
                              <div className="mt-1 opacity-90">
                                {r.needs
                                  .map(
                                    (n) =>
                                      `${n.label}: need ${formatNumber(n.need)}, ready ${formatNumber(n.have)}`
                                  )
                                  .join(" · ")}
                              </div>
                              {covered && stage === "ready" && (
                                <Link
                                  href="/deliveries"
                                  className="inline-flex items-center gap-1 mt-1.5 font-semibold underline"
                                >
                                  <Icon.Truck size={13} /> Load it in Deliveries
                                </Link>
                              )}
                            </div>
                          )}

                          <StageControl
                            orderId={o.id}
                            stage={stage}
                            canOverride={canOverride}
                            onSetStage={setOrderFulfilmentStage}
                          />
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="text-[11px] text-slate-400 mt-5">
        Stages move one step at a time - queued, in production, ready, dispatched. Only a manager
        can correct one backwards. Stock is drawn down by Deliveries, not by this screen.
      </div>
    </>
  );
}
