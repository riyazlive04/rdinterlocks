/**
 * Undo duplicate orders the bulk billing run created.
 *
 * Some loads already had an order — it was still "active" only because the load
 * had never been linked to it as a delivery. Billing them created a SECOND
 * order for the same bricks, double-counting the sale.
 *
 * The right shape is one order, delivered. For each duplicate this:
 *   1. frees any payments attached to the duplicate
 *   2. deletes the duplicate's delivery, putting its bricks back
 *   3. deletes the duplicate order
 *   4. books the bricks as a delivery on the ORIGINAL order at its own price
 *   5. re-attaches the freed payments to the original
 *
 *   npx tsx prisma/fix-duplicate-billed-orders.ts            # report
 *   npx tsx prisma/fix-duplicate-billed-orders.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { applyStockDeltas, recomputeOrderStatus, stockDeltasFor } from "../src/lib/delivery-sync";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const TAG = "Billed from the loading trip";

async function main() {
  const mine = await prisma.order.findMany({
    where: { notes: TAG },
    include: { items: true, client: true, deliveries: { include: { items: true, returns: true } }, payments: true },
  });
  const all = await prisma.order.findMany({ include: { items: true } });

  const pairs = [];
  for (const o of mine) {
    const q = o.items.reduce((s, i) => s + i.quantity, 0);
    const twin = all.find(
      (x) =>
        x.id !== o.id &&
        x.clientId === o.clientId &&
        x.date.toISOString().slice(0, 10) === o.date.toISOString().slice(0, 10) &&
        x.items.reduce((s, i) => s + i.quantity, 0) === q &&
        x.notes !== TAG
    );
    if (twin) pairs.push({ dup: o, twin, qty: q });
  }

  console.log(`duplicates to undo: ${pairs.length}\n`);
  let value = 0;
  for (const { dup, twin, qty } of pairs) {
    const v = dup.items.reduce((s, i) => s + i.total, 0);
    value += v;
    console.log(
      `  ${dup.date.toISOString().slice(0, 10)} ${dup.client.name.padEnd(14)} ${String(qty).padStart(5)} bricks ` +
        `Rs${String(Math.round(v)).padStart(7)}  payments=${dup.payments.length}  -> deliver on order ${twin.id.slice(-6)}`
    );
  }
  console.log(`\nvalue to remove from sales: Rs${Math.round(value).toLocaleString("en-IN")}`);
  if (!APPLY) {
    console.log("Nothing written. Add --apply.");
    return;
  }

  for (const { dup, twin, qty } of pairs) {
    // 1. free the payments
    const freed = dup.payments.map((x) => x.id);
    if (freed.length) {
      await prisma.clientPayment.updateMany({ where: { id: { in: freed } }, data: { orderId: null } });
    }
    // 2 + 3. remove the duplicate, putting its bricks back
    for (const d of dup.deliveries) {
      await prisma.delivery.delete({ where: { id: d.id } });
      const back = new Map<string, number>();
      for (const [sizeId, delta] of stockDeltasFor(d.items, d.returns)) back.set(sizeId, -delta);
      await applyStockDeltas(back);
    }
    await prisma.orderItem.deleteMany({ where: { orderId: dup.id } });
    await prisma.order.delete({ where: { id: dup.id } });

    // 4. deliver against the original, at the original's own price
    const original = await prisma.order.findUnique({
      where: { id: twin.id },
      include: { items: true, deliveries: true },
    });
    if (original && original.deliveries.length === 0 && original.items.length > 0) {
      const items = original.items.map((i) => ({
        brickSizeId: i.brickSizeId,
        constructionTypeId: i.constructionTypeId,
        quantity: i.quantity,
        pricePerBrick: i.pricePerBrick,
        total: i.total,
      }));
      await prisma.delivery.create({
        data: {
          orderId: original.id,
          date: dup.date,
          loadGroupId: `${original.clientId}|${dup.date.toISOString().slice(0, 10)}|${items[0].brickSizeId}`,
          notes: "Delivered on the loading trip",
          items: { create: items },
        },
      });
      await applyStockDeltas(stockDeltasFor(items, []));
      await recomputeOrderStatus(original.id);
    }

    // 5. put the payments on the original, biggest first, only where they fit
    const orderValue =
      (await prisma.orderItem.aggregate({ _sum: { total: true }, where: { orderId: twin.id } }))._sum
        .total ?? 0;
    const already =
      (await prisma.clientPayment.aggregate({ _sum: { amount: true }, where: { orderId: twin.id } }))
        ._sum.amount ?? 0;
    let left = orderValue - already;
    const pays = await prisma.clientPayment.findMany({ where: { id: { in: freed } } });
    for (const pay of pays.sort((a, b) => b.amount - a.amount)) {
      if (left <= 0) break;
      if (pay.amount > left) continue;
      await prisma.clientPayment.update({ where: { id: pay.id }, data: { orderId: twin.id } });
      left -= pay.amount;
    }
    console.log(`  fixed ${dup.client.name} (${qty} bricks)`);
  }
  console.log(`\nUndid ${pairs.length} duplicate order(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
