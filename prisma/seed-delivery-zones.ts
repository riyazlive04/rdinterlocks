import { PrismaClient } from "@prisma/client";
import { DELIVERY_ZONE_DEFS } from "./delivery-zone-defs";

// One-off seed for the "AREA RATE RD BRICKS" reference sheet, safe to run
// against a LIVE database: upserts DeliveryZone rows by name (idempotent —
// re-running just updates the same rows, never duplicates), plus their
// ZoneBrickRule and ZonePrice children. Requires the "6"" and "8"" BrickSize
// rows and the "Compound"/"Room" ConstructionType rows to already exist
// (from the normal seed) — skips with a warning if any are missing rather
// than creating master data this script shouldn't own.
//
// Defaults to a DRY RUN that only prints what it would do.
//
//   npx tsx prisma/seed-delivery-zones.ts            # dry run
//   npx tsx prisma/seed-delivery-zones.ts --apply     # writes

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Seed delivery zones — ${apply ? "APPLY" : "DRY RUN"}\n`);

  // Resolve master data TOLERANTLY. The reference sheet writes sizes as 6"
  // and 8", but the live database stores them as plain "6" and "8" — an
  // exact-match lookup aborts the whole seed over a punctuation difference,
  // which is how this script came to have never been run. Compare on digits
  // only, and on case-insensitive names, so either spelling resolves.
  const [sizes, types] = await Promise.all([
    prisma.brickSize.findMany(),
    prisma.constructionType.findMany(),
  ]);
  const digitsOf = (s: string) => s.replace(/[^0-9]/g, "");
  const findSize = (want: string) => sizes.find((s) => digitsOf(s.label) === want);
  const findType = (want: string) =>
    types.find((t) => t.name.trim().toLowerCase() === want.toLowerCase());

  const size6 = findSize("6");
  const size8 = findSize("8");
  const compound = findType("Compound");
  const room = findType("Room");

  if (!size6 || !size8 || !compound || !room) {
    const missing = [
      !size6 && 'BrickSize 6 (or 6")',
      !size8 && 'BrickSize 8 (or 8")',
      !compound && "ConstructionType Compound",
      !room && "ConstructionType Room",
    ].filter(Boolean);
    console.error(`Missing master data — create these first:\n  ${missing.join("\n  ")}`);
    console.error(`\nFound sizes: ${sizes.map((s) => JSON.stringify(s.label)).join(", ") || "(none)"}`);
    console.error(`Found types: ${types.map((t) => JSON.stringify(t.name)).join(", ") || "(none)"}`);
    process.exit(1);
  }
  console.log(
    `Master data: size ${JSON.stringify(size6.label)}/${JSON.stringify(size8.label)}, ` +
      `types ${JSON.stringify(compound.name)}/${JSON.stringify(room.name)}\n`
  );

  for (const [i, def] of DELIVERY_ZONE_DEFS.entries()) {
    console.log(`${i + 1}. ${def.name} (${def.distanceLabel})`);
    let zoneId: string;
    if (apply) {
      const zone = await prisma.deliveryZone.upsert({
        where: { name: def.name },
        update: { distanceLabel: def.distanceLabel, areas: def.areas, order: i },
        create: { name: def.name, distanceLabel: def.distanceLabel, areas: def.areas, order: i },
      });
      zoneId = zone.id;

      await prisma.zoneBrickRule.upsert({
        where: { zoneId_brickSizeId: { zoneId, brickSizeId: size6.id } },
        update: { minBricks: def.minBricks6, transportOnly: def.transportOnly6 },
        create: { zoneId, brickSizeId: size6.id, minBricks: def.minBricks6, transportOnly: def.transportOnly6 },
      });
      await prisma.zoneBrickRule.upsert({
        where: { zoneId_brickSizeId: { zoneId, brickSizeId: size8.id } },
        update: { minBricks: def.minBricks8, transportOnly: def.transportOnly8 },
        create: { zoneId, brickSizeId: size8.id, minBricks: def.minBricks8, transportOnly: def.transportOnly8 },
      });

      const priceRows: Array<[string, string, number]> = [
        [size6.id, compound.id, def.compound6],
        [size8.id, compound.id, def.compound8],
        [size6.id, room.id, def.room6],
        [size8.id, room.id, def.room8],
      ];
      for (const [brickSizeId, constructionTypeId, sellPrice] of priceRows) {
        await prisma.zonePrice.upsert({
          where: { zoneId_brickSizeId_constructionTypeId: { zoneId, brickSizeId, constructionTypeId } },
          update: { sellPrice },
          create: { zoneId, brickSizeId, constructionTypeId, sellPrice },
        });
      }
    } else {
      const existing = await prisma.deliveryZone.findUnique({ where: { name: def.name } });
      console.log(`   ${existing ? "already exists — would update" : "would create"}`);
    }
    console.log(
      `   min: 6"=${def.minBricks6 || "none"} 8"=${def.minBricks8 || "none"} · transport-only: 6"=${
        def.transportOnly6 ?? "n/a"
      } 8"=${def.transportOnly8 ?? "n/a"} · Compound ₹${def.compound6}/${def.compound8} · Room ₹${def.room6}/${def.room8}`
    );
  }

  if (!apply) {
    console.log("\nDry run only — re-run with --apply to write these changes.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
