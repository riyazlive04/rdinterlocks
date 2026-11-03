import { prisma } from "./db";
import { deriveOrderStatus } from "./order-status";

// Stock and order bookkeeping shared by the two places that dispatch bricks:
// recording a Delivery on the client screen, and saving a Loading entry that is
// tied to an order. Both must draw stock down the same way and leave the order
// status agreeing with what has actually gone out, so the logic lives here once
// rather than being written twice and drifting apart.

// Net signed change to apply to each brick size's ready stock for a delivery:
// items reduce stock; same-delivery returns (size-agnostic in the schema) are
// credited back against the first delivered size.
export function stockDeltasFor(
  items: Array<{ brickSizeId: string; quantity: number }>,
  returns: Array<{ brickCount: number }>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of items) {
    map.set(it.brickSizeId, (map.get(it.brickSizeId) ?? 0) - it.quantity);
  }
  const returnedTotal = returns.reduce((s, r) => s + r.brickCount, 0);
  if (returnedTotal > 0 && items.length > 0) {
    const firstSize = items[0].brickSizeId;
    map.set(firstSize, (map.get(firstSize) ?? 0) + returnedTotal);
  }
  return map;
}

// Apply a signed delta to a brick size's ready stock. delta < 0 draws down
// FIFO (last batch may go negative); delta > 0 restores onto the oldest ready
// batch. Either way the size's ready total changes by exactly `delta`.
async function adjustReadyStock(brickSizeId: string, delta: number) {
  if (!delta) return;
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const curingDays = settings?.curingDays ?? 10;
  const readyCutoff = new Date(Date.now() - curingDays * 86400000);
  let batches = await prisma.stockBatch.findMany({
    where: {
      brickSizeId,
      OR: [{ source: "return" }, { producedAt: { lte: readyCutoff } }],
    },
    orderBy: { producedAt: "asc" },
  });
  // Nothing "ready" yet for this size — fall back to any batch so the total
  // still reconciles instead of the delivery vanishing from stock.
  if (batches.length === 0) {
    batches = await prisma.stockBatch.findMany({
      where: { brickSizeId },
      orderBy: { producedAt: "asc" },
    });
  }
  if (batches.length === 0) return; // no batch of this size exists at all

  if (delta > 0) {
    const oldest = batches[0];
    await prisma.stockBatch.update({
      where: { id: oldest.id },
      data: { remaining: oldest.remaining + delta },
    });
    return;
  }

  let need = -delta; // number of bricks to remove
  for (let i = 0; i < batches.length && need > 0; i++) {
    const b = batches[i];
    const isLast = i === batches.length - 1;
    const take = isLast ? need : Math.min(need, Math.max(0, b.remaining));
    if (take <= 0 && !isLast) continue;
    await prisma.stockBatch.update({
      where: { id: b.id },
      data: { remaining: b.remaining - take },
    });
    need -= take;
  }
}

export async function applyStockDeltas(deltas: Map<string, number>) {
  for (const [brickSizeId, delta] of deltas) {
    await adjustReadyStock(brickSizeId, delta);
  }
}

// Recompute an order's status from what has actually been delivered. Called
// after anything that changes delivered quantity.
export async function recomputeOrderStatus(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, deliveries: { include: { items: true, returns: true } } },
  });
  if (!order) return;
  const orderedQty = order.items.reduce((s, i) => s + i.quantity, 0);
  let deliveredQty = 0;
  for (const d of order.deliveries) {
    deliveredQty += d.items.reduce((s, i) => s + i.quantity, 0);
    deliveredQty -= d.returns.reduce((s, r) => s + r.brickCount, 0);
  }
  const status = deriveOrderStatus({
    orderedQty,
    deliveredQty,
    date: order.date,
    expectedDeliveryDate: order.expectedDeliveryDate,
    current: order.status,
  });
  await prisma.order.update({ where: { id: orderId }, data: { status } });
}
