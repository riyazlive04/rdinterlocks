"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";

const schema = z.object({
  date: z.string(),
  amount: z.number().positive(),
  direction: z.enum(["in", "out"]),
  category: z.string().min(1),
  title: z.string().min(1),
  notes: z.string().optional(),
  method: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
});

export async function createManualCashEntry(input: z.infer<typeof schema>) {
  const p = schema.parse(input);
  await prisma.cashEntry.create({
    data: {
      date: new Date(p.date),
      amount: p.amount,
      direction: p.direction,
      source: "manual",
      category: p.category,
      title: p.title,
      notes: p.notes,
      method: p.method,
    },
  });
  revalidatePath("/cash");
  revalidatePath("/");
  redirect("/cash");
}

export async function deleteCashEntry(id: string) {
  // Delete the cash entry AND its linked source record (client payment,
  // expense, advance, payout, tipper rent) so a wrongly double-entered row can
  // be fully removed without leaving an orphaned record. Manual entries have no
  // linked record, so only the cash row is removed.
  const entry = await prisma.cashEntry.findUnique({
    where: { id },
    include: {
      expense: true,
      tipperLoad: true,
      advance: true,
      clientPayment: true,
      employeePayout: true,
      workerPayout: true,
    },
  });
  if (!entry) return;

  await prisma.$transaction(async (tx) => {
    // Remove the source record first - it holds the cashEntryId foreign key.
    if (entry.expense) await tx.expense.delete({ where: { id: entry.expense.id } });
    if (entry.tipperLoad) await tx.tipperLoad.delete({ where: { id: entry.tipperLoad.id } });
    if (entry.advance) await tx.advance.delete({ where: { id: entry.advance.id } });
    if (entry.clientPayment) await tx.clientPayment.delete({ where: { id: entry.clientPayment.id } });
    if (entry.employeePayout) await tx.employeePayout.delete({ where: { id: entry.employeePayout.id } });
    if (entry.workerPayout) await tx.workerPayout.delete({ where: { id: entry.workerPayout.id } });
    await tx.cashEntry.delete({ where: { id } });
  });

  // Refresh everywhere the removed record may have shown up.
  revalidatePath("/cash");
  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/payroll");
  revalidatePath("/expense");
  revalidatePath("/tipper");
  revalidatePath("/employees");
}
