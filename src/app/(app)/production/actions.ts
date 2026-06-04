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
