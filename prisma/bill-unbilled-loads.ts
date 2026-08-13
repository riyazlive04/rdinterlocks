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
 *   npx tsx prisma/bill-unbilled-loads.ts --all [--apply]                # bill every one
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
    // Entries saved before load groups existed have no loadGroupId, and each
    // worker on the trip is its own row. Keyed by row id they would look like
    // a dozen tiny separate loads; the customer, day and size are what actually
    // identify one trip, so fall back to that and the rows add back up.
    const key = r.loadGroupId ?? `${r.clientId}|${r.date.toISOString().slice(0, 10)}|${r.brickSizeId ?? "mixed"}`;
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

  // Attach what the customer already paid. Biggest first, and only where the
  // payment still fits inside what this order is worth: a customer with two
  // loads has paid for both, and taking payments in date order would dump the
  // lot on whichever was billed first and leave the other looking unpaid.
  let left = value;
  let attached = 0;
  for (const pay of [...unallocated].sort((a, b) => b.amount - a.amount)) {
    if (left <= 0) break;
    if (pay.amount > left) continue; // belongs to another load
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

// Bill every unbilled load in one pass. The rate for each comes from the best
// evidence available, in this order:
//   1. what this customer was last charged for that size
//   2. the price matrix for that size × type
// A load with no rate from either is skipped and named, never guessed at zero.
async function billAll() {
  const groups = await unbilledGroups();
  const matrix = await prisma.brickPrice.findMany({ where: { active: true } });
  const type =
    (await prisma.constructionType.findFirst({ where: { name: { equals: "Compound", mode: "insensitive" } } })) ??
    (await prisma.constructionType.findFirst({ orderBy: { order: "asc" } }));
  if (!type) throw new Error("No construction type to bill against");

  // Last rate this customer actually paid for a size.
  const history = await prisma.orderItem.findMany({
    include: { order: true },
    orderBy: { order: { date: "desc" } },
  });
  const lastRate = new Map<string, number>();
  for (const i of history) {
    const key = `${i.order.clientId}:${i.brickSizeId}`;
    if (!lastRate.has(key) && i.pricePerBrick > 0) lastRate.set(key, i.pricePerBrick);
  }
  const matrixRate = new Map(
    matrix.map((m) => [`${m.brickSizeId}:${m.constructionTypeId}`, m.sellPrice])
  );

  const plan = groups.map((g) => {
    const own = g.brickSizeId ? lastRate.get(`${g.clientId}:${g.brickSizeId}`) : undefined;
    const mx = g.brickSizeId ? matrixRate.get(`${g.brickSizeId}:${type.id}`) : undefined;
    const rate = own ?? mx ?? 0;
    return { g, rate, source: own ? "customer's last rate" : mx ? "price matrix" : "none" };
  });

  const doable = plan.filter((x) => x.rate > 0 && x.g.brickSizeId);
  const skipped = plan.filter((x) => !(x.rate > 0 && x.g.brickSizeId));

  console.log("date        customer          bricks  size    rate   value      from");
  console.log("-".repeat(80));
  let total = 0;
  for (const x of doable) {
    const value = x.g.bricks * x.rate;
    total += value;
    console.log(
      `${x.g.date.toISOString().slice(0, 10)}  ${x.g.clientName.slice(0, 16).padEnd(16)} ` +
        `${String(x.g.bricks).padStart(6)}  ${x.g.sizeLabel.padEnd(6)} ${("Rs" + x.rate).padStart(6)} ` +
        `${("Rs" + Math.round(value)).padStart(9)}   ${x.source}`
    );
  }
  console.log(
    `
${doable.length} loads billable, worth Rs${Math.round(total).toLocaleString("en-IN")}.` +
      (skipped.length ? `  ${skipped.length} skipped (no size or no rate).` : "")
  );
  for (const x of skipped) {
    console.log(`  skipped: ${x.g.date.toISOString().slice(0, 10)} ${x.g.clientName} ${x.g.bricks} bricks`);
  }

  if (!APPLY) {
    console.log("\nNothing written. Add --apply to bill all of these.");
    return;
  }
  let done = 0;
  for (const x of doable) {
    await bill(x.g.loadGroupId, x.rate, type.name);
    done++;
  }
  console.log(`
Billed ${done} load(s).`);
}

async function main() {
  if (process.argv.includes("--all")) return billAll();
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
