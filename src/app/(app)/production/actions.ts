"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { startOfDay } from "@/lib/format";
import { distributeInt } from "@/lib/distribute";

const schema = z.object({
  date: z.string(),
  shift: z.enum(["day", "night"]).default("day"),
  machineId: z.string().optional(),
  brickSizeId: z.string().min(1),
  brickCount: z.number().int().positive(),
  damagedCount: z.number().int().nonnegative().default(0),
  cementBagsUsed: z.number().nonnegative(),
  ratePerBrick: z.number().positive(),
  operatorIds: z.array(z.string().min(1)).min(1),
  notes: z.string().optional(),
});

export async function createProduction(input: z.infer<typeof schema>) {
  const p = schema.parse(input);
  const date = startOfDay(new Date(p.date));
  const totalWage = Math.round(p.brickCount * p.ratePerBrick);
  // Distribute production count and wage so totals match exactly even when
  // they don't divide evenly (e.g. 1000 / 3 → 334, 333, 333).
  const brickShares = distributeInt(p.brickCount, p.operatorIds.length);
  const wageShares = distributeInt(totalWage, p.operatorIds.length);

  const last = await prisma.stockBatch.findFirst({
    orderBy: { code: "desc" },
    where: { code: { startsWith: "B-" } },
  });
  const lastN = last ? parseInt(last.code.replace("B-", ""), 10) || 0 : 0;
  const code = `B-${String(lastN + 1).padStart(3, "0")}`;

  const entry = await prisma.productionEntry.create({
    data: {
      date,
      shift: p.shift,
      machineId: p.machineId || null,
      brickSizeId: p.brickSizeId,
      cementBagsUsed: p.cementBagsUsed,
      brickCount: p.brickCount,
      damagedCount: p.damagedCount,
      ratePerBrick: p.ratePerBrick,
      totalWage,
      notes: p.notes,
      shares: {
        create: p.operatorIds.map((id, i) => ({
          operatorId: id,
          brickCount: brickShares[i],
          amount: wageShares[i],
        })),
      },
      batch: {
        create: {
          code,
          brickSizeId: p.brickSizeId,
          count: p.brickCount,
          remaining: p.brickCount,
          stage: "produced",
        },
      },
    },
  });

  // Auto-decrement raw material stock based on recipe
  const recipes = await prisma.materialRecipe.findMany({
    where: { brickSizeId: p.brickSizeId },
  });
  for (const r of recipes) {
    const consumed = (p.brickCount / 1000) * r.qtyPer1000;
    await prisma.materialStock.upsert({
      where: { materialId: r.materialId },
      update: { quantity: { decrement: consumed } },
      create: { materialId: r.materialId, quantity: -consumed, reorderAt: 0 },
    });
  }

  revalidatePath("/production");
  revalidatePath("/");
  redirect(`/production?created=${entry.id}`);
}

export async function updateProduction(id: string, input: z.infer<typeof schema>) {
  const p = schema.parse(input);
  const date = startOfDay(new Date(p.date));
  const totalWage = Math.round(p.brickCount * p.ratePerBrick);
  const brickShares = distributeInt(p.brickCount, p.operatorIds.length);
  const wageShares = distributeInt(totalWage, p.operatorIds.length);

  const existing = await prisma.productionEntry.findUnique({
    where: { id },
    include: { batch: true },
  });
  if (!existing) throw new Error("Production entry not found");

  // Reverse the old material consumption, then apply the new one, so raw
  // material stock stays consistent after an edit.
  const oldRecipes = await prisma.materialRecipe.findMany({
    where: { brickSizeId: existing.brickSizeId },
  });
  for (const r of oldRecipes) {
    const consumed = (existing.brickCount / 1000) * r.qtyPer1000;
    await prisma.materialStock.upsert({
      where: { materialId: r.materialId },
      update: { quantity: { increment: consumed } },
      create: { materialId: r.materialId, quantity: consumed, reorderAt: 0 },
    });
  }
  const newRecipes = await prisma.materialRecipe.findMany({
    where: { brickSizeId: p.brickSizeId },
  });
  for (const r of newRecipes) {
    const consumed = (p.brickCount / 1000) * r.qtyPer1000;
    await prisma.materialStock.upsert({
      where: { materialId: r.materialId },
      update: { quantity: { decrement: consumed } },
      create: { materialId: r.materialId, quantity: -consumed, reorderAt: 0 },
    });
  }

  // Adjust the stock batch: keep already-dispatched/consumed amounts intact by
  // shifting `remaining` by the production-count delta (clamped at 0).
  const delta = p.brickCount - existing.brickCount;
  const newRemaining = existing.batch
    ? Math.max(0, existing.batch.remaining + delta)
    : p.brickCount;

  await prisma.$transaction([
    prisma.productionShare.deleteMany({ where: { productionEntryId: id } }),
    prisma.productionEntry.update({
      where: { id },
      data: {
        date,
        shift: p.shift,
        machineId: p.machineId || null,
        brickSizeId: p.brickSizeId,
        cementBagsUsed: p.cementBagsUsed,
        brickCount: p.brickCount,
        damagedCount: p.damagedCount,
        ratePerBrick: p.ratePerBrick,
        totalWage,
        notes: p.notes,
        shares: {
          create: p.operatorIds.map((opId, i) => ({
            operatorId: opId,
            brickCount: brickShares[i],
            amount: wageShares[i],
          })),
        },
      },
    }),
    ...(existing.batch
      ? [
          prisma.stockBatch.update({
            where: { id: existing.batch.id },
            data: {
              brickSizeId: p.brickSizeId,
              count: p.brickCount,
              remaining: newRemaining,
            },
          }),
        ]
      : []),
  ]);

  revalidatePath("/production");
  revalidatePath("/");
  redirect(`/production?updated=${id}`);
}

// Streamlined "day sheet": one date / shift / machine / operator set, with
// many brick-size rows. Each row becomes a normal production entry (its own
// stock batch + wage split + material decrement), so it's fully compatible
// with the existing per-entry flow.
const dailySchema = z.object({
  date: z.string(),
  shift: z.enum(["day", "night"]).default("day"),
  machineId: z.string().optional(),
  operatorIds: z.array(z.string().min(1)).min(1),
  rows: z
    .array(
      z.object({
        brickSizeId: z.string().min(1),
        brickCount: z.number().int().positive(),
        ratePerBrick: z.number().positive(),
        cementBagsUsed: z.number().nonnegative().default(0),
        damagedCount: z.number().int().nonnegative().default(0),
      })
    )
    .min(1),
});

export async function createDailyProduction(input: z.infer<typeof dailySchema>) {
  const p = dailySchema.parse(input);
  const date = startOfDay(new Date(p.date));

  const last = await prisma.stockBatch.findFirst({
    orderBy: { code: "desc" },
    where: { code: { startsWith: "B-" } },
  });
  let n = last ? parseInt(last.code.replace("B-", ""), 10) || 0 : 0;

  for (const row of p.rows) {
    n += 1;
    const code = `B-${String(n).padStart(3, "0")}`;
    const totalWage = Math.round(row.brickCount * row.ratePerBrick);
    const brickShares = distributeInt(row.brickCount, p.operatorIds.length);
    const wageShares = distributeInt(totalWage, p.operatorIds.length);

    await prisma.productionEntry.create({
      data: {
        date,
        shift: p.shift,
        machineId: p.machineId || null,
        brickSizeId: row.brickSizeId,
        cementBagsUsed: row.cementBagsUsed,
        brickCount: row.brickCount,
        damagedCount: row.damagedCount,
        ratePerBrick: row.ratePerBrick,
        totalWage,
        shares: {
          create: p.operatorIds.map((id, i) => ({
            operatorId: id,
            brickCount: brickShares[i],
            amount: wageShares[i],
          })),
        },
        batch: {
          create: {
            code,
            brickSizeId: row.brickSizeId,
            count: row.brickCount,
            remaining: row.brickCount,
            stage: "produced",
          },
        },
      },
    });

    const recipes = await prisma.materialRecipe.findMany({
      where: { brickSizeId: row.brickSizeId },
    });
    for (const r of recipes) {
      const consumed = (row.brickCount / 1000) * r.qtyPer1000;
      await prisma.materialStock.upsert({
        where: { materialId: r.materialId },
        update: { quantity: { decrement: consumed } },
        create: { materialId: r.materialId, quantity: -consumed, reorderAt: 0 },
      });
    }
  }

  revalidatePath("/production");
  revalidatePath("/");
  redirect("/production");
}

export async function deleteProduction(id: string) {
  await prisma.$transaction([
    prisma.stockBatch.deleteMany({ where: { productionEntryId: id } }),
    prisma.productionShare.deleteMany({ where: { productionEntryId: id } }),
    prisma.productionEntry.delete({ where: { id } }),
  ]);
  revalidatePath("/production");
  revalidatePath("/");
}

export async function advanceBatch(id: string) {
  const order = ["produced", "drying", "curing", "ready", "dispatched"] as const;
  const b = await prisma.stockBatch.findUnique({ where: { id } });
  if (!b) throw new Error("Batch not found");
  const i = order.indexOf(b.stage as (typeof order)[number]);
  if (i < 0 || i >= order.length - 1) return;
  await prisma.stockBatch.update({
    where: { id },
    data: { stage: order[i + 1], stageChangedAt: new Date() },
  });
  revalidatePath("/production");
  revalidatePath("/");
}
