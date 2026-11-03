/**
 * Outstanding balance and collections —
 * build-docs/features/outstanding-collections.md
 *
 * Two halves. The ageing arithmetic is tested as a PURE function
 * (`allocateOutstanding`), because FIFO allocation across date buckets is
 * where the bugs live and none of it needs a database. The billing roll-up is
 * tested against real rows, because its whole job is joining five tables
 * correctly.
 *
 * SAFETY: writes and deletes its own fixtures. Refuses to run unless
 * DATABASE_URL is local — see the header of run-db.ts for the setup.
 *
 * Run: npx tsx scripts/e2e/run-collections.ts
 */

import { randomUUID } from "crypto";
import { tc, eq, ok, run } from "./harness";
import { prisma } from "@/lib/db";
import {
  allocateOutstanding,
  ageBucket,
  clientOutstanding,
  collectionsQueue,
  outstandingByClient,
  AGE_BUCKETS,
  type OrderBill,
} from "@/lib/outstanding";

const url = process.env.DATABASE_URL ?? "";
const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);
if (!isLocal && process.env.E2E_ALLOW_REMOTE_DB !== "yes") {
  console.error(
    "REFUSING TO RUN: DATABASE_URL is not local.\n" +
      `  got: ${url.replace(/:[^:@/]*@/, ":***@") || "(unset)"}\n` +
      "This suite writes and deletes rows. Point it at a throwaway database."
  );
  process.exit(2);
}

const TAG = "E2E_COLL";
const uniq = () => `${TAG}_${randomUUID().slice(0, 8)}`;
const NOW = new Date("2026-06-30T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);
const bucketSum = (b: { d0_30: number; d31_60: number; d60plus: number }) =>
  Math.round((b.d0_30 + b.d31_60 + b.d60plus) * 100) / 100;

async function cleanup() {
  const clients = await prisma.client.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  for (const c of clients) {
    const pays = await prisma.clientPayment.findMany({
      where: { clientId: c.id },
      select: { cashEntryId: true },
    });
    await prisma.clientPayment.deleteMany({ where: { clientId: c.id } });
    // The CashEntry is the parent row — deleting the payment alone strands it
    // in the cashbook, which is exactly the mistake a throwaway script once
    // made against production. Deleted explicitly by id.
    const cashIds = pays.map((p) => p.cashEntryId).filter((x): x is string => !!x);
    if (cashIds.length) await prisma.cashEntry.deleteMany({ where: { id: { in: cashIds } } });

    const orders = await prisma.order.findMany({
      where: { clientId: c.id },
      select: { id: true, deliveries: { select: { id: true } } },
    });
    for (const o of orders) {
      const dIds = o.deliveries.map((d) => d.id);
      if (dIds.length) {
        await prisma.deliveryAddOn.deleteMany({ where: { deliveryId: { in: dIds } } });
        await prisma.deliveryReturn.deleteMany({ where: { deliveryId: { in: dIds } } });
        await prisma.deliveryItem.deleteMany({ where: { deliveryId: { in: dIds } } });
        await prisma.delivery.deleteMany({ where: { id: { in: dIds } } });
      }
      await prisma.orderItem.deleteMany({ where: { orderId: o.id } });
      await prisma.orderSlabItem.deleteMany({ where: { orderId: o.id } });
      await prisma.order.delete({ where: { id: o.id } }).catch(() => {});
    }
    await prisma.client.delete({ where: { id: c.id } }).catch(() => {});
  }
}

type Fixtures = { brickSizeId: string; constructionTypeId: string };

async function fixtures(): Promise<Fixtures | null> {
  const [size, type] = await Promise.all([
    prisma.brickSize.findFirst({ orderBy: { order: "asc" } }),
    prisma.constructionType.findFirst({ orderBy: { order: "asc" } }),
  ]);
  if (!size || !type) return null;
  return { brickSizeId: size.id, constructionTypeId: type.id };
}

/** An order billed at `total`, dated `date`. */
async function mkOrder(
  clientId: string,
  f: Fixtures,
  total: number,
  date: Date,
  status = "open"
) {
  return prisma.order.create({
    data: {
      clientId,
      date,
      status,
      items: {
        create: { ...f, quantity: 1, pricePerBrick: total, total },
      },
    },
  });
}

/** A real money record: ClientPayment + its parent CashEntry, as approval writes it. */
async function mkPayment(
  clientId: string,
  amount: number,
  date: Date,
  orderId?: string
) {
  return prisma.cashEntry.create({
    data: {
      date,
      amount,
      direction: "in",
      source: "sale",
      category: "Client payment",
      title: `${TAG} payment`,
      method: "cash",
      clientPayment: { create: { clientId, orderId: orderId ?? null, date, amount, method: "cash" } },
    },
  });
}

// ───────────────────────── pure ageing arithmetic ────────────────────────

/** AC COLL-02: the buckets always sum to the debt. The checkability of the view. */
const bucketsSum = tc("COLL-02", "the ageing buckets sum to the balance", () => {
  const cases: Array<{ name: string; orders: OrderBill[]; paid: number }> = [
    {
      name: "nothing paid",
      orders: [
        { id: "a", date: daysAgo(5), billed: 1000 },
        { id: "b", date: daysAgo(45), billed: 2000 },
        { id: "c", date: daysAgo(400), billed: 3000 },
      ],
      paid: 0,
    },
    {
      name: "part paid",
      orders: [
        { id: "a", date: daysAgo(5), billed: 1000 },
        { id: "b", date: daysAgo(45), billed: 2000 },
      ],
      paid: 1500,
    },
    { name: "overpaid", orders: [{ id: "a", date: daysAgo(5), billed: 1000 }], paid: 2500 },
    { name: "no orders", orders: [], paid: 0 },
    { name: "advance, no orders", orders: [], paid: 900 },
  ];

  for (const c of cases) {
    const r = allocateOutstanding(c.orders, c.paid, NOW);
    eq(`${c.name}: buckets sum === debt`, bucketSum(r.buckets), r.debt);
    eq(`${c.name}: debt/credit agree with balance`, r.debt - r.credit, r.balance);
  }
});

/** AC COLL-02: FIFO settles the OLDEST bill first, so ageing is correct. */
const fifo = tc("COLL-09", "payments settle the oldest order first", () => {
  const orders: OrderBill[] = [
    { id: "old", date: daysAgo(400), billed: 5000 },
    { id: "mid", date: daysAgo(45), billed: 5000 },
    { id: "new", date: daysAgo(5), billed: 5000 },
  ];

  // 5,000 paid must clear the 400-day bill, not the newest one.
  const r = allocateOutstanding(orders, 5000, NOW);
  eq("the oldest bucket is cleared", r.buckets.d60plus, 0);
  eq("the 31-60 bucket still holds its 5,000", r.buckets.d31_60, 5000);
  eq("the 0-30 bucket still holds its 5,000", r.buckets.d0_30, 5000);
  eq("debt", r.debt, 10000);
  eq("oldest unpaid is now the 45-day order", r.oldestUnpaidAt?.getTime(), daysAgo(45).getTime());
  eq("and its age is reported", r.oldestUnpaidDays, 45);

  // Partially into the second bill.
  const r2 = allocateOutstanding(orders, 7500, NOW);
  eq("the remainder lands in the middle bucket", r2.buckets.d31_60, 2500);
  eq("not in the oldest", r2.buckets.d60plus, 0);
  eq("buckets still sum to debt", bucketSum(r2.buckets), r2.debt);
});

/** Bucket boundaries, stated explicitly rather than left to inference. */
const boundaries = tc("COLL-10", "bucket boundaries are exact", () => {
  eq("day 0", ageBucket(0), "d0_30");
  eq("day 30", ageBucket(30), "d0_30");
  eq("day 31", ageBucket(31), "d31_60");
  eq("day 60", ageBucket(60), "d31_60");
  eq("day 61", ageBucket(61), "d60plus");
  eq("there are three buckets", AGE_BUCKETS.length, 3);
});

/** A mis-keyed future date must not fall through every bucket and vanish. */
const futureDate = tc("COLL-11", "a future order date is clamped, not lost", () => {
  const future = new Date(NOW.getTime() + 30 * 86400000);
  const r = allocateOutstanding([{ id: "a", date: future, billed: 1000 }], 0, NOW);
  eq("lands in 0-30", r.buckets.d0_30, 1000);
  eq("nothing is lost", bucketSum(r.buckets), 1000);
  eq("age reads 0, not negative", r.oldestUnpaidDays, 0);
});

/**
 * A net-negative order (returns exceeding its value) is a credit against the
 * client, and must join the payment pool rather than be dropped — otherwise
 * the buckets sum to more than the balance.
 */
const negativeOrder = tc("COLL-12", "a net-negative order credits the client", () => {
  const r = allocateOutstanding(
    [
      { id: "a", date: daysAgo(45), billed: 1000 },
      { id: "b", date: daysAgo(5), billed: -400 },
    ],
    0,
    NOW
  );
  eq("billed is the net", r.billed, 600);
  eq("debt is the net", r.debt, 600);
  eq("buckets sum to debt", bucketSum(r.buckets), r.debt);
  eq("the credit applied to the oldest bill", r.buckets.d31_60, 600);
});

/** Same-date orders must age identically on every page load. */
const deterministic = tc("COLL-13", "allocation is deterministic on a date tie", () => {
  const sameDay = daysAgo(45);
  const a: OrderBill[] = [
    { id: "aaa", date: sameDay, billed: 1000 },
    { id: "bbb", date: sameDay, billed: 1000 },
  ];
  const first = allocateOutstanding(a, 1000, NOW);
  const reversed = allocateOutstanding([...a].reverse(), 1000, NOW);
  eq("same buckets whatever the query order", first.buckets, reversed.buckets);
  eq("same debt", first.debt, reversed.debt);
});

// ───────────────────────── against real rows ─────────────────────────────

/** AC COLL-01 / COLL-04 / COLL-07: the balance, and leaving the queue. */
const partPayment = tc("COLL-01", "a part-paid client carries the right balance", async () => {
  const f = await fixtures();
  if (!f) return ok("fixtures present (run the seeds first)", false);

  const client = await prisma.client.create({ data: { name: uniq(), location: "Salem" } });
  const order = await mkOrder(client.id, f, 100000, daysAgo(40));
  await mkPayment(client.id, 40000, daysAgo(10), order.id);

  const due = await clientOutstanding(client.id, NOW);
  eq("billed", due?.billed, 100000);
  eq("paid", due?.paid, 40000);
  eq("balance", due?.balance, 60000);
  eq("debt", due?.debt, 60000);
  eq("aged by the ORDER date, not the payment date", due?.buckets.d31_60, 60000);
  eq("buckets sum to debt", bucketSum(due!.buckets), due!.debt);

  // COLL-01: in the queue while it is owed.
  const q1 = await collectionsQueue(NOW);
  ok("appears in the queue", q1.rows.some((r) => r.clientId === client.id));

  // COLL-04: settle it and it goes.
  await mkPayment(client.id, 60000, daysAgo(1), order.id);
  const settled = await clientOutstanding(client.id, NOW);
  eq("balance is zero", settled?.balance, 0);
  eq("no debt", settled?.debt, 0);
  const q2 = await collectionsQueue(NOW);
  ok("a fully paid order leaves the queue", !q2.rows.some((r) => r.clientId === client.id));

  // COLL-07: overpay it and it reads as a credit, not a debt.
  await mkPayment(client.id, 5000, NOW, order.id);
  const over = await clientOutstanding(client.id, NOW);
  eq("balance is negative", over?.balance, -5000);
  eq("credit", over?.credit, 5000);
  eq("no debt", over?.debt, 0);
  const q3 = await collectionsQueue(NOW);
  ok("an overpaid client is not in the queue", !q3.rows.some((r) => r.clientId === client.id));
  ok("but is listed in credit", q3.credits.some((r) => r.clientId === client.id));
});

/**
 * AC COLL-06: an advance with no orderId reduces the balance.
 *
 * This is the bug the clients list had — it summed order-linked payments only,
 * so a client who had paid an advance was reported as owing money they had
 * already handed over.
 */
const advance = tc("COLL-06", "an advance with no order still counts as paid", async () => {
  const f = await fixtures();
  if (!f) return ok("fixtures present", false);

  const client = await prisma.client.create({ data: { name: uniq() } });
  await mkOrder(client.id, f, 50000, daysAgo(10));
  // No orderId — an opening advance, exactly as recordPayment allows.
  await mkPayment(client.id, 20000, daysAgo(20));

  const due = await clientOutstanding(client.id, NOW);
  eq("the advance counts", due?.paid, 20000);
  eq("balance", due?.balance, 30000);

  const orderLinked = await prisma.clientPayment.count({
    where: { clientId: client.id, orderId: { not: null } },
  });
  eq("and it is genuinely not order-linked", orderLinked, 0);
});

/** AC COLL-05: a cancelled order is not a bill. */
const cancelled = tc("COLL-05", "a cancelled order is not billed", async () => {
  const f = await fixtures();
  if (!f) return ok("fixtures present", false);

  const client = await prisma.client.create({ data: { name: uniq() } });
  await mkOrder(client.id, f, 70000, daysAgo(30), "cancelled");
  const due = await clientOutstanding(client.id, NOW);
  eq("nothing billed", due?.billed, 0);
  eq("no debt invented", due?.debt, 0);
  eq("and no orders counted", due?.orderCount, 0);
  const q = await collectionsQueue(NOW);
  ok("absent from the queue", !q.rows.some((r) => r.clientId === client.id));
});

/** AC COLL-08: delivery add-ons raise the bill, returns lower it. */
const addOnsAndReturns = tc("COLL-08", "add-ons and returns move the balance", async () => {
  const f = await fixtures();
  if (!f) return ok("fixtures present", false);

  const client = await prisma.client.create({ data: { name: uniq() } });
  const order = await mkOrder(client.id, f, 100000, daysAgo(70));

  const base = await clientOutstanding(client.id, NOW);
  eq("the order alone", base?.billed, 100000);
  eq("aged over 60 days", base?.buckets.d60plus, 100000);

  await prisma.delivery.create({
    data: {
      orderId: order.id,
      date: daysAgo(60),
      addOns: {
        create: [
          { name: "Loading charges", quantity: 1, unit: "trip", pricePerUnit: 3000, total: 3000 },
          { name: "Cement", quantity: 10, unit: "bag", pricePerUnit: 400, total: 4000 },
        ],
      },
      returns: { create: { brickCount: 100, refundAmount: 2000 } },
    },
  });

  const after = await clientOutstanding(client.id, NOW);
  eq("add-ons added, return subtracted", after?.billed, 105000);
  eq("the balance followed", after?.balance, 105000);
  eq("buckets still sum to debt", bucketSum(after!.buckets), after!.debt);
});

/**
 * AC COLL-03: the reconciliation the plan asked for.
 *
 * Σ paid across clients === Σ ClientPayment.amount === the cashbook entries
 * those payments are attached to. If these three ever disagree, the
 * collections queue is reporting money the cashbook does not have.
 */
const reconciliation = tc("COLL-03", "outstanding reconciles against the cashbook", async () => {
  const f = await fixtures();
  if (!f) return ok("fixtures present", false);

  const a = await prisma.client.create({ data: { name: uniq() } });
  const b = await prisma.client.create({ data: { name: uniq() } });
  const oa = await mkOrder(a.id, f, 80000, daysAgo(90));
  const ob = await mkOrder(b.id, f, 45000, daysAgo(15));
  await mkPayment(a.id, 30000, daysAgo(80), oa.id);
  await mkPayment(a.id, 5000, daysAgo(2));
  await mkPayment(b.id, 45000, daysAgo(1), ob.id);

  const ids = [a.id, b.id];
  const due = await outstandingByClient(ids, NOW);
  const paidReported = [...due.values()].reduce((s, c) => s + c.paid, 0);

  const rows = await prisma.clientPayment.findMany({
    where: { clientId: { in: ids } },
    select: { amount: true, cashEntryId: true },
  });
  const paidRows = rows.reduce((s, r) => s + r.amount, 0);
  eq("reported paid === ClientPayment rows", paidReported, paidRows);

  const cashIds = rows.map((r) => r.cashEntryId).filter((x): x is string => !!x);
  eq("every payment has a cashbook entry", cashIds.length, rows.length);
  const cash = await prisma.cashEntry.aggregate({
    where: { id: { in: cashIds } },
    _sum: { amount: true },
  });
  eq("and the cashbook agrees", cash._sum.amount ?? 0, paidRows);

  // The settled client is out; the part-paid one is in with the right figure.
  const q = await collectionsQueue(NOW);
  const rowA = q.rows.find((r) => r.clientId === a.id);
  ok("the part-paid client is queued", !!rowA);
  // 80,000 billed, less the 30,000 against the order AND the 5,000 advance
  // that carries no orderId. The advance is the whole point: the clients list
  // would have reported 50,000 here.
  eq("with the right debt", rowA?.debt, 45000);
  eq("aged over 60 days", rowA?.buckets.d60plus, 45000);
  ok("the settled client is not", !q.rows.some((r) => r.clientId === b.id));

  // And the queue's own totals add up to its rows.
  const rowSum = q.rows.reduce((s, r) => s + r.debt, 0);
  eq("queue total === Σ rows", Math.round(q.totals.debt * 100) / 100, Math.round(rowSum * 100) / 100);
  eq("queue buckets === Σ row buckets", bucketSum(q.totals.buckets), Math.round(q.totals.debt * 100) / 100);
  eq("client count matches", q.totals.clients, q.rows.length);
});

/** The queue is ordered longest-overdue first — the point of the screen. */
const ordering = tc("COLL-14", "the queue leads with the longest overdue", async () => {
  const f = await fixtures();
  if (!f) return ok("fixtures present", false);

  const recent = await prisma.client.create({ data: { name: uniq() } });
  const ancient = await prisma.client.create({ data: { name: uniq() } });
  await mkOrder(recent.id, f, 10000, daysAgo(3));
  await mkOrder(ancient.id, f, 10000, daysAgo(300));

  const q = await collectionsQueue(NOW);
  const iAncient = q.rows.findIndex((r) => r.clientId === ancient.id);
  const iRecent = q.rows.findIndex((r) => r.clientId === recent.id);
  ok("both are queued", iAncient >= 0 && iRecent >= 0);
  ok("the 300-day debt comes first", iAncient < iRecent);
});

(async () => {
  await cleanup();
  try {
    await run("Outstanding & collections", [
      bucketsSum,
      fifo,
      boundaries,
      futureDate,
      negativeOrder,
      deterministic,
      partPayment,
      advance,
      cancelled,
      addOnsAndReturns,
      reconciliation,
      ordering,
    ]);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})();
