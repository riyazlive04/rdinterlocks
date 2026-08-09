/**
 * Compare the yard figure the app carries against what production and
 * deliveries say it should be, and correct a size to a real counted number.
 *
 * Why this exists: a delivery recorded without drawing stock — for instance one
 * entered before the draw-down was written — leaves "on hand" permanently too
 * high. The arithmetic below finds that, but it cannot tell you the truth: only
 * counting the yard can. So the report is automatic and the correction is not.
 *
 *   npx tsx prisma/reconcile-stock.ts                          # report only
 *   npx tsx prisma/reconcile-stock.ts --size='6"' --actual=69116 --apply
 *
 * The correction writes the difference onto the oldest batch of that size, the
 * same way a delivery being deleted puts bricks back, so the size's total ends
 * up at exactly the number counted.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const arg = (name: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const APPLY = process.argv.includes("--apply");

async function main() {
  const sizes = await prisma.brickSize.findMany({ orderBy: { order: "asc" } });

  console.log("size      produced   back in  delivered   should be    app says   difference");
  console.log("-".repeat(78));

  const report: Array<{ id: string; label: string; onHand: number; expected: number }> = [];

  for (const s of sizes) {
    const batches = await prisma.stockBatch.findMany({ where: { brickSizeId: s.id } });
    const produced = batches
      .filter((b) => b.source !== "return")
      .reduce((x, b) => x + b.count, 0);
    const backIn = batches.filter((b) => b.source === "return").reduce((x, b) => x + b.count, 0);
    const onHand = batches.reduce((x, b) => x + b.remaining, 0);
    const out =
      (
        await prisma.deliveryItem.aggregate({
          _sum: { quantity: true },
          where: { brickSizeId: s.id },
        })
      )._sum.quantity ?? 0;
    const expected = produced + backIn - out;
    if (produced === 0 && backIn === 0 && out === 0 && onHand === 0) continue;

    const diff = onHand - expected;
    console.log(
      `${s.label.padEnd(8)} ${String(produced).padStart(9)} ${String(backIn).padStart(9)} ` +
        `${String(out).padStart(10)} ${String(expected).padStart(11)} ${String(onHand).padStart(11)} ` +
        `${(diff > 0 ? "+" : "") + diff}`.padStart(13)
    );
    report.push({ id: s.id, label: s.label, onHand, expected });
  }

  const wantSize = arg("size");
  const wantActual = arg("actual");

  if (!wantSize || wantActual === undefined) {
    console.log(
      "\nA difference means bricks left the yard without stock being drawn - most often a\n" +
        "delivery recorded before the draw-down existed. Count the size in question, then:\n\n" +
        "  npx tsx prisma/reconcile-stock.ts --size='6\"' --actual=<counted> --apply\n"
    );
    return;
  }

  const target = report.find((r) => r.label === wantSize);
  if (!target) {
    console.error(`\nNo brick size labelled ${wantSize}. Use one of: ${report.map((r) => r.label).join(", ")}`);
    process.exit(1);
  }
  const actual = Number(wantActual);
  if (!Number.isFinite(actual) || actual < 0) {
    console.error("\n--actual must be a number of bricks actually counted.");
    process.exit(1);
  }

  const delta = actual - target.onHand;
  console.log(
    `\n${target.label}: app says ${target.onHand}, you counted ${actual} -> adjust by ${
      delta > 0 ? "+" : ""
    }${delta}`
  );
  if (delta === 0) {
    console.log("Already correct, nothing to do.");
    return;
  }
  if (!APPLY) {
    console.log("Nothing written. Re-run with --apply to make the change.");
    return;
  }

  const { applyStockDeltas } = await import("../src/lib/delivery-sync");
  await applyStockDeltas(new Map([[target.id, delta]]));

  const after = await prisma.stockBatch.aggregate({
    _sum: { remaining: true },
    where: { brickSizeId: target.id },
  });
  console.log(`Done. ${target.label} on hand is now ${after._sum.remaining}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
