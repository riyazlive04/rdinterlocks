"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { categoryIdByName } from "@/lib/expense-category";

// Dies are numbered in the order they are bought: Die 1, Die 2, Die 3…
// The number is derived rather than typed so the sequence can't develop gaps
// or duplicates on a busy day.
async function nextCode() {
  const count = await prisma.die.count();
  return `Die ${count + 1}`;
}

const createSchema = z.object({
  purchasedAt: z.string(),
  cost: z.number().nonnegative().default(0),
  brickSizeId: z.string().optional(),
  vendorId: z.string().optional(),
  notes: z.string().optional(),
  method: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
});

/**
 * Buy a new die. Two things happen automatically:
 *  - side 1 is opened, because a new die always goes in on its first face
 *  - the purchase price is booked as an expense (with its cash entry) under
 *    "Mould (Die)", so the die cost lands in the books without a second entry
 */
export async function createDie(input: z.infer<typeof createSchema>) {
  const p = createSchema.parse(input);
  const date = new Date(p.purchasedAt);
  const code = await nextCode();

  let expenseId: string | null = null;
  if (p.cost > 0) {
    const entry = await prisma.cashEntry.create({
      data: {
        date,
        amount: p.cost,
        direction: "out",
        source: "expense",
        category: "Mould (Die)",
        title: `${code} - new die`,
        method: p.method,
        expense: {
          create: {
            date,
            categoryId: await categoryIdByName("Mould (Die)", 11),
            title: `${code} - new die`,
            amount: p.cost,
            vendorId: p.vendorId || null,
            notes: p.notes?.trim() || null,
          },
        },
      },
      include: { expense: true },
    });
    expenseId = entry.expense?.id ?? null;
  }

  await prisma.die.create({
    data: {
      code,
      brickSizeId: p.brickSizeId || null,
      vendorId: p.vendorId || null,
      cost: p.cost,
      purchasedAt: date,
      notes: p.notes?.trim() || null,
      expenseId,
      usages: { create: [{ side: 1, startedAt: date }] },
    },
  });

  revalidatePath("/die");
  revalidatePath("/expense");
  revalidatePath("/cash");
}

// Flip the die over: close side 1 and open side 2 on the same date. This is the
// "when they change it, that also should get recorded" step — no new purchase,
// no new expense, just the second face going into service.
export async function flipDie(dieId: string, dateStr: string) {
  const date = new Date(dateStr);
  const die = await prisma.die.findUnique({ where: { id: dieId }, include: { usages: true } });
  if (!die) throw new Error("Die not found");
  if (die.usages.some((u) => u.side === 2)) throw new Error("This die is already on side 2");

  const side1 = die.usages.find((u) => u.side === 1);
  if (side1 && !side1.endedAt) {
    await prisma.dieUsage.update({ where: { id: side1.id }, data: { endedAt: date } });
  }
  await prisma.dieUsage.create({ data: { dieId, side: 2, startedAt: date } });

  revalidatePath("/die");
}

// Side 2 is worn out too — the die is finished. Closing it is what makes the
// "dies used" count in the report meaningful.
export async function retireDie(dieId: string, dateStr: string) {
  const date = new Date(dateStr);
  const open = await prisma.dieUsage.findMany({ where: { dieId, endedAt: null } });
  for (const u of open) {
    await prisma.dieUsage.update({ where: { id: u.id }, data: { endedAt: date } });
  }
  revalidatePath("/die");
}

// Re-open the last closed side — the undo for a mis-tap.
export async function reopenDieSide(usageId: string) {
  await prisma.dieUsage.update({ where: { id: usageId }, data: { endedAt: null } });
  revalidatePath("/die");
}

export async function deleteDie(dieId: string) {
  const die = await prisma.die.findUnique({ where: { id: dieId } });
  if (!die) return;
  // Usages cascade with the die; the expense is removed with its cash entry so
  // deleting a mistaken die purchase doesn't leave money behind.
  await prisma.die.delete({ where: { id: dieId } });
  if (die.expenseId) {
    const expense = await prisma.expense.findUnique({ where: { id: die.expenseId } });
    if (expense) {
      await prisma.expense.delete({ where: { id: expense.id } });
      if (expense.cashEntryId) {
        await prisma.cashEntry.delete({ where: { id: expense.cashEntryId } });
      }
    }
  }
  revalidatePath("/die");
  revalidatePath("/expense");
  revalidatePath("/cash");
}
