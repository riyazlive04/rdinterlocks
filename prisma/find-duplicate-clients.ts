/**
 * Customers who may have been entered twice.
 *
 * Two records for one person split their history: orders on one, loading and
 * payments on the other, and neither screen shows the whole picture. It has
 * already caused confusion once — two customers called Ramesh turned out to be
 * genuinely different people in different towns, which is exactly why this
 * reports rather than merges.
 *
 * Same phone number is near-certain. Same name with different phones usually is
 * NOT a duplicate; it needs a human to look at the town.
 *
 *   npx tsx prisma/find-duplicate-clients.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const digits = (s: string) => s.replace(/\D/g, "");

async function main() {
  const clients = await prisma.client.findMany({
    where: { active: true },
    include: {
      orders: { include: { items: true, payments: true } },
      loadingWorks: { select: { id: true } },
      payments: { select: { amount: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const describe = (c: (typeof clients)[number]) => {
    const value = c.orders.reduce((s, o) => s + o.items.reduce((x, i) => x + i.total, 0), 0);
    const paid = c.payments.reduce((s, x) => s + x.amount, 0);
    return (
      `${c.name.slice(0, 18).padEnd(18)} ${(c.location ?? "-").slice(0, 16).padEnd(16)} ` +
      `${(c.phone ?? "-").padEnd(12)} orders=${String(c.orders.length).padStart(2)} ` +
      `loads=${String(c.loadingWorks.length).padStart(3)} value=Rs${String(Math.round(value)).padStart(7)} ` +
      `paid=Rs${Math.round(paid)}`
    );
  };

  // ── Same phone: almost certainly one person ──
  const byPhone = new Map<string, typeof clients>();
  for (const c of clients) {
    const d = c.phone ? digits(c.phone) : "";
    if (d.length < 6) continue;
    const key = d.slice(-10);
    byPhone.set(key, [...(byPhone.get(key) ?? []), c]);
  }
  const phoneDupes = [...byPhone.entries()].filter(([, list]) => list.length > 1);

  console.log("=== SAME PHONE NUMBER - almost certainly the same person ===");
  if (phoneDupes.length === 0) console.log("  none\n");
  for (const [phone, list] of phoneDupes) {
    console.log(`\n  ${phone}`);
    for (const c of list) console.log(`    ${describe(c)}`);
  }

  // ── Same name, different phone: usually different people ──
  const byName = new Map<string, typeof clients>();
  for (const c of clients) {
    const key = c.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), c]);
  }
  const nameDupes = [...byName.entries()].filter(([, list]) => list.length > 1);

  console.log("\n\n=== SAME NAME - check the town before assuming anything ===");
  if (nameDupes.length === 0) console.log("  none");
  for (const [, list] of nameDupes) {
    const places = new Set(list.map((c) => (c.location ?? "").toLowerCase()).filter(Boolean));
    const phones = new Set(list.map((c) => digits(c.phone ?? "")).filter((d) => d.length >= 6));
    // The number decides it. Two records sharing one phone are one person
    // however the town is spelled — "Mecheri,kuttampatti" and
    // "Meacheri,kuttampatti" are the same place typed twice, and treating that
    // as evidence of two people would be worse than saying nothing.
    const verdict =
      phones.size === 1
        ? "SAME number - one person entered twice, whatever the town says"
        : phones.size > 1 && places.size > 1
          ? "different town AND number - almost certainly two people"
          : phones.size > 1
            ? "different number, same/blank town - look at this one"
            : "no number to tell them apart - look at this one";
    console.log(`\n  ${list[0].name}  (${verdict})`);
    for (const c of list) console.log(`    ${describe(c)}`);
  }

  console.log(
    "\n\nNothing was changed. Merging moves real orders and payments between records,\n" +
      "so it is a decision for someone who knows the customers, not for a script."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
