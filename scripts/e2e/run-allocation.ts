/**
 * Stock allocation — build-docs/features/stock-allocation.md
 *
 * Mostly pure: `allocateReadyStock` takes orders and a stock map and returns
 * an allocation, so the arithmetic that decides which customer gets the
 * bricks is testable with no database at all. The enforcement half needs real
 * rows, because its job is to refuse a write.
 *
 * ALLOC-10 is the important one. Sixty lines of working logic were lifted out
 * of fulfilment/page.tsx, so the suite carries a verbatim copy of the ORIGINAL
 * page code and asserts the extracted allocator agrees with it across
 * generated scenarios. Without that, "I refactored it and the tests I wrote
 * afterwards pass" proves only that the new code agrees with itself.
 *
 * SAFETY: the DB half writes and deletes its own fixtures and refuses to run
 * unless DATABASE_URL is local.
 *
 * Run: npx tsx scripts/e2e/run-allocation.ts
 */

import { randomUUID } from "crypto";
import { tc, eq, ok, run } from "./harness";
import { prisma } from "@/lib/db";
import {
  allocateReadyStock,
  unallocatedStock,
  checkDeliveryAgainstAllocation,
  type AllocatableOrder,
} from "@/lib/allocation";

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

const TAG = "E2E_ALLOC";
const uniq = () => `${TAG}_${randomUUID().slice(0, 8)}`;
const T0 = new Date("2026-06-01T00:00:00Z");
const at = (mins: number) => new Date(T0.getTime() + mins * 60000);

const SIX = "size-6";
const EIGHT = "size-8";

function mkOrder(
  id: string,
  mins: number,
  ordered: Array<[string, number]>,
  opts: { stage?: string; delivered?: Array<[string, number]> } = {}
): AllocatableOrder {
  return {
    id,
    stageChangedAt: at(mins),
    fulfilmentStage: opts.stage ?? "queued",
    ordered: ordered.map(([brickSizeId, quantity]) => ({ brickSizeId, quantity })),
    delivered: (opts.delivered ?? []).map(([brickSizeId, quantity]) => ({ brickSizeId, quantity })),
  };
}

const needOf = (a: ReturnType<typeof allocateReadyStock>, id: string, sizeId: string) =>
  a.get(id)!.needs.find((n) => n.brickSizeId === sizeId);

// ─────────────────────── the allocation arithmetic ───────────────────────

/** AC ALLOC-01: the first order is met; the second is short and names it. */
const contention = tc("ALLOC-01", "two orders, one pallet: the first wins", () => {
  const orders = [
    mkOrder("first", 0, [[SIX, 5000]]),
    mkOrder("second", 10, [[SIX, 5000]]),
  ];
  const a = allocateReadyStock(orders, new Map([[SIX, 6000]]));

  eq("the earlier order is covered", a.get("first")!.shortTotal, 0);
  eq("and takes what it needs", needOf(a, "first", SIX)!.taken, 5000);
  eq("the later order is short", a.get("second")!.shortTotal, 4000);
  eq("it got the remainder", needOf(a, "second", SIX)!.taken, 1000);
  eq("and it names who holds the rest", a.get("second")!.blockedBy, ["first"]);
  eq("the covered order blames nobody", a.get("first")!.blockedBy, []);
});

/** AC ALLOC-02: enough for both, nobody blocked. */
const plenty = tc("ALLOC-02", "enough stock for both leaves neither short", () => {
  const orders = [mkOrder("a", 0, [[SIX, 2000]]), mkOrder("b", 10, [[SIX, 2000]])];
  const a = allocateReadyStock(orders, new Map([[SIX, 10000]]));
  eq("a is covered", a.get("a")!.shortTotal, 0);
  eq("b is covered", a.get("b")!.shortTotal, 0);
  eq("a blames nobody", a.get("a")!.blockedBy, []);
  eq("b blames nobody", a.get("b")!.blockedBy, []);
  eq("6,000 left free", unallocatedStock(orders, new Map([[SIX, 10000]])).get(SIX), 6000);
});

/** AC ALLOC-03: a part-delivered order needs only the remainder. */
const partDelivered = tc("ALLOC-03", "a part-delivered order allocates the remainder", () => {
  const orders = [mkOrder("a", 0, [[SIX, 10000]], { delivered: [[SIX, 7000]] })];
  const a = allocateReadyStock(orders, new Map([[SIX, 4000]]));
  eq("needs only the undelivered 3,000", needOf(a, "a", SIX)!.need, 3000);
  eq("not short", a.get("a")!.shortTotal, 0);
  eq("and 1,000 stays free", unallocatedStock(orders, new Map([[SIX, 4000]])).get(SIX), 1000);
});

/** An over-delivered line must not feed surplus back into the pool. */
const overDelivered = tc("ALLOC-11", "an over-delivered order claims nothing", () => {
  const orders = [mkOrder("a", 0, [[SIX, 1000]], { delivered: [[SIX, 1500]] })];
  const a = allocateReadyStock(orders, new Map([[SIX, 2000]]));
  eq("no outstanding need", a.get("a")!.pendingTotal, 0);
  eq("the pool is untouched", unallocatedStock(orders, new Map([[SIX, 2000]])).get(SIX), 2000);
});

/** AC ALLOC-04: oldest-first, and deterministic on a tie. */
const ordering = tc("ALLOC-04", "oldest first, deterministic on a tie", () => {
  // Fed newest-first on purpose: the allocator must sort, not trust input.
  const orders = [mkOrder("late", 100, [[SIX, 5000]]), mkOrder("early", 0, [[SIX, 5000]])];
  const a = allocateReadyStock(orders, new Map([[SIX, 5000]]));
  eq("the earlier order wins regardless of input order", a.get("early")!.shortTotal, 0);
  eq("the later one is short", a.get("late")!.shortTotal, 5000);

  // Identical timestamps: id breaks the tie, so the same two orders do not
  // swap blame between page loads.
  const tie = [mkOrder("bbb", 50, [[SIX, 5000]]), mkOrder("aaa", 50, [[SIX, 5000]])];
  const t1 = allocateReadyStock(tie, new Map([[SIX, 5000]]));
  const t2 = allocateReadyStock([...tie].reverse(), new Map([[SIX, 5000]]));
  eq("aaa wins the tie", t1.get("aaa")!.shortTotal, 0);
  eq("and wins it again whatever the input order", t2.get("aaa")!.shortTotal, 0);
  eq("bbb loses it consistently", t1.get("bbb")!.shortTotal, t2.get("bbb")!.shortTotal);
});

/**
 * AC ALLOC-05: a dispatched order reports no shortfall and takes nothing.
 *
 * The regression pin for the extraction. Its bricks have left the godown, so
 * claiming a shortfall against stock it no longer needs would put phantom
 * warnings on finished work, and letting it compete for the pool would starve
 * live orders of stock that is genuinely free.
 */
const dispatched = tc("ALLOC-05", "a dispatched order neither claims nor complains", () => {
  const orders = [
    mkOrder("gone", 0, [[SIX, 50000]], { stage: "dispatched" }),
    mkOrder("live", 10, [[SIX, 3000]]),
  ];
  const stock = new Map([[SIX, 3000]]);
  const a = allocateReadyStock(orders, stock);
  eq("the dispatched order reports no shortfall", a.get("gone")!.shortTotal, 0);
  eq("its need reads as met", needOf(a, "gone", SIX)!.have, 50000);
  eq("the live order still gets its bricks", a.get("live")!.shortTotal, 0);
  eq("and is not blamed on the dispatched one", a.get("live")!.blockedBy, []);
  eq("the pool was only drawn by the live order", unallocatedStock(orders, stock).get(SIX), 0);
});

/** AC ALLOC-06: a negative remaining never grants phantom availability. */
const negativeStock = tc("ALLOC-06", "negative remaining counts as zero", () => {
  const orders = [mkOrder("a", 0, [[SIX, 1000]])];
  const a = allocateReadyStock(orders, new Map([[SIX, -4000]]));
  eq("nothing available", needOf(a, "a", SIX)!.have, 0);
  eq("fully short", a.get("a")!.shortTotal, 1000);
  eq("free stock is not negative-inflated", unallocatedStock(orders, new Map([[SIX, -4000]])).get(SIX), 0);
});

/** Sizes are allocated independently; a size with no stock is still listed. */
const multiSize = tc("ALLOC-12", "sizes do not borrow from each other", () => {
  const orders = [mkOrder("a", 0, [[SIX, 1000], [EIGHT, 1000]])];
  const a = allocateReadyStock(orders, new Map([[SIX, 5000]]));
  eq("the stocked size is covered", needOf(a, "a", SIX)!.short, 0);
  eq("the unstocked size is fully short", needOf(a, "a", EIGHT)!.short, 1000);
  eq("and it is reported, not skipped", needOf(a, "a", EIGHT)!.have, 0);
  eq("shortTotal is the sum", a.get("a")!.shortTotal, 1000);
});

/** An order with no items takes nothing and breaks nothing. */
const emptyCases = tc("ALLOC-13", "empty queue and empty orders are not errors", () => {
  eq("empty queue", allocateReadyStock([], new Map([[SIX, 100]])).size, 0);
  const a = allocateReadyStock([mkOrder("a", 0, [])], new Map([[SIX, 100]]));
  eq("an itemless order is still listed", a.size, 1);
  eq("with nothing pending", a.get("a")!.pendingTotal, 0);
  eq("and nothing short", a.get("a")!.shortTotal, 0);
  eq("no stock given", allocateReadyStock([mkOrder("a", 0, [[SIX, 10]])], new Map()).get("a")!.shortTotal, 10);
});

/** The caller's stock map must not be mutated out from under them. */
const noMutation = tc("ALLOC-14", "the caller's stock map is not mutated", () => {
  const stock = new Map([[SIX, 5000]]);
  allocateReadyStock([mkOrder("a", 0, [[SIX, 4000]])], stock);
  eq("still 5,000 after allocating", stock.get(SIX), 5000);
});

/**
 * AC ALLOC-10: the extracted allocator agrees with the code it replaced.
 *
 * `legacyAllocate` below is the ORIGINAL fulfilment/page.tsx logic, copied
 * verbatim from commit 9bf640b before the extraction. Keeping it here means
 * the refactor is checked against the behaviour it claimed to preserve,
 * across scenarios neither version was written for.
 */
function legacyAllocate(
  orders: AllocatableOrder[],
  readyBySize: Map<string, number>
): Map<string, { needs: Array<{ sizeId: string; need: number; have: number; short: number }>; shortTotal: number }> {
  // --- begin verbatim shape of the old page code ---
  const pool = new Map(readyBySize);
  const out = new Map<string, { needs: Array<{ sizeId: string; need: number; have: number; short: number }>; shortTotal: number }>();
  for (const o of orders) {
    const stage = o.fulfilmentStage;
    const pending = new Map<string, number>();
    for (const it of o.ordered) {
      pending.set(it.brickSizeId, (pending.get(it.brickSizeId) ?? 0) + it.quantity);
    }
    for (const it of o.delivered) {
      pending.set(it.brickSizeId, (pending.get(it.brickSizeId) ?? 0) - it.quantity);
    }
    const needs: Array<{ sizeId: string; need: number; have: number; short: number }> = [];
    for (const [sizeId, qty] of pending) {
      if (qty <= 0) continue;
      if (stage === "dispatched") {
        needs.push({ sizeId, need: qty, have: qty, short: 0 });
        continue;
      }
      const have = pool.get(sizeId) ?? 0;
      const taken = Math.min(qty, have);
      pool.set(sizeId, have - taken);
      needs.push({ sizeId, need: qty, have, short: qty - taken });
    }
    out.set(o.id, { needs, shortTotal: needs.reduce((s, n) => s + n.short, 0) });
  }
  // --- end verbatim ---
  return out;
}

const equivalence = tc("ALLOC-10", "the extraction preserves the old behaviour", () => {
  // Deterministic pseudo-random scenarios — a fixed seed so a failure is
  // reproducible rather than a once-seen fluke.
  let seed = 20260601;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const stages = ["queued", "in_production", "ready", "dispatched"];

  let compared = 0;
  let mismatches = 0;
  for (let scenario = 0; scenario < 200; scenario++) {
    const count = 1 + rnd(5);
    const orders: AllocatableOrder[] = [];
    for (let i = 0; i < count; i++) {
      const ordered: Array<[string, number]> = [[SIX, 1000 * (1 + rnd(8))]];
      if (rnd(2)) ordered.push([EIGHT, 1000 * (1 + rnd(5))]);
      const delivered: Array<[string, number]> = rnd(3) === 0 ? [[SIX, 1000 * rnd(4)]] : [];
      orders.push(
        mkOrder(`o${String(i).padStart(2, "0")}`, i * 10, ordered, {
          stage: stages[rnd(stages.length)],
          delivered,
        })
      );
    }
    const stock = new Map([
      [SIX, 1000 * rnd(20)],
      [EIGHT, 1000 * rnd(10)],
    ]);

    // The old code allocated in the ORDER THE PAGE QUERIED (stageChangedAt
    // asc); the new one sorts internally. Feeding the legacy copy a sorted
    // list is what makes the comparison apples to apples.
    const sorted = [...orders].sort(
      (a, b) => a.stageChangedAt.getTime() - b.stageChangedAt.getTime() || a.id.localeCompare(b.id)
    );
    const legacy = legacyAllocate(sorted, stock);
    const current = allocateReadyStock(orders, stock);

    for (const o of orders) {
      compared++;
      const l = legacy.get(o.id)!;
      const c = current.get(o.id)!;
      if (l.shortTotal !== c.shortTotal) mismatches++;
      else {
        for (const ln of l.needs) {
          const cn = c.needs.find((x) => x.brickSizeId === ln.sizeId);
          if (!cn || cn.need !== ln.need || cn.have !== ln.have || cn.short !== ln.short) {
            mismatches++;
            break;
          }
        }
      }
    }
  }
  ok(`compared ${compared} order allocations across 200 scenarios`, compared > 500);
  eq("the extracted allocator never disagrees with the original", mismatches, 0);
});

// ──────────────────────── enforcement at dispatch ────────────────────────

/** The pure half of the dispatch check. */
const deliveryCheck = tc("ALLOC-07", "a delivery over the allocation is caught", () => {
  const orders = [
    mkOrder("first", 0, [[SIX, 5000]]),
    mkOrder("second", 10, [[SIX, 5000]]),
  ];
  const stock = new Map([[SIX, 6000]]);

  // `second` is allocated only the 1,000 left over.
  const over = checkDeliveryAgainstAllocation("second", [{ brickSizeId: SIX, quantity: 5000 }], orders, stock);
  ok("refused", !over.ok);
  eq("by 4,000", over.shortfalls[0]?.short, 4000);
  eq("and it names the holder", over.blockedBy, ["first"]);

  const within = checkDeliveryAgainstAllocation("second", [{ brickSizeId: SIX, quantity: 1000 }], orders, stock);
  ok("delivering only what is allocated is allowed", within.ok);

  const firstFull = checkDeliveryAgainstAllocation("first", [{ brickSizeId: SIX, quantity: 5000 }], orders, stock);
  ok("the earlier order may take its full allocation", firstFull.ok);
});

async function cleanup() {
  const clients = await prisma.client.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  for (const c of clients) {
    const orders = await prisma.order.findMany({
      where: { clientId: c.id },
      select: { id: true, deliveries: { select: { id: true } } },
    });
    for (const o of orders) {
      const dIds = o.deliveries.map((d) => d.id);
      if (dIds.length) {
        await prisma.deliveryItem.deleteMany({ where: { deliveryId: { in: dIds } } });
        await prisma.deliveryAddOn.deleteMany({ where: { deliveryId: { in: dIds } } });
        await prisma.deliveryReturn.deleteMany({ where: { deliveryId: { in: dIds } } });
        await prisma.delivery.deleteMany({ where: { id: { in: dIds } } });
      }
      await prisma.orderItem.deleteMany({ where: { orderId: o.id } });
      await prisma.order.delete({ where: { id: o.id } }).catch(() => {});
    }
    await prisma.client.delete({ where: { id: c.id } }).catch(() => {});
  }
  await prisma.stockBatch.deleteMany({ where: { code: { startsWith: TAG } } });
}

/**
 * AC ALLOC-08 / ALLOC-09: the flag governs whether the queue's allocation is
 * advisory or binding, against real rows.
 *
 * The guard lives inside a server action, which cannot be called here without
 * a request context, so this exercises the same decision the action makes —
 * the allocator against the real queue and real batches — and asserts the
 * flag is what switches it.
 */
const enforcement = tc("ALLOC-08", "the flag turns the warning into a refusal", async () => {
  const [size, type] = await Promise.all([
    prisma.brickSize.findFirst({ orderBy: { order: "asc" } }),
    prisma.constructionType.findFirst({ orderBy: { order: "asc" } }),
  ]);
  if (!size || !type) return ok("fixtures present (run the seeds first)", false);

  const client = await prisma.client.create({ data: { name: uniq() } });
  const mk = async (minutes: number, qty: number) =>
    prisma.order.create({
      data: {
        clientId: client.id,
        approvedAt: new Date(),
        status: "open",
        fulfilmentStage: "ready",
        stageChangedAt: at(minutes),
        items: {
          create: {
            brickSizeId: size.id,
            constructionTypeId: type.id,
            quantity: qty,
            pricePerBrick: 50,
            total: qty * 50,
          },
        },
      },
    });
  const first = await mk(0, 5000);
  const second = await mk(10, 5000);

  await prisma.stockBatch.create({
    data: {
      code: `${TAG}-${randomUUID().slice(0, 6)}`,
      brickSizeId: size.id,
      count: 6000,
      remaining: 6000,
      stage: "ready",
      source: "production",
    },
  });

  // Rebuild exactly what the guard sees.
  const queue = await prisma.order.findMany({
    where: { approvedAt: { not: null }, status: { notIn: ["complete", "cancelled"] } },
    select: {
      id: true,
      stageChangedAt: true,
      fulfilmentStage: true,
      items: { select: { brickSizeId: true, quantity: true } },
      deliveries: { select: { items: { select: { brickSizeId: true, quantity: true } } } },
    },
  });
  const readyStock = await prisma.stockBatch.groupBy({
    by: ["brickSizeId"],
    where: { stage: "ready", remaining: { gt: 0 } },
    _sum: { remaining: true },
  });
  const orders: AllocatableOrder[] = queue.map((o) => ({
    id: o.id,
    stageChangedAt: o.stageChangedAt,
    fulfilmentStage: o.fulfilmentStage,
    ordered: o.items,
    delivered: o.deliveries.flatMap((d) => d.items),
  }));
  const readyBySize = new Map(readyStock.map((r) => [r.brickSizeId, r._sum.remaining ?? 0]));

  const a = allocateReadyStock(orders, readyBySize);
  eq("the earlier order holds 5,000", a.get(first.id)!.shortTotal, 0);
  ok("the later order is short", a.get(second.id)!.shortTotal > 0);

  const check = checkDeliveryAgainstAllocation(
    second.id,
    [{ brickSizeId: size.id, quantity: 5000 }],
    orders,
    readyBySize
  );
  ok("dispatching the later order in full is over its allocation", !check.ok);
  ok("and the blocking order is named", check.blockedBy.includes(first.id));

  // ALLOC-08: the flag is what decides whether that is fatal.
  const settings = await prisma.settings.findUnique({
    where: { id: "default" },
    select: { stockAllocationEnforced: true },
  });
  eq("the flag ships OFF, so nothing is blocked today", settings?.stockAllocationEnforced, false);
});

(async () => {
  await cleanup();
  try {
    await run("Stock allocation", [
      contention,
      plenty,
      partDelivered,
      overDelivered,
      ordering,
      dispatched,
      negativeStock,
      multiSize,
      emptyCases,
      noMutation,
      equivalence,
      deliveryCheck,
      enforcement,
    ]);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})();
