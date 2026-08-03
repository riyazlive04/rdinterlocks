/**
 * Create the missing Tipper trip for loading entries that named a tipper but
 * were saved with a zero shifting charge.
 *
 * Until this release, a loading entry only wrote a TipperLoad when there was
 * money on it, so a truck that ran for free left no trace on the Tipper page or
 * against the customer. The entry form now always records the trip; this fills
 * in the ones already saved.
 *
 * Adds rows only — no money, no cash entries, nothing edited or deleted.
 * Re-running it is safe: load groups that already have a trip are skipped.
 *
 *   npx tsx prisma/backfill-tipper-loads.ts          # report only
 *   npx tsx prisma/backfill-tipper-loads.ts --apply  # write the rows
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await prisma.loadingWork.findMany({
    where: { tipperId: { not: null }, loadGroupId: { not: null } },
    include: { client: true, brickSize: true, tipper: true },
    orderBy: { date: "asc" },
  });

  // One trip per load group. Bricks are counted on the loading phase only, so
  // the unloading rows for the same load don't double the quantity.
  const groups = new Map<
    string,
    {
      date: Date;
      tipperId: string;
      tipperName: string;
      clientName: string | null;
      clientLocation: string | null;
      brickSizeId: string | null;
      bricks: number;
      slabs: number;
    }
  >();

  for (const r of rows) {
    const key = r.loadGroupId!;
    const g = groups.get(key) ?? {
      date: r.date,
      tipperId: r.tipperId!,
      tipperName: r.tipper?.name ?? "Tipper",
      clientName: r.client?.name ?? null,
      clientLocation: r.client?.location ?? null,
      brickSizeId: null,
      bricks: 0,
      slabs: 0,
    };
    if (r.phase !== "unloading") {
      if (r.loadType === "lintel") g.slabs += r.brickCount;
      else {
        g.bricks += r.brickCount;
        g.brickSizeId = g.brickSizeId ?? r.brickSizeId;
      }
    }
    groups.set(key, g);
  }

  const existing = await prisma.tipperLoad.findMany({
    where: { loadGroupId: { in: [...groups.keys()] } },
    select: { loadGroupId: true },
  });
  const done = new Set(existing.map((t) => t.loadGroupId));

  const missing = [...groups.entries()].filter(([k]) => !done.has(k));

  console.log(`Loading entries with a tipper: ${groups.size}`);
  console.log(`Already on the Tipper page:    ${groups.size - missing.length}`);
  console.log(`Missing a trip:                ${missing.length}\n`);

  for (const [, g] of missing) {
    console.log(
      `  ${g.date.toISOString().slice(0, 10)}  ${g.tipperName}  ` +
        `${g.bricks} bricks${g.slabs ? ` + ${g.slabs} slabs` : ""}` +
        `${g.clientName ? `  -> ${g.clientName}` : ""}`
    );
  }

  if (!APPLY) {
    console.log(`\nNothing written. Re-run with --apply to create ${missing.length} trip(s).`);
    return;
  }

  let made = 0;
  for (const [loadGroupId, g] of missing) {
    const tipper = await prisma.tipper.findUnique({ where: { id: g.tipperId } });
    if (!tipper) continue;
    await prisma.tipperLoad.create({
      data: {
        date: g.date,
        loadGroupId,
        tipperId: tipper.id,
        vendorId: tipper.vendorId,
        loadType: g.bricks > 0 ? "bricks" : "material",
        brickSizeId: g.bricks > 0 ? g.brickSizeId : null,
        materialName: g.bricks === 0 && g.slabs > 0 ? "Lintel slabs" : null,
        quantity: g.bricks > 0 ? g.bricks : g.slabs,
        unit: "pcs",
        toLocation: g.clientLocation,
        rentAmount: 0,
        rentDirection: tipper.ownership === "own" ? "in" : "out",
        notes:
          "Backfilled from loading entry - no charge was recorded" +
          (g.bricks > 0 && g.slabs > 0 ? ` (+ ${g.slabs} lintel slabs)` : ""),
      },
    });
    made++;
  }
  console.log(`\nCreated ${made} tipper trip(s). No money was touched.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
