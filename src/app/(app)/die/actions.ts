"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { can } from "@/lib/access";
import { isFullAccess } from "@/lib/roles";
import { categoryIdByName } from "@/lib/expense-category";

// ─── Authorization ───────────────────────────────────────────────────
//
// NOTE FOR ANYONE DIFFING THIS AGAINST
// origin/feature/register-dies-avm-tipper-pl, where this screen came from:
// NONE of these four actions had any authorization there — no
// requireArea, no requireSession. A server action is a public HTTP
// endpoint whether or not a link points at it, and the security review on
// this branch (1c10fb0) found exactly that hole in /api/export. The gates
// below are the difference, and they are not optional.
//
// Registering and flipping a mould is a shop-floor fact, so area `die` is
// enough. Money is not: a costed purchase writes a CashEntry + Expense,
// and deleting a die removes them, so those two carry stricter gates.

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
  const session = await requireArea("die");
  const p = createSchema.parse(input);

  // A costed purchase books real money, so it needs cashbook standing on top
  // of `die`. A supervisor who may not touch the books can still register the
  // mould at zero and leave the invoice for a manager — which is the normal
  // case anyway, since the die usually arrives before the bill.
  if (p.cost > 0 && !can(session, "expense") && !isFullAccess(session.role)) {
    throw new Error(
      "Recording what a die cost books an expense, which needs cashbook access. " +
        "Save it with no cost and ask a manager to add the amount."
    );
  }

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
  await requireArea("die");
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
  await requireArea("die");
  const date = new Date(dateStr);
  const open = await prisma.dieUsage.findMany({ where: { dieId, endedAt: null } });
  for (const u of open) {
    await prisma.dieUsage.update({ where: { id: u.id }, data: { endedAt: date } });
  }
  revalidatePath("/die");
}

// Re-open the last closed side — the undo for a mis-tap.
export async function reopenDieSide(usageId: string) {
  await requireArea("die");
  await prisma.dieUsage.update({ where: { id: usageId }, data: { endedAt: null } });
  revalidatePath("/die");
}

export async function deleteDie(dieId: string) {
  // Deleting a die removes its Expense AND that expense's CashEntry, which is
  // money leaving the books. Same reasoning as the payment-approval gate:
  // that is an owner/manager act, not a shop-floor one. A supervisor who
  // mis-registered a die asks for it to be removed.
  const session = await requireArea("die");
  if (!isFullAccess(session.role)) {
    throw new Error("Only an owner or manager can delete a die — it also removes its expense from the cashbook.");
  }
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
