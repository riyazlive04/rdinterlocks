import { PrismaClient } from "@prisma/client";
import { DELIVERY_ZONE_DEFS } from "./delivery-zone-defs";

// Seeds the flat BrickPrice matrix — the price used when a quotation picks NO
// delivery zone (factory-gate collection, or any size/type combination with no
// ZonePrice row). Safe to run against a LIVE database: upserts on the
// [brickSizeId, constructionTypeId] unique pair, so re-running updates the
// same rows and never duplicates.
//
//   npx tsx prisma/seed-brick-prices.ts            # dry run (prints only)
//   npx tsx prisma/seed-brick-prices.ts --apply    # writes
//
// WHERE THE NUMBERS COME FROM
// The owner's District Rate Chart prices by distance band, not by
// factory-gate. The nearest band (0-20 km) is therefore used as the base
// matrix — it is the lowest rate on the sheet and the closest thing to "no
// delivery". That is an assumption, stated here rather than buried: if the
// factory charges a different rate for collection at the gate, change these
// four numbers in Settings -> Price matrix, which is the screen that owns
// them from then on.
//
// WHAT THIS SCRIPT DOES NOT KNOW
// BrickPrice also carries `masonRate` (₹/brick paid to the mason) and
// `productionCost`. Neither appears on the rate chart, which is a sell-side
// document. Both are seeded as 0 for a NEW row and LEFT UNTOUCHED on an
// existing one, so this script can never overwrite a figure somebody has
// already entered. A masonRate of 0 means mason payouts for that combination
// compute as zero — visibly wrong rather than quietly wrong, which is the
// intended failure mode. Fill them in at Settings -> Price matrix.

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Seed flat brick-price matrix — ${apply ? "APPLY" : "DRY RUN"}\n`);

  // The base band: first entry of the rate chart (0-20 km).
  const base = DELIVERY_ZONE_DEFS[0];
  console.log(`Base rates taken from "${base.distanceLabel}" (${base.name})\n`);

  const [sizes, types] = await Promise.all([
    prisma.brickSize.findMany(),
    prisma.constructionType.findMany(),
  ]);

  // Same tolerant matching as seed-delivery-zones.ts — the sheet writes 6"
  // and 8", the database stores "6" and "8".
  const digitsOf = (s: string) => s.replace(/[^0-9]/g, "");
  const size6 = sizes.find((s) => digitsOf(s.label) === "6");
  const size8 = sizes.find((s) => digitsOf(s.label) === "8");
  const compound = types.find((t) => t.name.trim().toLowerCase() === "compound");
  const room = types.find((t) => t.name.trim().toLowerCase() === "room");

  if (!size6 || !size8 || !compound || !room) {
    console.error("Missing master data. Found:");
    console.error(`  sizes: ${sizes.map((s) => JSON.stringify(s.label)).join(", ") || "(none)"}`);
    console.error(`  types: ${types.map((t) => JSON.stringify(t.name)).join(", ") || "(none)"}`);
    process.exit(1);
  }

  const rows = [
    { size: size6, type: compound, sellPrice: base.compound6 },
    { size: size6, type: room, sellPrice: base.room6 },
    { size: size8, type: compound, sellPrice: base.compound8 },
    { size: size8, type: room, sellPrice: base.room8 },
  ];

  for (const r of rows) {
    const existing = await prisma.brickPrice.findUnique({
      where: {
        brickSizeId_constructionTypeId: {
          brickSizeId: r.size.id,
          constructionTypeId: r.type.id,
        },
      },
    });
    const label = `${r.size.label}" ${r.type.name}`.padEnd(16);

    if (apply) {
      await prisma.brickPrice.upsert({
        where: {
          brickSizeId_constructionTypeId: {
            brickSizeId: r.size.id,
            constructionTypeId: r.type.id,
          },
        },
        // Only the sell price is managed here. masonRate/productionCost are
        // deliberately absent from `update` so an existing, hand-entered
        // figure survives a re-run.
        update: { sellPrice: r.sellPrice, active: true },
        create: {
          brickSizeId: r.size.id,
          constructionTypeId: r.type.id,
          sellPrice: r.sellPrice,
          masonRate: 0,
          productionCost: 0,
          active: true,
        },
      });
      console.log(`  ${label} ₹${r.sellPrice}  ${existing ? "updated" : "created"}`);
    } else {
      const was = existing ? `₹${existing.sellPrice}` : "none";
      console.log(`  ${label} ₹${r.sellPrice}  (would ${existing ? "update" : "create"}, currently ${was})`);
    }
  }

  // Anything priced on neither sheet nor matrix cannot be quoted at all, so
  // name it rather than leaving the office to discover it mid-quotation.
  const unpriced: string[] = [];
  for (const s of sizes) {
    for (const t of types) {
      const covered = rows.some((r) => r.size.id === s.id && r.type.id === t.id);
      if (covered) continue;
      const row = await prisma.brickPrice.findUnique({
        where: {
          brickSizeId_constructionTypeId: { brickSizeId: s.id, constructionTypeId: t.id },
        },
      });
      if (!row) unpriced.push(`${s.label}" ${t.name}`);
    }
  }
  if (unpriced.length) {
    console.log(
      `\nNot on the rate chart and still unpriced — a quotation for these will be refused:\n  ${unpriced.join("\n  ")}`
    );
    console.log("  Set them at Settings -> Price matrix, or leave them unpriced deliberately.");
  }

  console.log(
    `\nReminder: masonRate and productionCost are NOT on the rate chart.` +
      ` New rows get 0 for both — fill them in at Settings -> Price matrix before running payroll.`
  );
  if (!apply) console.log("\nDry run only — re-run with --apply to write these changes.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
