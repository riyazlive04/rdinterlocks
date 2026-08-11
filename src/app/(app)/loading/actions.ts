"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { distributeInt } from "@/lib/distribute";
import { categoryIdByName } from "@/lib/expense-category";
import { applyStockDeltas, recomputeOrderStatus, stockDeltasFor } from "@/lib/delivery-sync";

const workerType = z.enum(["loader", "operator", "employee"]);
const loadType = z.enum(["brick", "lintel"]);
const method = z.enum(["cash", "gpay", "bank", "upi", "cheque"]);

// Map the generic (workerType, workerId) onto the right FK column.
function workerData(type: "loader" | "operator" | "employee", id: string) {
  return {
    workerType: type,
    loaderId: type === "loader" ? id : null,
    operatorId: type === "operator" ? id : null,
    employeeId: type === "employee" ? id : null,
  };
}

// Extra products / services billed on the trip. direction "in" = we sold it to
// the customer (income); "out" = we bought it from a vendor (expense).
const chargeSchema = z.object({
  name: z.string().min(1),
  direction: z.enum(["in", "out"]).default("in"),
  quantity: z.number().positive().default(1),
  unit: z.string().default("unit"),
  amount: z.number().nonnegative(),
  vendorId: z.string().optional(),
});

// One trip can carry more than one brick size — 2,000 × 6" and 900 × 8" go on
// the same lorry. Each size is its own line so the office makes ONE entry and
// the reports still show 6" and 8" separately.
const itemSchema = z.object({
  brickSizeId: z.string().optional(), // blank = mixed / not tracked
  brickCount: z.number().int().positive(),
});

// Lintel beams ride on the same lorry as the bricks, so they are part of the
// same entry rather than a separate one — just their own count, paid at their
// own rate because a slab is nothing like a brick to lift.

// One physical load of bricks is recorded as a LOADING crew and an optional
// UNLOADING crew (different people / rate). Both crews split the SAME bricks,
// so bricks aren't double-counted (the list counts the loading phase only);
// each crew is paid separately. Every (phase × size × worker) becomes its own
// row, all sharing a loadGroupId so the tipper + charges attach to the load as
// a whole.
const crewSchema = z.object({
  workers: z.array(z.object({ type: workerType, id: z.string().min(1) })).min(1),
  ratePerBrick: z.number().nonnegative(),
  ratePerSlab: z.number().nonnegative().default(0),
});
const createSchema = z
  .object({
    date: z.string(),
    items: z.array(itemSchema).default([]),
    slabCount: z.number().int().nonnegative().default(0),
    clientId: z.string().optional(),
    // When the trip is against a customer's open order, the bricks that left
    // the yard are booked as a Delivery on it. Blank = wages only.
    orderId: z.string().optional(),
    // The other way round: no order exists yet (the telecaller only took the
    // customer's name and advance), so the manager types the agreed rate here
    // and the sale is created from the load itself.
    saleRate: z.number().nonnegative().default(0),
    constructionTypeId: z.string().optional(),
    // Money handed over at the lorry. Separate from any advance the telecaller
    // already took — that is attached automatically; this is new cash.
    payNow: z.number().nonnegative().default(0),
    payNowMethod: method.default("cash"),
    vehicleRequested: z.string().optional(),
    loading: crewSchema.optional(),
    unloading: crewSchema.optional(),
    // Transport: pick a tipper and what the trip is charged at. One amount —
    // see wireTipper() for how own vs rented turns it into entries.
    tipperId: z.string().optional(),
    tipperCharge: z.number().nonnegative().default(0),
    // Add-on charges (shifting, lintel beam, cement, custom).
    charges: z.array(chargeSchema).default([]),
    method: method.default("cash"),
  })
  .refine((d) => d.loading || d.unloading, {
    message: "Pick a loading crew, an unloading crew, or both",
  })
  .refine((d) => d.items.length > 0 || d.slabCount > 0, {
    message: "Add at least one brick size line or a slab count",
  });

type CreateInput = z.input<typeof createSchema>;
type CreateParsed = z.output<typeof createSchema>;

const totalBricks = (p: CreateParsed) => p.items.reduce((s, i) => s + i.brickCount, 0);

// ── Transport: one amount in, the right entries out ───────────────────────
//
// OWN (RD) tipper  → the customer pays us for the trip, so it is INCOME on the
//   tipper, AND the brick business books the same amount as a transport
//   EXPENSE against that tipper. The expense is internal — no second cash
//   movement — so the cash book still shows the one payment that really
//   happened while the Tipper P&L sees both sides.
//
// RENTED (vendor/AVM) tipper → EXPENSE only. It is recorded as a payable, not
//   as cash leaving: AVM is paid by advance and rent balance, which is entered
//   on the AVM page and is what moves cash. Booking it here as well would
//   count the same rupee twice.
async function wireTipper(
  p: CreateParsed,
  loadGroupId: string,
  date: Date,
  client: { name: string; location: string | null } | null
) {
  // A tipper that carried the load is recorded whether or not anything was
  // charged for it. An own truck doing a free run is still a trip that has to
  // show up against the customer and on the Tipper page; only the money side
  // is skipped when the charge is zero.
  if (!p.tipperId) return;
  const tipper = await prisma.tipper.findUnique({
    where: { id: p.tipperId },
    include: { vendor: true },
  });
  if (!tipper) return;

  const own = tipper.ownership === "own";
  const bricks = totalBricks(p);
  // The trip's quantity is the bricks; slabs are called out in the note so the
  // tipper row doesn't silently add slabs to a brick count.
  const sizeId = p.items[0]?.brickSizeId || null;
  const loadData = {
    date,
    loadGroupId,
    tipperId: tipper.id,
    vendorId: tipper.vendorId,
    loadType: bricks > 0 ? "bricks" : "material",
    brickSizeId: sizeId,
    materialName: bricks === 0 && p.slabCount > 0 ? "Lintel beams" : null,
    quantity: bricks > 0 ? bricks : p.slabCount,
    unit: "pcs",
    toLocation: client?.location ?? null,
    rentAmount: p.tipperCharge,
    rentDirection: own ? "in" : "out",
    notes:
      "Auto from loading entry" +
      (bricks > 0 && p.slabCount > 0 ? ` (+ ${p.slabCount} lintel beams)` : ""),
  };

  if (own && p.tipperCharge > 0) {
    // Income side — owns the cash entry for the money actually received.
    await prisma.cashEntry.create({
      data: {
        date,
        amount: p.tipperCharge,
        direction: "in",
        source: "tipper",
        category: "Tipper rent received",
        title: `${tipper.name}${client ? ` - ${client.name}` : ""} - shifting`,
        method: p.method,
        tipperLoad: { create: loadData },
      },
    });
  } else {
    // Free run, or a rented truck whose rent is a payable — the trip is
    // recorded on its own with no cash entry attached.
    await prisma.tipperLoad.create({ data: loadData });
  }

  if (p.tipperCharge <= 0) return;

  // Expense side — same amount, booked against the tipper.
  await prisma.expense.create({
    data: {
      date,
      categoryId: await categoryIdByName("Shifting charges"),
      title: `${tipper.name} - shifting${client ? ` - ${client.name}` : ""}`,
      amount: p.tipperCharge,
      tipperId: tipper.id,
      vendorId: own ? null : tipper.vendorId,
      loadGroupId,
      notes: own
        ? "Own RD tipper - internal transport charge (income booked on the tipper)"
        : `Rented tipper${tipper.vendor ? ` - payable to ${tipper.vendor.name}` : ""} - settle from Tipper Due`,
    },
  });
}

// Cash the manager collects when the lorry goes out. It is a client payment on
// the order, so it shows in the cash book, on the customer and in the balance —
// the same as taking the money on the client screen.
async function takePayment(
  p: CreateParsed,
  orderId: string,
  clientId: string,
  clientName: string,
  date: Date
) {
  if (p.payNow <= 0) return;
  await prisma.cashEntry.create({
    data: {
      date,
      amount: p.payNow,
      direction: "in",
      source: "sale",
      category: "Client payment",
      title: `${clientName} - paid on loading`,
      method: p.payNowMethod,
      clientPayment: {
        create: {
          clientId,
          orderId,
          date,
          amount: p.payNow,
          method: p.payNowMethod,
          notes: "Collected when the load went out",
        },
      },
    },
  });
}

// Create the sale from the load: an order for exactly what went out, at the
// rate the manager typed, already delivered. Any advance the telecaller took
// when they opened the customer is attached to it, so the balance is right the
// moment the entry is saved.
async function sellFromLoad(p: CreateParsed, loadGroupId: string, date: Date) {
  if (!p.clientId || p.saleRate <= 0) return;

  const type = p.constructionTypeId
    ? await prisma.constructionType.findUnique({ where: { id: p.constructionTypeId } })
    : await prisma.constructionType.findFirst({ orderBy: { order: "asc" } });
  if (!type) return;

  const items = p.items
    .filter((i) => i.brickSizeId)
    .map((i) => ({
      brickSizeId: i.brickSizeId!,
      constructionTypeId: type.id,
      quantity: i.brickCount,
      pricePerBrick: p.saleRate,
      total: i.brickCount * p.saleRate,
    }));
  if (items.length === 0) return;

  const value = items.reduce((s, i) => s + i.total, 0);

  const order = await prisma.order.create({
    data: {
      clientId: p.clientId,
      date,
      // Everything ordered went out on this trip, so it is complete already.
      status: "completed",
      notes: "Sold on the loading trip",
      items: { create: items },
      deliveries: {
        create: [
          {
            date,
            loadGroupId,
            notes: "Auto from loading entry",
            items: { create: items },
          },
        ],
      },
    },
  });

  await applyStockDeltas(stockDeltasFor(items, []));

  // Attach what the customer already paid — biggest first, only where it fits,
  // so a customer with several loads doesn't get everything on the first one.
  const unallocated = await prisma.clientPayment.findMany({
    where: { clientId: p.clientId, orderId: null },
  });
  let left = value;
  for (const pay of [...unallocated].sort((a, b) => b.amount - a.amount)) {
    if (left <= 0) break;
    if (pay.amount > left) continue;
    await prisma.clientPayment.update({ where: { id: pay.id }, data: { orderId: order.id } });
    left -= pay.amount;
  }

  const client = await prisma.client.findUnique({ where: { id: p.clientId } });
  await takePayment(p, order.id, p.clientId, client?.name ?? "Customer", date);
}

// ── The bricks that left the yard, booked against the customer's order ─────
//
// Loading used to record only who was paid. That left the order saying nothing
// had been delivered and the stock untouched, even though the lorry had gone.
// When the entry names an order, each brick size line becomes a DeliveryItem on
// it, priced from the matching order line so the customer's balance moves by
// the amount actually agreed.
//
// Slabs are deliberately left out: they are priced per slab on the order's slab
// lines, which DeliveryItem cannot represent. They still show as loaded and
// still earn wages.
async function wireDelivery(p: CreateParsed, loadGroupId: string, date: Date) {
  if (p.items.length === 0) return;
  // No order picked, but a rate was typed: the load itself is the sale. This is
  // the normal path here — a telecaller opens the customer with just a name and
  // an advance, and the price is only agreed when the lorry is loaded.
  if (!p.orderId) {
    await sellFromLoad(p, loadGroupId, date);
    return;
  }

  const order = await prisma.order.findUnique({
    where: { id: p.orderId },
    include: { items: true },
  });
  if (!order) return;
  // Guard against a mis-picked order on someone else's customer.
  if (p.clientId && order.clientId !== p.clientId) return;

  // Price each size from the order's own line for that size. A size that isn't
  // on the order (an extra the customer asked for on the day) falls back to the
  // price matrix, and finally to zero rather than being dropped.
  const priced = [];
  for (const item of p.items) {
    if (!item.brickSizeId) continue; // "mixed" can't be attributed to a line
    const line = order.items.find((i) => i.brickSizeId === item.brickSizeId);
    let constructionTypeId = line?.constructionTypeId ?? order.items[0]?.constructionTypeId;
    let pricePerBrick = line?.pricePerBrick ?? 0;
    if (!line && constructionTypeId) {
      const matrix = await prisma.brickPrice.findUnique({
        where: {
          brickSizeId_constructionTypeId: {
            brickSizeId: item.brickSizeId,
            constructionTypeId,
          },
        },
      });
      pricePerBrick = matrix?.sellPrice ?? 0;
    }
    if (!constructionTypeId) continue; // order has no lines to attribute against
    priced.push({
      brickSizeId: item.brickSizeId,
      constructionTypeId,
      quantity: item.brickCount,
      pricePerBrick,
      total: item.brickCount * pricePerBrick,
    });
  }
  if (priced.length === 0) return;

  await prisma.delivery.create({
    data: {
      orderId: order.id,
      date,
      loadGroupId,
      notes: "Auto from loading entry",
      items: { create: priced },
    },
  });

  // Same FIFO draw-down the client screen uses, so stock agrees either way.
  await applyStockDeltas(stockDeltasFor(priced, []));
  await recomputeOrderStatus(order.id);

  const client = await prisma.client.findUnique({ where: { id: order.clientId } });
  await takePayment(p, order.id, order.clientId, client?.name ?? "Customer", date);
}

// ── Auto-wiring: turn the tipper + charges on a load into Tipper loads,
// expenses and cash-book entries, all tagged with the load's group id. ──────
async function wireExtras(p: CreateParsed, loadGroupId: string, date: Date) {
  const client = p.clientId
    ? await prisma.client.findUnique({ where: { id: p.clientId } })
    : null;

  await wireTipper(p, loadGroupId, date, client);
  await wireDelivery(p, loadGroupId, date);

  // Every add-on charge (shifting, lintel beam, cement, custom) becomes real
  // money, both ways round:
  //
  //   sold to the customer  → cash IN, and it shows against them on the client
  //                           page as a loading charge
  //   bought from a vendor  → cash OUT **and an Expense row** under a category
  //                           named after the charge, so it appears in the
  //                           Expense screen and report and not only in the
  //                           cash book
  for (const c of p.charges) {
    if (c.amount <= 0) continue;
    const out = c.direction === "out";
    const vendor =
      out && c.vendorId ? await prisma.vendor.findUnique({ where: { id: c.vendorId } }) : null;
    const title = out
      ? `${c.name}${vendor ? ` - ${vendor.name}` : ""}`
      : `${c.name}${client ? ` - ${client.name}` : ""}`;

    await prisma.cashEntry.create({
      data: {
        date,
        amount: c.amount,
        direction: c.direction,
        source: out ? "expense" : "sale",
        category: c.name,
        title,
        method: p.method,
        loadingCharge: {
          create: {
            loadGroupId,
            date,
            clientId: p.clientId || null,
            name: c.name,
            direction: c.direction,
            quantity: c.quantity,
            unit: c.unit,
            amount: c.amount,
            vendorId: out ? c.vendorId || null : null,
          },
        },
        // The expense hangs off the same cash entry, so the rupee is counted
        // once and deleting the load takes both away together.
        ...(out
          ? {
              expense: {
                create: {
                  date,
                  categoryId: await categoryIdByName(c.name),
                  title,
                  amount: c.amount,
                  vendorId: c.vendorId || null,
                  loadGroupId,
                  notes: `${c.quantity} ${c.unit} - bought on a loading trip`,
                },
              },
            }
          : {}),
      },
    });
  }
}

export async function createLoadingWork(input: CreateInput) {
  const p = createSchema.parse(input);
  const date = new Date(p.date);
  const loadGroupId = randomUUID();

  // A crew is paid for everything it handled on the trip: a row per brick size
  // and, when the lorry also carried slabs, one more row at the slab rate. The
  // slab rows keep loadType "lintel" so reports can still tell them apart even
  // though they were entered together.
  const rowsFor = (crew: z.infer<typeof crewSchema>, phase: "loading" | "unloading") => {
    const common = {
      date,
      phase,
      loadGroupId,
      clientId: p.clientId || null,
      tipperId: p.tipperId || null,
      vehicleRequested: p.vehicleRequested?.trim() || null,
    };

    const brickRows = p.items.flatMap((item) => {
      const shares = distributeInt(item.brickCount, crew.workers.length);
      return crew.workers.map((w, i) =>
        prisma.loadingWork.create({
          data: {
            ...common,
            loadType: "brick",
            ...workerData(w.type, w.id),
            brickSizeId: item.brickSizeId || null,
            brickCount: shares[i],
            ratePerBrick: crew.ratePerBrick,
            totalAmount: shares[i] * crew.ratePerBrick,
          },
        })
      );
    });

    if (p.slabCount <= 0) return brickRows;

    const slabShares = distributeInt(p.slabCount, crew.workers.length);
    const slabRows = crew.workers.map((w, i) =>
      prisma.loadingWork.create({
        data: {
          ...common,
          loadType: "lintel",
          ...workerData(w.type, w.id),
          // A slab is not a brick size, so never attach one.
          brickSizeId: null,
          brickCount: slabShares[i],
          ratePerBrick: crew.ratePerSlab,
          totalAmount: slabShares[i] * crew.ratePerSlab,
        },
      })
    );
    return [...brickRows, ...slabRows];
  };

  const ops = [];
  if (p.loading) ops.push(...rowsFor(p.loading, "loading"));
  if (p.unloading) ops.push(...rowsFor(p.unloading, "unloading"));
  await prisma.$transaction(ops);

  // Tipper + charges → Tipper section, expenses, cash book, client history.
  await wireExtras(p, loadGroupId, date);

  revalidatePath("/loading");
  revalidatePath("/tipper");
  revalidatePath("/expense");
  revalidatePath("/cash");
  revalidatePath("/clients");
  revalidatePath("/deliveries");
  revalidatePath("/");
  redirect("/loading");
}

// Update edits a single existing row (one worker's salary + basics).
const updateSchema = z.object({
  date: z.string(),
  loadType: loadType.default("brick"),
  workerType: workerType.default("loader"),
  workerId: z.string().min(1),
  brickSizeId: z.string().optional(),
  brickCount: z.number().int().positive(),
  ratePerBrick: z.number().positive(),
});

export async function updateLoadingWork(id: string, input: z.infer<typeof updateSchema>) {
  const p = updateSchema.parse(input);
  await prisma.loadingWork.update({
    where: { id },
    data: {
      date: new Date(p.date),
      loadType: p.loadType,
      ...workerData(p.workerType, p.workerId),
      brickSizeId: p.loadType === "lintel" ? null : p.brickSizeId || null,
      brickCount: p.brickCount,
      ratePerBrick: p.ratePerBrick,
      totalAmount: p.brickCount * p.ratePerBrick,
    },
  });
  revalidatePath("/loading");
  redirect("/loading");
}

// Remove the tipper load(s), transport expense and add-on charges attached to a
// load group, along with their cash-book entries. Used when the last worker row
// of a group is deleted, or directly from the loading list.
async function deleteGroupExtras(loadGroupId: string) {
  // Deliveries first: removing one has to put the bricks back into stock and
  // re-open the order, exactly as deleting it from the client screen would.
  const deliveries = await prisma.delivery.findMany({
    where: { loadGroupId },
    include: { items: true, returns: true },
  });
  for (const d of deliveries) {
    await prisma.delivery.delete({ where: { id: d.id } });
    const restore = new Map<string, number>();
    for (const [sizeId, delta] of stockDeltasFor(d.items, d.returns)) {
      restore.set(sizeId, -delta);
    }
    await applyStockDeltas(restore);
    await recomputeOrderStatus(d.orderId);
  }

  const tipperLoads = await prisma.tipperLoad.findMany({ where: { loadGroupId } });
  for (const tl of tipperLoads) {
    await prisma.tipperLoad.delete({ where: { id: tl.id } });
    if (tl.cashEntryId) await prisma.cashEntry.delete({ where: { id: tl.cashEntryId } });
  }
  const expenses = await prisma.expense.findMany({ where: { loadGroupId } });
  for (const ex of expenses) {
    await prisma.expense.delete({ where: { id: ex.id } });
    if (ex.cashEntryId) await prisma.cashEntry.delete({ where: { id: ex.cashEntryId } });
  }
  const charges = await prisma.loadingCharge.findMany({ where: { loadGroupId } });
  for (const ch of charges) {
    await prisma.loadingCharge.delete({ where: { id: ch.id } });
    if (ch.cashEntryId) await prisma.cashEntry.delete({ where: { id: ch.cashEntryId } });
  }
}

export async function deleteLoadingWork(id: string) {
  const row = await prisma.loadingWork.findUnique({ where: { id } });
  if (!row) return;
  await prisma.loadingWork.delete({ where: { id } });
  // If this was the last worker row of its load, tear down the load's tipper +
  // charges too so nothing is orphaned in the accounts.
  if (row.loadGroupId) {
    const remaining = await prisma.loadingWork.count({
      where: { loadGroupId: row.loadGroupId },
    });
    if (remaining === 0) await deleteGroupExtras(row.loadGroupId);
  }
  revalidatePath("/loading");
  revalidatePath("/tipper");
  revalidatePath("/expense");
  revalidatePath("/cash");
  revalidatePath("/clients");
  revalidatePath("/deliveries");
  revalidatePath("/");
}

// Delete a single add-on charge (and its cash entry) — the "zero it out" path.
export async function deleteLoadingCharge(id: string) {
  const charge = await prisma.loadingCharge.findUnique({ where: { id } });
  if (!charge) return;
  await prisma.loadingCharge.delete({ where: { id } });
  if (charge.cashEntryId) await prisma.cashEntry.delete({ where: { id: charge.cashEntryId } });
  revalidatePath("/loading");
  revalidatePath("/cash");
  revalidatePath("/clients");
}
