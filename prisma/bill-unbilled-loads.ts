/**
 * Loads that went out with no order behind them — and what the money says they
 * were worth.
 *
 * A customer who paid but has no order leaves the payment unallocated. Divide
 * that by the bricks actually loaded and you get the rate that was agreed,
 * without anyone having to remember it. Where that lands inside the range the
 * business really charges, it is worth trusting; where it doesn't, it isn't,
 * and the report says so rather than guessing.
 *
 *   npx tsx prisma/bill-unbilled-loads.ts                                # report
 *   npx tsx prisma/bill-unbilled-loads.ts --bill=<loadGroupId> --rate=49 \
 *       [--type=Compound] --apply
 *
 * Billing creates the order through the same path the Sales register uses, books
 * the loaded bricks as delivered, draws stock, and allocates the customer's
 * unallocated payments to the new order so the balance reads true.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const arg = (n: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : undefined;
};
const APPLY = process.argv.includes("--apply");

// The band real 6"/8" orders sit in. Outside it, an implied rate is noise
// (several loads sharing one payment, or a payment for something else).
const PLAUSIBLE = { min: 25, max: 95 };

type Group = {
  loadGroupId: string;
  date: Date;
  clientId: string;
  clientName: string;
  location: string;
  brickSizeId: string | null;
  sizeLabel: string;
  bricks: number;
};

async function unbilledGroups(): Promise<Group[]> {
  const rows = await prisma.loadingWork.findMany({
    where: { clientId: { not: null }, phase: { not: "unloading" }, loadType: "brick" },
    include: { client: true, brickSize: true },
    orderBy: { date: "desc" },
  });
  const billed = new Set(
    (
      await prisma.delivery.findMany({
        where: { loadGroupId: { not: null } },
        select: { loadGroupId: true },
      })
    ).map((d) => d.loadGroupId)
  );
  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = r.loadGroupId ?? r.id;
    if (billed.has(key)) continue;
    const g = map.get(key) ?? {
      loadGroupId: key,
      date: r.date,
      clientId: r.clientId!,
      clientName: r.client!.name,
      location: r.client!.location ?? "",
      brickSizeId: r.brickSizeId,
      sizeLabel: r.brickSize?.label ?? "mixed",
      bricks: 0,
    };
    g.bricks += r.brickCount;
    map.set(key, g);
  }
  return [...map.values()];
}

async function report() {
  const groups = await unbilledGroups();
  const byClient = new Map<string, Group[]>();
  for (const g of groups) {
    byClient.set(g.clientId, [...(byClient.get(g.clientId) ?? []), g]);
  }

  console.log(`${groups.length} unbilled loads across ${byClient.size} customers\n`);
  console.log("customer          loads  bricks   unallocated paid   implied rate   verdict");
  console.log("-".repeat(86));

  let confident = 0;
  for (const [clientId, list] of byClient) {
    const paid = await prisma.clientPayment.aggregate({
      _sum: { amount: true },
      where: { clientId, orderId: null },
    });
    const total = paid._sum.amount ?? 0;
    const bricks = list.reduce((s, g) => s + g.bricks, 0);
    const rate = bricks > 0 ? total / bricks : 0;
    const ok = total > 0 && rate >= PLAUSIBLE.min && rate <= PLAUSIBLE.max;
    if (ok) confident++;
    console.log(
      `${list[0].clientName.slice(0, 16).padEnd(16)} ${String(list.length).padStart(5)} ` +
        `${String(bricks).padStart(7)} ${("Rs" + Math.round(total)).padStart(18)} ` +
        `${(total > 0 ? "Rs" + rate.toFixed(2) : "-").padStart(14)}   ` +
        (total === 0 ? "no payment - rate unknown" : ok ? "looks right" : "outside normal range")
    );
  }
  console.log(
    `\n${confident} customer(s) have a payment implying a believable rate.\n` +
      `Bill one with:\n  npx tsx prisma/bill-unbilled-loads.ts --bill=<loadGroupId> --rate=<n> --apply\n`
  );
  for (const g of groups.slice(0, 12)) {
    console.log(
      `  ${g.date.toISOString().slice(0, 10)}  ${g.clientName.slice(0, 14).padEnd(14)} ` +
        `${String(g.bricks).padStart(5)} ${g.sizeLabel.padEnd(5)} ${g.loadGroupId}`
    );
  }
}

async function bill(loadGroupId: string, rate: number, typeName?: string) {
  const groups = await unbilledGroups();
  const g = groups.find((x) => x.loadGroupId === loadGroupId);
  if (!g) throw new Error(`No unbilled load with group id ${loadGroupId}`);

  const type = typeName
    ? await prisma.constructionType.findFirst({ where: { name: { equals: typeName, mode: "insensitive" } } })
    : await prisma.constructionType.findFirst({ orderBy: { order: "asc" } });
  if (!type) throw new Error(`No construction type${typeName ? ` called ${typeName}` : ""}`);
  if (!g.brickSizeId) throw new Error("That load has no brick size, so it can't be priced");

  const client = await prisma.client.findUnique({ where: { id: g.clientId } });
  const value = g.bricks * rate;
  console.log(
    `${g.clientName} (${g.location}) - ${g.bricks} x ${g.sizeLabel} ${type.name} @ Rs${rate} = Rs${value}`
  );

  const unallocated = await prisma.clientPayment.findMany({
    where: { clientId: g.clientId, orderId: null },
    orderBy: { date: "asc" },
  });
  const paid = unallocated.reduce((s, x) => s + x.amount, 0);
  console.log(`  unallocated payments to attach: ${unallocated.length} (Rs${paid})`);
  console.log(`  balance after billing: Rs${Math.max(0, value - paid)}`);

  if (!APPLY) {
    console.log("\nNothing written. Add --apply to create the order.");
    return;
  }

  const { createRegisterRow } = await import("../src/app/(app)/clients/register/actions");
  try {
    await createRegisterRow({
      date: g.date.toISOString().slice(0, 10),
      name: g.clientName,
      phone: client?.phone ?? undefined,
      location: client?.location ?? undefined,
      clientId: g.clientId,
      brickSizeId: g.brickSizeId,
      constructionTypeId: type.id,
      quantity: g.bricks,
      pricePerBrick: rate,
      notes: "Billed from the loading trip",
      fromLoadGroupId: g.loadGroupId,
    });
  } catch (e) {
    // revalidatePath only works inside a request; the writes are already done.
    const m = e instanceof Error ? e.message : String(e);
    if (!m.includes("static generation store missing") && !m.includes("NEXT_REDIRECT")) throw e;
  }

  const order = await prisma.order.findFirst({
    where: { clientId: g.clientId },
    orderBy: { id: "desc" },
    include: { deliveries: true, items: true },
  });
  if (!order) throw new Error("Order was not created");

  // Attach what the customer already paid, oldest first, up to the order value.
  let left = value;
  let attached = 0;
  for (const pay of unallocated) {
    if (left <= 0) break;
    await prisma.clientPayment.update({ where: { id: pay.id }, data: { orderId: order.id } });
    left -= pay.amount;
    attached++;
  }

  const check = await prisma.order.findUnique({
    where: { id: order.id },
    include: { items: true, deliveries: { include: { items: true } }, payments: true },
  });
  const delivered =
    check?.deliveries.reduce((s, d) => s + d.items.reduce((x, i) => x + i.quantity, 0), 0) ?? 0;
  console.log(
    `\nDone. order=${order.id} status=${check?.status} ` +
      `ordered=${check?.items.reduce((s, i) => s + i.quantity, 0)} delivered=${delivered} ` +
      `paid=Rs${check?.payments.reduce((s, x) => s + x.amount, 0)} (${attached} payment(s) attached)`
  );
}

async function main() {
  const target = arg("bill");
  if (!target) return report();
  const rate = Number(arg("rate"));
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("--rate=<price per brick> is required");
  await bill(target, rate, arg("type"));
}

main()
  .catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
