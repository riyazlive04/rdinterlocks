"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";

const schema = z.object({
  date: z.string(),
  tipperId: z.string().min(1),
  loadType: z.enum(["bricks", "material"]),
  brickSizeId: z.string().optional(),
  materialName: z.string().optional(),
  quantity: z.number().positive(),
  unit: z.string().default("pcs"),
  fromLocation: z.string().optional(),
  toLocation: z.string().optional(),
  rentAmount: z.number().nonnegative(),
  rentDirection: z.enum(["in", "out"]),
  // Bricks carried back on this trip. Only meaningful on a brick load, since
  // we need the size to put them back into stock.
  returnBricks: z.number().int().nonnegative().default(0),
  notes: z.string().optional(),
  method: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
});

type Input = z.infer<typeof schema>;

// Return batches are numbered R-001, R-002… so they never collide with the
// production series (B-001…).
async function nextReturnCode() {
  const last = await prisma.stockBatch.findFirst({
    orderBy: { code: "desc" },
    where: { code: { startsWith: "R-" } },
    select: { code: true },
  });
  const n = last ? parseInt(last.code.replace("R-", ""), 10) || 0 : 0;
  return `R-${String(n + 1).padStart(3, "0")}`;
}

// Returned bricks are already cured, so the batch is created as READY and
// marked source="return" — the stock view treats those as sellable at once
// instead of ageing them from producedAt.
async function createReturnBatch(brickSizeId: string, count: number, date: Date) {
  return prisma.stockBatch.create({
    data: {
      code: await nextReturnCode(),
      brickSizeId,
      count,
      remaining: count,
      stage: "ready",
      source: "return",
      producedAt: date,
      stageChangedAt: date,
    },
  });
}

// A return only makes sense when we know which size came back.
function returnableSize(p: Input) {
  return p.loadType === "bricks" && p.returnBricks > 0 ? p.brickSizeId || null : null;
}

export async function createTipperLoad(input: Input) {
  const p = schema.parse(input);
  const date = new Date(p.date);

  const tipper = await prisma.tipper.findUnique({ where: { id: p.tipperId } });
  if (!tipper) throw new Error("Tipper not found");

  const sizeId = returnableSize(p);
  const batch = sizeId ? await createReturnBatch(sizeId, p.returnBricks, date) : null;

  const loadData = {
    date,
    tipperId: p.tipperId,
    vendorId: tipper.vendorId,
    loadType: p.loadType,
    brickSizeId: p.brickSizeId || null,
    materialName: p.materialName || null,
    quantity: p.quantity,
    unit: p.unit,
    fromLocation: p.fromLocation || null,
    toLocation: p.toLocation || null,
    rentDirection: p.rentDirection,
    returnBricks: sizeId ? p.returnBricks : 0,
    returnBatchId: batch?.id ?? null,
    notes: p.notes,
  };

  if (p.rentAmount > 0) {
    await prisma.cashEntry.create({
      data: {
        date,
        amount: p.rentAmount,
        direction: p.rentDirection,
        source: "tipper",
        category: p.rentDirection === "in" ? "Tipper rent received" : "Tipper rent paid",
        title: `${tipper.name} - ${p.toLocation ?? "load"}`,
        notes: p.notes,
        method: p.method,
        tipperLoad: { create: { ...loadData, rentAmount: p.rentAmount } },
      },
    });
  } else {
    await prisma.tipperLoad.create({ data: { ...loadData, rentAmount: 0 } });
  }

  revalidatePath("/tipper");
  revalidatePath("/cash");
  revalidatePath("/production");
  revalidatePath("/");
  redirect("/tipper");
}

// Edit an existing load. Keeps the linked cash entry and the linked return
// stock batch in step with whatever changed.
export async function updateTipperLoad(id: string, input: Input) {
  const p = schema.parse(input);
  const date = new Date(p.date);

  const existing = await prisma.tipperLoad.findUnique({
    where: { id },
    include: { returnBatch: true },
  });
  if (!existing) throw new Error("Tipper load not found");
  const tipper = await prisma.tipper.findUnique({ where: { id: p.tipperId } });
  if (!tipper) throw new Error("Tipper not found");

  // ── Return batch: create, adjust, or drop ──
  const sizeId = returnableSize(p);
  let returnBatchId = existing.returnBatchId;

  if (sizeId && existing.returnBatch) {
    // Shift `remaining` by the delta so any already-dispatched returns survive
    // the edit (same approach production uses when a count is corrected).
    const delta = p.returnBricks - existing.returnBatch.count;
    await prisma.stockBatch.update({
      where: { id: existing.returnBatch.id },
      data: {
        brickSizeId: sizeId,
        count: p.returnBricks,
        remaining: Math.max(0, existing.returnBatch.remaining + delta),
        producedAt: date,
      },
    });
  } else if (sizeId && !existing.returnBatch) {
    const batch = await createReturnBatch(sizeId, p.returnBricks, date);
    returnBatchId = batch.id;
  } else if (!sizeId && existing.returnBatch) {
    // Unlink first — the FK lives on the load.
    await prisma.tipperLoad.update({ where: { id }, data: { returnBatchId: null } });
    await prisma.stockBatch.delete({ where: { id: existing.returnBatch.id } });
    returnBatchId = null;
  }

  // ── Cash entry: create, update, or drop ──
  let cashEntryId = existing.cashEntryId;
  const cashData = {
    date,
    amount: p.rentAmount,
    direction: p.rentDirection,
    source: "tipper",
    category: p.rentDirection === "in" ? "Tipper rent received" : "Tipper rent paid",
    title: `${tipper.name} - ${p.toLocation ?? "load"}`,
    notes: p.notes,
    method: p.method,
  };

  if (p.rentAmount > 0 && existing.cashEntryId) {
    await prisma.cashEntry.update({ where: { id: existing.cashEntryId }, data: cashData });
  } else if (p.rentAmount > 0 && !existing.cashEntryId) {
    const entry = await prisma.cashEntry.create({ data: cashData });
    cashEntryId = entry.id;
  } else if (p.rentAmount === 0 && existing.cashEntryId) {
    await prisma.tipperLoad.update({ where: { id }, data: { cashEntryId: null } });
    await prisma.cashEntry.delete({ where: { id: existing.cashEntryId } });
    cashEntryId = null;
  }

  await prisma.tipperLoad.update({
    where: { id },
    data: {
      date,
      tipperId: p.tipperId,
      vendorId: tipper.vendorId,
      loadType: p.loadType,
      brickSizeId: p.brickSizeId || null,
      materialName: p.materialName || null,
      quantity: p.quantity,
      unit: p.unit,
      fromLocation: p.fromLocation || null,
      toLocation: p.toLocation || null,
      rentAmount: p.rentAmount,
      rentDirection: p.rentDirection,
      returnBricks: sizeId ? p.returnBricks : 0,
      returnBatchId,
      cashEntryId,
      notes: p.notes,
    },
  });

  revalidatePath("/tipper");
  revalidatePath("/cash");
  revalidatePath("/production");
  revalidatePath("/");
  redirect("/tipper");
}

export async function deleteTipperLoad(id: string) {
  const load = await prisma.tipperLoad.findUnique({ where: { id } });
  if (!load) return;
  // Delete the load first; it owns the FKs to the cash entry and return batch.
  await prisma.$transaction([
    prisma.tipperLoad.delete({ where: { id } }),
    ...(load.cashEntryId ? [prisma.cashEntry.delete({ where: { id: load.cashEntryId } })] : []),
    ...(load.returnBatchId
      ? [prisma.stockBatch.delete({ where: { id: load.returnBatchId } })]
      : []),
  ]);
  revalidatePath("/tipper");
  revalidatePath("/cash");
  revalidatePath("/production");
  revalidatePath("/");
}
