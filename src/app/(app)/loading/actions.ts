"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { distributeInt } from "@/lib/distribute";
import { categoryIdByName } from "@/lib/expense-category";

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

// One physical load of bricks is recorded as a LOADING crew and an optional
// UNLOADING crew (different people / rate). Both crews split the SAME bricks,
// so bricks aren't double-counted (the list counts the loading phase only);
// each crew is paid separately. Every (phase × size × worker) becomes its own
// row, all sharing a loadGroupId so the tipper + charges attach to the load as
// a whole.
const crewSchema = z.object({
  workers: z.array(z.object({ type: workerType, id: z.string().min(1) })).min(1),
  ratePerBrick: z.number().positive(),
});
const createSchema = z
  .object({
    date: z.string(),
    loadType: loadType.default("brick"),
    items: z.array(itemSchema).min(1),
    clientId: z.string().optional(),
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
  if (!p.tipperId || p.tipperCharge <= 0) return;
  const tipper = await prisma.tipper.findUnique({
    where: { id: p.tipperId },
    include: { vendor: true },
  });
  if (!tipper) return;

  const own = tipper.ownership === "own";
  const qty = totalBricks(p);
  const sizeId = p.loadType === "lintel" ? null : p.items[0]?.brickSizeId || null;
  const loadData = {
    date,
    loadGroupId,
    tipperId: tipper.id,
    vendorId: tipper.vendorId,
    loadType: "bricks",
    brickSizeId: sizeId,
    quantity: qty,
    unit: "pcs",
    toLocation: client?.location ?? null,
    rentAmount: p.tipperCharge,
    rentDirection: own ? "in" : "out",
    notes: "Auto from loading entry",
  };

  if (own) {
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
    await prisma.tipperLoad.create({ data: loadData });
  }

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

// ── Auto-wiring: turn the tipper + charges on a load into Tipper loads,
// expenses and cash-book entries, all tagged with the load's group id. ──────
async function wireExtras(p: CreateParsed, loadGroupId: string, date: Date) {
  const client = p.clientId
    ? await prisma.client.findUnique({ where: { id: p.clientId } })
    : null;

  await wireTipper(p, loadGroupId, date, client);

  // Each add-on charge → its own cash entry (income or expense).
  for (const c of p.charges) {
    if (c.amount <= 0) continue;
    const vendor =
      c.direction === "out" && c.vendorId
        ? await prisma.vendor.findUnique({ where: { id: c.vendorId } })
        : null;
    await prisma.cashEntry.create({
      data: {
        date,
        amount: c.amount,
        direction: c.direction,
        source: c.direction === "in" ? "sale" : "expense",
        category: c.name,
        title:
          c.direction === "in"
            ? `${c.name}${client ? ` - ${client.name}` : ""}`
            : `${c.name}${vendor ? ` - ${vendor.name}` : ""}`,
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
            vendorId: c.direction === "out" ? c.vendorId || null : null,
          },
        },
      },
    });
  }
}

export async function createLoadingWork(input: CreateInput) {
  const p = createSchema.parse(input);
  const date = new Date(p.date);
  const loadGroupId = randomUUID();

  const rowsFor = (crew: z.infer<typeof crewSchema>, phase: "loading" | "unloading") =>
    p.items.flatMap((item) => {
      const shares = distributeInt(item.brickCount, crew.workers.length);
      return crew.workers.map((w, i) =>
        prisma.loadingWork.create({
          data: {
            date,
            phase,
            loadType: p.loadType,
            loadGroupId,
            ...workerData(w.type, w.id),
            // Lintel slabs aren't a brick size, so never attach one.
            brickSizeId: p.loadType === "lintel" ? null : item.brickSizeId || null,
            clientId: p.clientId || null,
            tipperId: p.tipperId || null,
            vehicleRequested: p.vehicleRequested?.trim() || null,
            brickCount: shares[i],
            ratePerBrick: crew.ratePerBrick,
            totalAmount: shares[i] * crew.ratePerBrick,
          },
        })
      );
    });

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
