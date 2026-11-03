/**
 * Bring Settings -> Price matrix in line with what customers are actually
 * charged, taken from the order lines already on file.
 *
 * The matrix still carried the figures the app was seeded with (6" at Rs7-9)
 * while real orders run Rs42-73. That matters beyond the settings screen: the
 * Sales register auto-fills its rate from the matrix, so every new row started
 * with a wrong price that someone had to remember to overwrite.
 *
 * For each size x construction type this takes the price from the most recent
 * order line for that combination — the latest thing the office actually
 * agreed. Combinations never ordered are left exactly as they are, because
 * there is no evidence to change them with.
 *
 *   npx tsx prisma/refresh-price-matrix.ts           # show what would change
 *   npx tsx prisma/refresh-price-matrix.ts --apply   # write it
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const lines = await prisma.orderItem.findMany({
    include: { brickSize: true, constructionType: true, order: true },
    orderBy: { order: { date: "desc" } },
  });

  // First line wins per combination, and the query is newest-first.
  const latest = new Map<
    string,
    { size: string; type: string; price: number; when: Date; qty: number }
  >();
  for (const l of lines) {
    const key = `${l.brickSizeId}:${l.constructionTypeId}`;
    if (latest.has(key)) continue;
    if (l.pricePerBrick <= 0) continue;
    latest.set(key, {
      size: l.brickSize.label,
      type: l.constructionType.name,
      price: l.pricePerBrick,
      when: l.order.date,
      qty: l.quantity,
    });
  }

  const matrix = await prisma.brickPrice.findMany({
    include: { brickSize: true, constructionType: true },
  });

  const changes: Array<{ id: string; label: string; from: number; to: number; when: Date }> = [];
  for (const m of matrix) {
    const hit = latest.get(`${m.brickSizeId}:${m.constructionTypeId}`);
    if (!hit || hit.price === m.sellPrice) continue;
    changes.push({
      id: m.id,
      label: `${m.brickSize.label} ${m.constructionType.name}`,
      from: m.sellPrice,
      to: hit.price,
      when: hit.when,
    });
  }

  if (changes.length === 0) {
    console.log("Price matrix already matches the latest order prices. Nothing to do.");
    return;
  }

  console.log("combination            matrix now     latest order    from");
  console.log("-".repeat(64));
  for (const c of changes) {
    console.log(
      `${c.label.padEnd(22)} ${("Rs" + c.from).padStart(10)} ${("Rs" + c.to).padStart(15)}    ` +
        c.when.toISOString().slice(0, 10)
    );
  }

  const untouched = matrix.length - changes.length;
  console.log(`\n${changes.length} to update, ${untouched} left alone (no orders, or already right).`);

  if (!APPLY) {
    console.log("Nothing written. Re-run with --apply to update the matrix.");
    return;
  }
  for (const c of changes) {
    await prisma.brickPrice.update({ where: { id: c.id }, data: { sellPrice: c.to } });
  }
  console.log(`Updated ${changes.length} price(s). Change any of them in Settings -> Price matrix.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
