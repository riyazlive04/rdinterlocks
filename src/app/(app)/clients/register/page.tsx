import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { formatINR, formatISODate } from "@/lib/format";
import { requireArea } from "@/lib/auth";
import { ORDER_STATUSES, deriveOrderStatus } from "@/lib/order-status";
import { Pagination } from "@/components/pagination";
import { RegisterView, type RegisterRow } from "./register-view";
import { createRegisterRow, payRegisterRow } from "./actions";
import { setOrderStatus } from "../actions";

const PAGE_SIZE = 100;

// The sales register: the office's paper book as one screen. Every row is a
// customer's order — number, name, place, size, rate, money in, money left.
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  await requireArea("sales");
  const sp = await searchParams;
  const status = ORDER_STATUSES.some((s) => s.key === sp?.status) ? sp!.status! : "active";
  const q = sp?.q?.trim() ?? "";

  const [orders, sizes, types, prices] = await Promise.all([
    prisma.order.findMany({
      where: {
        status: { not: "cancelled" },
        ...(q
          ? {
              client: {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { location: { contains: q, mode: "insensitive" } },
                  { phone: { contains: q } },
                ],
              },
            }
          : {}),
      },
      include: {
        client: true,
        items: { include: { brickSize: true, constructionType: true } },
        payments: true,
        deliveries: { include: { items: true, returns: true, addOns: true } },
      },
      orderBy: { date: "desc" },
    }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.constructionType.findMany({ orderBy: { order: "asc" } }),
    prisma.brickPrice.findMany({ where: { active: true } }),
  ]);

  const now = new Date();
  // A row shows the order's first brick line — which is all a register row ever
  // holds. Multi-line orders still appear, with the extra lines rolled into the
  // amount so the money column stays true.
  const all: Array<RegisterRow & { statusKey: string }> = orders.map((o) => {
    const first = o.items[0];
    const itemTotal = o.items.reduce((s, i) => s + i.total, 0);
    const addOns = o.deliveries.reduce((s, d) => s + d.addOns.reduce((x, a) => x + a.total, 0), 0);
    const refunds = o.deliveries.reduce(
      (s, d) => s + d.returns.reduce((x, r) => x + r.refundAmount, 0),
      0
    );
    const amount = itemTotal + addOns - refunds;
    const paid = o.payments.reduce((s, p) => s + p.amount, 0);
    const orderedQty = o.items.reduce((s, i) => s + i.quantity, 0);
    let deliveredQty = 0;
    for (const d of o.deliveries) {
      deliveredQty += d.items.reduce((s, i) => s + i.quantity, 0);
      deliveredQty -= d.returns.reduce((s, r) => s + r.brickCount, 0);
    }
    const derived = deriveOrderStatus({
      orderedQty,
      deliveredQty,
      date: o.date,
      expectedDeliveryDate: o.expectedDeliveryDate,
      current: o.status,
      now,
    });
    return {
      statusKey: derived,
      orderId: o.id,
      clientId: o.clientId,
      date: o.date.toISOString(),
      phone: o.client.phone ?? "",
      name: o.client.name,
      location: o.client.location ?? "",
      brickSizeId: first?.brickSizeId ?? "",
      brickSize: first?.brickSize.label ?? "-",
      constructionTypeId: first?.constructionTypeId ?? "",
      constructionType: first?.constructionType.name ?? "-",
      quantity: orderedQty,
      pricePerBrick: first?.pricePerBrick ?? 0,
      amount,
      advance: paid,
      balance: Math.max(0, amount - paid),
      status: derived,
      notes: o.notes ?? "",
      expectedDeliveryDate: o.expectedDeliveryDate
        ? formatISODate(o.expectedDeliveryDate)
        : null,
    };
  });

  const counts = {
    upcoming: all.filter((r) => r.statusKey === "upcoming").length,
    active: all.filter((r) => r.statusKey === "active").length,
    completed: all.filter((r) => r.statusKey === "completed").length,
  };
  const filtered = all.filter((r) => r.statusKey === status);

  const page = Math.max(1, Number(sp?.page) || 1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const priceFor: Record<string, number> = {};
  for (const p of prices) priceFor[`${p.brickSizeId}:${p.constructionTypeId}`] = p.sellPrice;

  // Bricks that went out on a loading trip for a named customer but were never
  // billed — no order, so nothing in this register. These are the sales most
  // easily lost, so they get their own tab with everything but the rate filled
  // in already.
  const loadedRows = await prisma.loadingWork.findMany({
    where: { clientId: { not: null }, phase: { not: "unloading" }, loadType: "brick" },
    include: { client: true, brickSize: true },
    orderBy: { date: "desc" },
  });
  const billedGroups = new Set(
    (
      await prisma.delivery.findMany({
        where: { loadGroupId: { not: null } },
        select: { loadGroupId: true },
      })
    ).map((d) => d.loadGroupId)
  );

  const unbilledMap = new Map<
    string,
    {
      loadGroupId: string;
      date: string;
      clientId: string;
      clientName: string;
      phone: string;
      location: string;
      brickSizeId: string;
      sizeLabel: string;
      bricks: number;
    }
  >();
  for (const r of loadedRows) {
    const key = r.loadGroupId ?? r.id;
    if (billedGroups.has(key)) continue;
    const g = unbilledMap.get(key) ?? {
      loadGroupId: key,
      date: formatISODate(r.date),
      clientId: r.clientId!,
      clientName: r.client!.name,
      phone: r.client!.phone ?? "",
      location: r.client!.location ?? "",
      brickSizeId: r.brickSizeId ?? "",
      sizeLabel: r.brickSize?.label ?? "mixed",
      bricks: 0,
    };
    g.bricks += r.brickCount;
    unbilledMap.set(key, g);
  }
  const unbilled = [...unbilledMap.values()];

  const href = (overrides: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const merged: Record<string, string | undefined> = { status, q: q || undefined, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    return `/clients/register${u.toString() ? `?${u.toString()}` : ""}`;
  };

  const pending = filtered.reduce((s, r) => s + r.balance, 0);

  return (
    <>
      <PageHeader
        title="Sales register"
        sub="One row per order - number, name, place, size, rate, advance, balance"
        right={
          <Link
            href="/clients"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold hover:border-slate-400"
          >
            Client cards
          </Link>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {ORDER_STATUSES.map((s) => (
            <Link
              key={s.key}
              href={href({ status: s.key, page: undefined })}
              className={`px-3 py-1.5 rounded-full text-[12px] font-semibold ${
                status === s.key
                  ? "bg-ink text-white"
                  : "bg-white text-slate-700 border border-slate-200 hover:border-slate-400"
              }`}
            >
              {s.label}
              <span className="opacity-60 ml-1.5 num">
                {counts[s.key as keyof typeof counts]}
              </span>
            </Link>
          ))}
          <form method="get" className="ml-auto flex items-center gap-2">
            <input type="hidden" name="status" value={status} />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search name, place or number…"
              className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-red/30"
            />
          </form>
        </div>
        {pending > 0 && (
          <div className="text-[12px] text-slate-600 mt-2.5">
            Pending in this view{" "}
            <span className="num font-bold text-brand-red">{formatINR(pending)}</span>
          </div>
        )}
      </Card>

      <RegisterView
        rows={pageRows}
        status={status}
        unbilled={unbilled}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        types={types.map((t) => ({ id: t.id, label: t.name }))}
        priceFor={priceFor}
        onCreate={async (d) => {
          "use server";
          await createRegisterRow(d);
        }}
        onPay={async (d) => {
          "use server";
          await payRegisterRow(d);
        }}
        onSetStatus={async (orderId, next) => {
          "use server";
          await setOrderStatus(orderId, next);
        }}
      />
      <Pagination page={page} totalPages={totalPages} />
    </>
  );
}
