/**
 * Orders billed from a loading trip that never got their delivery.
 *
 * The bulk billing run identified legacy trips by customer+day+size, but the
 * delivery step still looked for a real loadGroupId, found nothing, and created
 * the order without booking the bricks. The revenue was recorded; the delivery
 * and the stock draw were not.
 *
 * This finds those orders, matches them back to the loading rows they were
 * billed from, and completes them: delivery, stock draw, status.
 *
 *   npx tsx prisma/repair-missing-deliveries.ts            # report
 *   npx tsx prisma/repair-missing-deliveries.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { applyStockDeltas, recomputeOrderStatus, stockDeltasFor } from "../src/lib/delivery-sync";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const orders = await prisma.order.findMany({
    where: { notes: "Billed from the loading trip", deliveries: { none: {} } },
    include: { items: true, client: true },
    orderBy: { date: "asc" },
  });
  console.log(`orders billed from a load but with no delivery: ${orders.length}\n`);

  let fixed = 0;
  let bricks = 0;
  for (const o of orders) {
    const item = o.items[0];
    if (!item) {
      console.log(`  skip  ${o.client.name} - order has no line`);
      continue;
    }
    const dayStart = new Date(o.date.toISOString().slice(0, 10) + "T00:00:00.000Z");
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const rows = await prisma.loadingWork.findMany({
      where: {
        clientId: o.clientId,
        date: { gte: dayStart, lt: dayEnd },
        brickSizeId: item.brickSizeId,
        phase: { not: "unloading" },
        loadType: "brick",
      },
    });
    const loaded = rows.reduce((s, r) => s + r.brickCount, 0);
    const match = loaded === item.quantity;
    console.log(
      `  ${o.date.toISOString().slice(0, 10)}  ${o.client.name.slice(0, 16).padEnd(16)} ` +
        `ordered ${String(item.quantity).padStart(5)}  loaded ${String(loaded).padStart(5)}  ` +
        (match ? "match" : "MISMATCH - skipped")
    );
    if (!match || rows.length === 0) continue;

    if (APPLY) {
      const key = `${o.clientId}|${o.date.toISOString().slice(0, 10)}|${item.brickSizeId}`;
      const items = [
        {
          brickSizeId: item.brickSizeId,
          constructionTypeId: item.constructionTypeId,
          quantity: item.quantity,
          pricePerBrick: item.pricePerBrick,
          total: item.total,
        },
      ];
      await prisma.delivery.create({
        data: {
          orderId: o.id,
          date: o.date,
          loadGroupId: key,
          notes: "Billed from a loading trip",
          items: { create: items },
        },
      });
      await applyStockDeltas(stockDeltasFor(items, []));
      await recomputeOrderStatus(o.id);
    }
    fixed++;
    bricks += item.quantity;
  }

  console.log(
    `\n${fixed} order(s) ${APPLY ? "repaired" : "repairable"}, ${bricks} bricks to draw from stock.`
  );
  if (!APPLY) console.log("Nothing written. Add --apply.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
