/**
 * Idempotent catch-up for a LIVE database — adds what a new release needs
 * without touching any operational data. Safe to run as often as you like.
 *
 * DOES:
 *  - adds any missing expense category (never renames or deletes one)
 *  - moves old order statuses (open/partial/complete) onto the new
 *    upcoming/active/completed set
 *  - moves old task statuses (open) onto the new wip/done/not_done set
 *
 * Run AFTER `npx prisma db push`:
 *   npm run db:upgrade
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Categories every install should have. Order only applies to ones we create;
// an existing category keeps whatever order the admin gave it.
const CATEGORIES: Array<[string, number]> = [
  ["Cement", 1],
  ["Flyash", 2],
  ["Powder", 3],
  ["Chips", 4],
  ["Admixer", 5],
  ["Sludge", 6],
  ["Diesel", 7],
  ["Oil", 8],
  ["Spares", 9],
  ["Bearings", 10],
  ["Mould (Die)", 11],
  ["PLC elements", 12],
  ["Welding", 13],
  ["Bolts & Nuts", 14],
  ["Lathe", 15],
  ["EB (Electricity)", 16],
  ["Land Rent", 17],
  ["Site Visit", 18],
  ["Gas", 19],
  ["Rice", 20],
  ["Gloves", 21],
  ["Tea", 22],
  ["Wifi", 23],
  ["Salary", 24],
  ["Bonus", 25],
  ["EMI", 26],
  ["Shifting charges", 27],
  ["Lintel Beam", 28],
  ["Ranjith Taken", 29],
  ["Interest", 30],
  ["Debt", 31],
  ["Tipper Due", 32],
  ["Other", 99],
];

async function main() {
  console.log("Upgrading master data…");

  let added = 0;
  for (const [name, order] of CATEGORIES) {
    const existing = await prisma.expenseCategory.findUnique({ where: { name } });
    if (existing) continue;
    await prisma.expenseCategory.create({ data: { name, order } });
    added++;
    console.log(`  + expense category "${name}"`);
  }
  console.log(`Expense categories: ${added} added, ${CATEGORIES.length - added} already there.`);

  // ── Order status: open|partial -> active, complete -> completed ──
  // "upcoming" is derived on the next delivery/order edit; anything not yet
  // delivered but dated in the future is flipped here too.
  const toActive = await prisma.order.updateMany({
    where: { status: { in: ["open", "partial"] } },
    data: { status: "active" },
  });
  const toCompleted = await prisma.order.updateMany({
    where: { status: "complete" },
    data: { status: "completed" },
  });

  // Anything undelivered whose expected date is still ahead reads as upcoming.
  const undelivered = await prisma.order.findMany({
    where: { status: "active", deliveries: { none: {} } },
    select: { id: true, date: true, expectedDeliveryDate: true },
  });
  const now = new Date();
  const upcomingIds = undelivered
    .filter((o) => (o.expectedDeliveryDate ?? o.date) > now)
    .map((o) => o.id);
  if (upcomingIds.length > 0) {
    await prisma.order.updateMany({
      where: { id: { in: upcomingIds } },
      data: { status: "upcoming" },
    });
  }
  console.log(
    `Orders: ${toActive.count} -> active, ${toCompleted.count} -> completed, ${upcomingIds.length} -> upcoming.`
  );

  // ── Task status: open -> wip ──
  const tasks = await prisma.task.updateMany({
    where: { status: "open" },
    data: { status: "wip" },
  });
  console.log(`Tasks: ${tasks.count} -> work in progress.`);

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
