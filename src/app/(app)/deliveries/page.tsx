import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, PageHeader, Pill, EmptyState } from "@/components/ui";
import { formatINR, formatNumber, formatLongDate, startOfDay } from "@/lib/format";
import { setDeliveryDone } from "../clients/actions";
import { DeliveryDoneToggle } from "./done-toggle";

const monthShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = sp?.days ? Math.max(1, parseInt(sp.days, 10) || 30) : 30;
  const since = new Date(startOfDay().getTime() - (days - 1) * 86400000);

  const deliveries = await prisma.delivery.findMany({
    where: { date: { gte: since } },
    include: {
      order: { include: { client: true } },
      items: { include: { brickSize: true, constructionType: true } },
      addOns: true,
      returns: true,
    },
    orderBy: { date: "desc" },
  });

  // Group by calendar day (newest first), preserving the desc order.
  const groups: Array<{ key: string; date: Date; rows: typeof deliveries }> = [];
  for (const d of deliveries) {
    const key = dayKey(d.date);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, date: d.date, rows: [] };
      groups.push(g);
    }
    g.rows.push(d);
  }

  const pendingCount = deliveries.filter((d) => !d.completedAt).length;

  const presets = [
    { d: 7, label: "7 days" },
    { d: 30, label: "30 days" },
    { d: 90, label: "90 days" },
  ];

  return (
    <>
      <PageHeader
        title="Deliveries"
        sub="Daily delivery log, newest first - tick each off in the evening"
      />

      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex gap-1.5">
          {presets.map((p) => (
            <Link
              key={p.d}
              href={`/deliveries?days=${p.d}`}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold ${
                days === p.d ? "bg-ink text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
        {pendingCount > 0 && (
          <Pill tone="warning">{pendingCount} not marked done</Pill>
        )}
      </div>

      {deliveries.length === 0 ? (
        <EmptyState title="No deliveries in this period" sub="Deliveries you record will show up here by day." />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const dayTotal = g.rows.reduce((s, d) => {
              const items = d.items.reduce((x, i) => x + i.total, 0);
              const add = d.addOns.reduce((x, a) => x + a.total, 0);
              const ref = d.returns.reduce((x, r) => x + r.refundAmount, 0);
              return s + items + add - ref;
            }, 0);
            return (
              <div key={g.key}>
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-sm font-bold text-ink">
                    {formatLongDate(g.date)}
                  </h2>
                  <span className="text-[12px] text-slate-500">
                    {g.rows.length} {g.rows.length === 1 ? "delivery" : "deliveries"} ·{" "}
                    <span className="num font-semibold text-ink">{formatINR(dayTotal)}</span>
                  </span>
                </div>
                <div className="bg-white rounded-2xl border border-slate-900/[.06] divide-y divide-slate-100">
                  {g.rows.map((d) => {
                    const items = d.items.reduce((x, i) => x + i.total, 0);
                    const add = d.addOns.reduce((x, a) => x + a.total, 0);
                    const ref = d.returns.reduce((x, r) => x + r.refundAmount, 0);
                    const total = items + add - ref;
                    return (
                      <div key={d.id} className="flex items-center gap-3 p-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/clients/${d.order.clientId}`}
                              className="text-[14px] font-bold text-ink hover:text-brand-blue truncate"
                            >
                              {d.order.client.name}
                            </Link>
                            {d.order.client.location && (
                              <span className="text-[11px] text-slate-500 truncate">
                                {d.order.client.location}
                              </span>
                            )}
                            <span className="text-[10px] mono text-slate-400">
                              {monthShort[d.date.getMonth()]} {d.date.getDate()}
                            </span>
                          </div>
                          <div className="text-[12px] text-slate-600 mt-0.5 truncate">
                            {d.items
                              .map((i) => `${formatNumber(i.quantity)} × ${i.brickSize.label} ${i.constructionType.name}`)
                              .join(", ")}
                            {add > 0 ? ` · +${formatINR(add)} add-ons` : ""}
                            {ref > 0 ? ` · -${formatINR(ref)} return` : ""}
                            {d.truckPlate ? ` · ${d.truckPlate}` : ""}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="num text-[14px] font-bold text-ink">{formatINR(total)}</div>
                        </div>
                        <DeliveryDoneToggle
                          id={d.id}
                          done={!!d.completedAt}
                          onToggle={async (id, done) => {
                            "use server";
                            await setDeliveryDone(id, done);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
