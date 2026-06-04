import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Avatar, Card, PageHeader, Pill, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatINR, formatNumber, formatShortDate } from "@/lib/format";
import { PaymentForm } from "./payment-form";
import { recordPayment } from "../actions";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      orders: {
        include: {
          items: { include: { brickSize: true, constructionType: true } },
          deliveries: {
            include: {
              items: { include: { brickSize: true, constructionType: true } },
              addOns: true,
              returns: true,
            },
            orderBy: { date: "desc" },
          },
          payments: { orderBy: { date: "desc" } },
        },
        orderBy: { date: "desc" },
      },
    },
  });
  if (!client) notFound();

  // Roll up totals
  let ordered = 0,
    deliveredAmt = 0,
    addOns = 0,
    refunded = 0,
    paid = 0;
  for (const o of client.orders) {
    ordered += o.items.reduce((s, i) => s + i.total, 0);
    paid += o.payments.reduce((s, p) => s + p.amount, 0);
    for (const d of o.deliveries) {
      deliveredAmt += d.items.reduce((s, i) => s + i.total, 0);
      addOns += d.addOns.reduce((s, a) => s + a.total, 0);
      refunded += d.returns.reduce((s, r) => s + r.refundAmount, 0);
    }
  }
  const balance = ordered + addOns - refunded - paid;

  return (
    <>
      <PageHeader
        title={client.name}
        sub={`${client.location ?? "—"} ${client.phone ? `· ${client.phone}` : ""}`}
        back="/clients"
        right={
          <Link
            href={`/clients/${id}/orders/new`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-red text-white text-[13px] font-semibold shadow-red"
          >
            <Icon.Plus size={16} stroke={2.4} /> New order
          </Link>
        }
      />

      <div className="grid sm:grid-cols-4 gap-3 mb-5">
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Ordered
          </div>
          <div className="num display text-lg font-bold mt-0.5">{formatINR(ordered)}</div>
        </Card>
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Delivered
          </div>
          <div className="num display text-lg font-bold mt-0.5">
            {formatINR(deliveredAmt + addOns - refunded)}
          </div>
          {(addOns > 0 || refunded > 0) && (
            <div className="text-[10px] text-slate-500 mt-0.5">
              {addOns > 0 ? `+${formatINR(addOns)} add-ons` : ""}
              {refunded > 0 ? ` −${formatINR(refunded)} returns` : ""}
            </div>
          )}
        </Card>
        <Card padding="tight">
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Paid
          </div>
          <div className="num display text-lg font-bold mt-0.5 text-emerald-700">
            {formatINR(paid)}
          </div>
        </Card>
        <Card padding="tight" className={balance > 0 ? "border-2 border-brand-red/30" : ""}>
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            Balance due
          </div>
          <div
            className={`num display text-lg font-bold mt-0.5 ${
              balance > 0 ? "text-brand-red" : "text-emerald-700"
            }`}
          >
            {formatINR(Math.max(0, balance))}
          </div>
        </Card>
      </div>

      {/* Quick payment + order list */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-bold text-ink">Orders</h2>
            <Link
              href={`/clients/${id}/orders/new`}
              className="text-xs font-semibold text-brand-blue"
            >
              + New order
            </Link>
          </div>
          {client.orders.length === 0 ? (
            <EmptyState title="No orders yet" sub="Create the first order to get started." />
          ) : (
            client.orders.map((o) => {
              const orderedQty = o.items.reduce((s, i) => s + i.quantity, 0);
              const deliveredQty = o.deliveries.reduce(
                (s, d) =>
                  s +
                  d.items.reduce((x, i) => x + i.quantity, 0) -
                  d.returns.reduce((x, r) => x + r.brickCount, 0),
                0
              );
              const oTotal = o.items.reduce((s, i) => s + i.total, 0);
              const oPaid = o.payments.reduce((s, p) => s + p.amount, 0);
              const oAddOns = o.deliveries.reduce(
                (s, d) => s + d.addOns.reduce((x, a) => x + a.total, 0),
                0
              );
              const oRefund = o.deliveries.reduce(
                (s, d) => s + d.returns.reduce((x, r) => x + r.refundAmount, 0),
                0
              );
              const oBalance = oTotal + oAddOns - oRefund - oPaid;
              return (
                <Card key={o.id}>
                  <div className="flex items-baseline justify-between mb-2">
                    <div>
                      <div className="text-[12px] text-slate-500 mono">
                        Order placed {formatShortDate(o.date)}
                        {o.expectedDeliveryDate
                          ? ` · expected ${formatShortDate(o.expectedDeliveryDate)}`
                          : ""}
                      </div>
                      <div className="num text-[14px] font-bold mt-0.5">{formatINR(oTotal)}</div>
                    </div>
                    <Pill
                      tone={
                        o.status === "complete"
                          ? "success"
                          : o.status === "partial"
                            ? "blue"
                            : "warning"
                      }
                    >
                      {o.status}
                    </Pill>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-[12px] mb-2">
                    {o.items.map((it) => (
                      <div key={it.id} className="flex justify-between">
                        <span>
                          {it.brickSize.label} · {it.constructionType.name} ·{" "}
                          {formatNumber(it.quantity)} bricks @ ₹{it.pricePerBrick}
                        </span>
                        <span className="num font-semibold">{formatINR(it.total)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-baseline justify-between text-[12px] mb-3">
                    <div className="text-slate-500">
                      Delivered <span className="num font-semibold text-ink">{formatNumber(deliveredQty)}</span>
                      <span className="text-slate-400"> / {formatNumber(orderedQty)}</span>
                    </div>
                    <div>
                      Balance:{" "}
                      <span
                        className={`num font-bold ${
                          oBalance > 0 ? "text-brand-red" : "text-emerald-700"
                        }`}
                      >
                        {formatINR(Math.max(0, oBalance))}
                      </span>
                    </div>
                  </div>
                  {o.deliveries.length > 0 && (
                    <div className="border-t border-slate-100 pt-2 mb-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                        Deliveries
                      </div>
                      {o.deliveries.map((d) => {
                        const dTotal = d.items.reduce((s, i) => s + i.total, 0);
                        const dAdd = d.addOns.reduce((s, a) => s + a.total, 0);
                        const dRef = d.returns.reduce((s, r) => s + r.refundAmount, 0);
                        return (
                          <div
                            key={d.id}
                            className="flex items-baseline justify-between text-[12px] py-1"
                          >
                            <div>
                              <span className="mono text-slate-500">{formatShortDate(d.date)}</span>{" "}
                              {d.items.map((i) => `${formatNumber(i.quantity)} ${i.brickSize.label}`).join(", ")}
                              {dAdd > 0 ? ` + ${formatINR(dAdd)} add-ons` : ""}
                              {dRef > 0 ? ` − ${formatINR(dRef)} return` : ""}
                            </div>
                            <span className="num font-semibold">{formatINR(dTotal + dAdd - dRef)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <Link
                      href={`/clients/${id}/orders/${o.id}/deliveries/new`}
                      className="text-[12px] font-semibold text-brand-blue"
                    >
                      + Add delivery
                    </Link>
                  </div>
                </Card>
              );
            })
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <h3 className="text-[14px] font-bold mb-3">Record payment</h3>
            <PaymentForm
              clientId={id}
              orders={client.orders.map((o) => ({
                id: o.id,
                label: `${formatShortDate(o.date)} · ${formatINR(
                  o.items.reduce((s, i) => s + i.total, 0)
                )}`,
              }))}
              onSubmit={async (d) => {
                "use server";
                await recordPayment(d);
              }}
            />
          </Card>

          <Card>
            <h3 className="text-[14px] font-bold mb-3">Recent payments</h3>
            {client.orders.flatMap((o) => o.payments).length === 0 ? (
              <div className="text-center text-sm text-slate-500 py-4">No payments recorded.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {client.orders
                  .flatMap((o) => o.payments)
                  .sort((a, b) => b.date.getTime() - a.date.getTime())
                  .slice(0, 8)
                  .map((p) => (
                    <div key={p.id} className="flex justify-between items-center py-2">
                      <div>
                        <div className="text-[12px] font-semibold capitalize">{p.method}</div>
                        <div className="text-[10px] text-slate-500">{formatShortDate(p.date)}</div>
                      </div>
                      <div className="num text-[13px] font-bold text-emerald-700">
                        +{formatINR(p.amount)}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
