// Which order gets the bricks that are actually in the godown.
//
// ─── Why this is derived and not stored ───────────────────────────────
// The obvious design is to hold stock per order: a reservation row, or a
// `reserved` column on StockBatch. It was rejected. A stored reservation has
// to be kept in step with order creation, cancellation, partial dispatch,
// stage reversal and manual stock corrections — six writers to one derived
// number, and the first bug in any of them makes availability lie in a way
// nobody can see.
//
// So availability is RECOMPUTED on every read from orders and batches, holds
// nothing, and therefore cannot drift. Two consequences worth stating:
// "release on cancellation" is not a rule anyone has to implement (a
// cancelled order leaves the queue and its claim evaporates), and neither is
// partial dispatch (allocation works from ordered-minus-delivered).
//
// ─── What this is NOT ────────────────────────────────────────────────
// Not a lock. Two people dispatching in the same second can both pass the
// check. That is the accepted trade for this factory: one supervisor, one
// godown, bricks physically counted onto the lorry, and `remaining` is
// reconcilable afterwards. Revisit if a second godown ever opens.
//
// This file is PURE — no Prisma import, no await — so the allocation is
// testable without a database and the queue ordering is an argument rather
// than an incidental property of a page query. Same reasoning as
// lib/stock.ts:stageForAge.

/** The queue's view of an order: what it still needs, and where it stands. */
export type AllocatableOrder = {
  id: string;
  /** What the queue sorts by — oldest waiting first. */
  stageChangedAt: Date;
  /** queued | in_production | ready | dispatched */
  fulfilmentStage: string;
  /** Ordered quantity per brick size. */
  ordered: Array<{ brickSizeId: string; quantity: number }>;
  /** Already delivered per brick size, subtracted from `ordered`. */
  delivered: Array<{ brickSizeId: string; quantity: number }>;
};

export type AllocatedNeed = {
  brickSizeId: string;
  /** Still undelivered on this order. */
  need: number;
  /** What was left in the pool when this order's turn came. */
  have: number;
  /** How much of `need` this order actually got. */
  taken: number;
  /** need - taken. Zero means the godown can cover it. */
  short: number;
};

export type OrderAllocation = {
  orderId: string;
  needs: AllocatedNeed[];
  pendingTotal: number;
  shortTotal: number;
  /**
   * Orders ahead in the queue that took stock this one needs.
   *
   * The third thing the page-local version never answered: a supervisor saw a
   * shortfall number but not who upstream had consumed it, so "why is this
   * order short?" meant reading the whole queue.
   */
  blockedBy: string[];
};

/** Sum a per-size list into a map, clamping negatives away. */
function pendingBySize(order: AllocatableOrder): Map<string, number> {
  const pending = new Map<string, number>();
  for (const it of order.ordered) {
    pending.set(it.brickSizeId, (pending.get(it.brickSizeId) ?? 0) + it.quantity);
  }
  for (const it of order.delivered) {
    pending.set(it.brickSizeId, (pending.get(it.brickSizeId) ?? 0) - it.quantity);
  }
  // An over-delivered line must not feed surplus back into the pool as if the
  // extra bricks had returned to the godown.
  for (const [k, v] of pending) if (v <= 0) pending.delete(k);
  return pending;
}

/**
 * Allocate the ready-stock pool down the queue, oldest-waiting first.
 *
 * Ready stock is a SHARED pool, so judging each order against the full total
 * independently tells the supervisor that three orders are all dispatchable
 * when there are only enough bricks for the first. Each order is instead
 * judged against what is left after the ones ahead of it have taken theirs.
 *
 * `readyBySize` is consumed as a copy; the caller's map is not mutated.
 */
export function allocateReadyStock(
  orders: AllocatableOrder[],
  readyBySize: Map<string, number>
): Map<string, OrderAllocation> {
  // A negative `remaining` from a past override is real (it is the audit
  // trail of an overdraw) but it must not grant phantom availability to the
  // next order, so it counts as zero here.
  const pool = new Map<string, number>();
  for (const [sizeId, qty] of readyBySize) pool.set(sizeId, Math.max(0, qty));

  // Who last emptied the pool for a given size, so a shortfall can name it.
  const lastTaker = new Map<string, string>();

  const sorted = [...orders].sort(
    (a, b) =>
      a.stageChangedAt.getTime() - b.stageChangedAt.getTime() ||
      // Without a tiebreak, two orders stamped the same second swap blame
      // between page loads and the queue reads differently on each refresh.
      a.id.localeCompare(b.id)
  );

  const out = new Map<string, OrderAllocation>();

  for (const order of sorted) {
    const pending = pendingBySize(order);
    const needs: AllocatedNeed[] = [];
    const blockedBy = new Set<string>();

    for (const [brickSizeId, need] of pending) {
      // A dispatched order's bricks have already left the godown. Reporting a
      // shortfall against stock it no longer needs would be wrong, and
      // letting it compete for the pool would starve live orders of stock
      // that is genuinely free. Its need reads as met and it takes nothing.
      if (order.fulfilmentStage === "dispatched") {
        needs.push({ brickSizeId, need, have: need, taken: need, short: 0 });
        continue;
      }

      const have = pool.get(brickSizeId) ?? 0;
      const taken = Math.min(need, have);
      pool.set(brickSizeId, have - taken);
      const short = need - taken;

      if (short > 0) {
        const culprit = lastTaker.get(brickSizeId);
        if (culprit) blockedBy.add(culprit);
      }
      if (taken > 0) lastTaker.set(brickSizeId, order.id);

      needs.push({ brickSizeId, need, have, taken, short });
    }

    out.set(order.id, {
      orderId: order.id,
      needs,
      pendingTotal: needs.reduce((s, n) => s + n.need, 0),
      shortTotal: needs.reduce((s, n) => s + n.short, 0),
      blockedBy: [...blockedBy],
    });
  }

  return out;
}

/** What is left in the pool once every live order has taken its share. */
export function unallocatedStock(
  orders: AllocatableOrder[],
  readyBySize: Map<string, number>
): Map<string, number> {
  const alloc = allocateReadyStock(orders, readyBySize);
  const stageOf = new Map(orders.map((o) => [o.id, o.fulfilmentStage]));
  const free = new Map<string, number>();
  for (const [sizeId, qty] of readyBySize) free.set(sizeId, Math.max(0, qty));
  for (const a of alloc.values()) {
    // A dispatched order's `taken` is bookkeeping — its bricks already left,
    // so it never drew on this pool.
    if (stageOf.get(a.orderId) === "dispatched") continue;
    for (const n of a.needs) {
      free.set(n.brickSizeId, (free.get(n.brickSizeId) ?? 0) - n.taken);
    }
  }
  return free;
}

export type ShortfallCheck = {
  /** True when the delivery can be covered without taking another order's share. */
  ok: boolean;
  /** Per size, how much this delivery exceeds what is allocated to the order. */
  shortfalls: Array<{ brickSizeId: string; requested: number; allocated: number; short: number }>;
  /** Orders ahead in the queue whose stock would be taken. */
  blockedBy: string[];
};

/**
 * Would this delivery take bricks allocated to an order ahead of it?
 *
 * Compared against what the ALLOCATOR gave this order, not against total
 * ready stock: the point is precisely that total stock looks sufficient when
 * an earlier order has already been promised it.
 */
export function checkDeliveryAgainstAllocation(
  orderId: string,
  requested: Array<{ brickSizeId: string; quantity: number }>,
  orders: AllocatableOrder[],
  readyBySize: Map<string, number>
): ShortfallCheck {
  const mine = allocateReadyStock(orders, readyBySize).get(orderId);
  const allocated = new Map<string, number>();
  for (const n of mine?.needs ?? []) {
    allocated.set(n.brickSizeId, (allocated.get(n.brickSizeId) ?? 0) + n.taken);
  }

  const wanted = new Map<string, number>();
  for (const r of requested) {
    wanted.set(r.brickSizeId, (wanted.get(r.brickSizeId) ?? 0) + r.quantity);
  }

  const shortfalls: ShortfallCheck["shortfalls"] = [];
  for (const [brickSizeId, requestedQty] of wanted) {
    const have = allocated.get(brickSizeId) ?? 0;
    if (requestedQty > have) {
      shortfalls.push({
        brickSizeId,
        requested: requestedQty,
        allocated: have,
        short: requestedQty - have,
      });
    }
  }

  return {
    ok: shortfalls.length === 0,
    shortfalls,
    blockedBy: shortfalls.length ? (mine?.blockedBy ?? []) : [],
  };
}
