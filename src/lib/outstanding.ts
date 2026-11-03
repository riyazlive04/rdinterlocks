// What a client owes — the single definition, and the ageing of it.
//
// ─── Why this file exists ─────────────────────────────────────────────
// Two different balance formulas were already live and disagreed about the
// same client:
//
//   clients/page.tsx      ordered - paid                (order-linked pay only)
//   clients/[id]/page.tsx ordered + addOns - refunded - paid  (all payments)
//
// So the list and the detail page showed different dues for one customer:
// the list omitted delivery add-ons and returns, and ignored advances paid
// with no order attached — reporting a client as owing money they had already
// handed over. Neither was labelled an approximation. Both now read this.
//
// ─── What counts as paid ──────────────────────────────────────────────
// `ClientPayment` only, and it is read at CLIENT level, not order level. An
// advance with no `orderId` is money received; a formula that counts only
// order-linked payments invents debt. `QuotationPayment` is never read here —
// it is the telecaller's unverified claim, and counting a pending claim as
// cash makes an unpaid client look settled (see MEMORY).

import { prisma } from "./db";
import { isOrderOpen } from "./order-status";

/** Money is stored as float; round at every boundary or the noise compounds. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Treat anything under half a paisa as zero — float dust, not a debt. */
const EPSILON = 0.005;

export type AgeBuckets = { d0_30: number; d31_60: number; d60plus: number };

export const AGE_BUCKETS = [
  { key: "d0_30", label: "0-30 days" },
  { key: "d31_60", label: "31-60 days" },
  { key: "d60plus", label: "Over 60 days" },
] as const satisfies ReadonlyArray<{ key: keyof AgeBuckets; label: string }>;

export const emptyBuckets = (): AgeBuckets => ({ d0_30: 0, d31_60: 0, d60plus: 0 });

export function ageBucket(days: number): keyof AgeBuckets {
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  return "d60plus";
}

/** One billable unit. There are no invoices here, so an order is the bill. */
export type OrderBill = {
  id: string;
  date: Date;
  /** items + slab items + delivery add-ons - returns. May be negative. */
  billed: number;
};

export type Outstanding = {
  billed: number;
  paid: number;
  /** billed - paid, SIGNED. Negative = the client is in credit. */
  balance: number;
  /** max(0, balance) — what is actually owed. The buckets sum to this. */
  debt: number;
  /** max(0, -balance) — money held beyond what was billed. */
  credit: number;
  buckets: AgeBuckets;
  /** Date of the oldest order still carrying unpaid money. */
  oldestUnpaidAt: Date | null;
  oldestUnpaidDays: number;
};

/**
 * Age a client's debt across the buckets.
 *
 * FIFO over orders, oldest first: the payment pool is drawn down against the
 * oldest bill, and whatever remains unpaid on each order is bucketed by THAT
 * order's age. FIFO is right because it is what the office already does
 * informally — money settles the oldest bill — and because the alternative
 * (allocating each payment to the order named on it) leaves advances
 * unallocatable and mis-ages a client who overpaid one order and underpaid
 * another.
 *
 * Pure, so the ageing is testable without a database and the `now` used for
 * bucketing is an argument rather than a hidden clock.
 *
 * INVARIANT, and the reason the view is checkable at all:
 *   buckets.d0_30 + buckets.d31_60 + buckets.d60plus === debt
 * It holds even with negative-billed orders, which is why they join the pool
 * below instead of being skipped — a return that exceeds its order's value is
 * a credit against the client, and dropping it would leave the buckets
 * summing to more than the balance.
 */
export function allocateOutstanding(
  orders: OrderBill[],
  paid: number,
  now: Date = new Date()
): Outstanding {
  const billed = round2(orders.reduce((s, o) => s + o.billed, 0));

  // A net-negative order (returns exceeding the order's value) is money owed
  // back to the client, so it tops up the pool rather than being ignored.
  let pool = paid;
  for (const o of orders) if (o.billed < 0) pool += -o.billed;

  const sorted = orders
    .filter((o) => o.billed > 0)
    // Oldest first; `id` breaks a same-date tie so the ageing is identical on
    // every page load instead of depending on query order.
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));

  const buckets = emptyBuckets();
  let oldestUnpaidAt: Date | null = null;

  for (const o of sorted) {
    const applied = Math.min(pool, o.billed);
    pool -= applied;
    const unpaid = round2(o.billed - applied);
    if (unpaid <= EPSILON) continue;

    // A mis-keyed future order date would otherwise produce a negative age
    // and fall through every bucket, vanishing from the totals.
    const days = Math.max(0, Math.floor((now.getTime() - o.date.getTime()) / 86400000));
    const key = ageBucket(days);
    buckets[key] = round2(buckets[key] + unpaid);
    if (!oldestUnpaidAt) oldestUnpaidAt = o.date;
  }

  const balance = round2(billed - paid);
  return {
    billed,
    paid: round2(paid),
    balance,
    debt: Math.max(0, balance),
    credit: Math.max(0, round2(-balance)),
    buckets,
    oldestUnpaidAt,
    oldestUnpaidDays: oldestUnpaidAt
      ? Math.max(0, Math.floor((now.getTime() - oldestUnpaidAt.getTime()) / 86400000))
      : 0,
  };
}

export type ClientOutstanding = Outstanding & {
  clientId: string;
  name: string;
  location: string | null;
  phone: string | null;
  orderCount: number;
  openOrders: number;
};

/**
 * Bill every order, for every client asked about, in a fixed number of
 * queries.
 *
 * Six aggregates regardless of how many clients — not the nested
 * `include` the clients list used, which pulled every order, item, delivery
 * and payment of 50 clients into memory to add up four numbers.
 *
 * Add-ons and returns hang off Delivery, not Order, and Prisma cannot group
 * across that relation, so deliveries are fetched as a thin id->orderId map
 * and the two aggregates are folded through it.
 */
async function billedByOrder(clientIds?: string[]) {
  const where = {
    // A cancelled order is not a bill. Including it would invent debt.
    status: { not: "cancelled" },
    ...(clientIds ? { clientId: { in: clientIds } } : {}),
  };

  const orders = await prisma.order.findMany({
    where,
    select: { id: true, clientId: true, date: true, status: true },
  });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length === 0) return { orders, billed: new Map<string, number>() };

  const [items, slabs, deliveries] = await Promise.all([
    prisma.orderItem.groupBy({
      by: ["orderId"],
      where: { orderId: { in: orderIds } },
      _sum: { total: true },
    }),
    prisma.orderSlabItem.groupBy({
      by: ["orderId"],
      where: { orderId: { in: orderIds } },
      _sum: { total: true },
    }),
    prisma.delivery.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true, orderId: true },
    }),
  ]);

  const deliveryIds = deliveries.map((d) => d.id);
  const [addOns, returns] = await Promise.all([
    deliveryIds.length
      ? prisma.deliveryAddOn.groupBy({
          by: ["deliveryId"],
          where: { deliveryId: { in: deliveryIds } },
          _sum: { total: true },
        })
      : [],
    deliveryIds.length
      ? prisma.deliveryReturn.groupBy({
          by: ["deliveryId"],
          where: { deliveryId: { in: deliveryIds } },
          _sum: { refundAmount: true },
        })
      : [],
  ]);

  const orderOfDelivery = new Map(deliveries.map((d) => [d.id, d.orderId]));
  const billed = new Map<string, number>();
  const add = (orderId: string | undefined, amount: number) => {
    if (!orderId || !amount) return;
    billed.set(orderId, (billed.get(orderId) ?? 0) + amount);
  };

  for (const r of items) add(r.orderId, r._sum.total ?? 0);
  for (const r of slabs) add(r.orderId, r._sum.total ?? 0);
  for (const r of addOns) add(orderOfDelivery.get(r.deliveryId), r._sum.total ?? 0);
  for (const r of returns) add(orderOfDelivery.get(r.deliveryId), -(r._sum.refundAmount ?? 0));

  return { orders, billed };
}

/**
 * Outstanding for the given clients (or every active client), keyed by id.
 *
 * Read-only throughout. A reporting path that could write to the cashbook
 * would be the thing to fear in this feature; this one cannot.
 */
export async function outstandingByClient(
  clientIds?: string[],
  now: Date = new Date()
): Promise<Map<string, ClientOutstanding>> {
  const [clients, { orders, billed }, payments] = await Promise.all([
    prisma.client.findMany({
      where: clientIds ? { id: { in: clientIds } } : { active: true },
      select: { id: true, name: true, location: true, phone: true },
    }),
    billedByOrder(clientIds),
    prisma.clientPayment.groupBy({
      by: ["clientId"],
      ...(clientIds ? { where: { clientId: { in: clientIds } } } : {}),
      _sum: { amount: true },
    }),
  ]);

  const paidBy = new Map(payments.map((p) => [p.clientId, p._sum.amount ?? 0]));
  const ordersBy = new Map<string, typeof orders>();
  for (const o of orders) {
    const list = ordersBy.get(o.clientId);
    if (list) list.push(o);
    else ordersBy.set(o.clientId, [o]);
  }

  const out = new Map<string, ClientOutstanding>();
  for (const c of clients) {
    const mine = ordersBy.get(c.id) ?? [];
    const bills: OrderBill[] = mine.map((o) => ({
      id: o.id,
      date: o.date,
      billed: round2(billed.get(o.id) ?? 0),
    }));
    out.set(c.id, {
      ...allocateOutstanding(bills, paidBy.get(c.id) ?? 0, now),
      clientId: c.id,
      name: c.name,
      location: c.location,
      phone: c.phone,
      orderCount: mine.length,
      openOrders: mine.filter((o) => isOrderOpen(o.status)).length,
    });
  }
  return out;
}

/** One client. Same definition, same code path — never a second formula. */
export async function clientOutstanding(
  clientId: string,
  now: Date = new Date()
): Promise<ClientOutstanding | null> {
  return (await outstandingByClient([clientId], now)).get(clientId) ?? null;
}

export type CollectionsQueue = {
  rows: ClientOutstanding[];
  totals: { debt: number; buckets: AgeBuckets; clients: number };
  /** Clients holding money beyond what they were billed — not a debt. */
  credits: ClientOutstanding[];
};

/**
 * The collections queue: who owes, longest-overdue first.
 *
 * An overpaid client is NOT a debt and is reported separately rather than
 * clamped to zero, which is what the client detail page's `Math.max(0, …)`
 * did — hiding a genuine overpayment from the only people who could refund
 * it.
 */
export async function collectionsQueue(now: Date = new Date()): Promise<CollectionsQueue> {
  const all = [...(await outstandingByClient(undefined, now)).values()];
  const rows = all
    .filter((c) => c.debt > EPSILON)
    .sort((a, b) => b.oldestUnpaidDays - a.oldestUnpaidDays || b.debt - a.debt);

  const totals = { debt: 0, buckets: emptyBuckets(), clients: rows.length };
  for (const r of rows) {
    totals.debt = round2(totals.debt + r.debt);
    for (const b of AGE_BUCKETS) {
      totals.buckets[b.key] = round2(totals.buckets[b.key] + r.buckets[b.key]);
    }
  }

  return {
    rows,
    totals,
    credits: all.filter((c) => c.credit > EPSILON).sort((a, b) => b.credit - a.credit),
  };
}
