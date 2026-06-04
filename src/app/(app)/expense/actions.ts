"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";

const schema = z.object({
  date: z.string(),
  categoryId: z.string().min(1),
  title: z.string().min(1),
  amount: z.number().positive(),
  notes: z.string().optional(),
  vendorId: z.string().optional(),
  tipperId: z.string().optional(),
  method: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
});

export async function createExpense(input: z.infer<typeof schema>) {
  const p = schema.parse(input);
  const date = new Date(p.date);
  const cat = await prisma.expenseCategory.findUnique({ where: { id: p.categoryId } });
  if (!cat) throw new Error("Category not found");

  await prisma.cashEntry.create({
    data: {
      date,
      amount: p.amount,
      direction: "out",
      source: "expense",
      category: cat.name,
      title: p.title,
      notes: p.notes,
      method: p.method,
      expense: {
        create: {
          date,
          categoryId: p.categoryId,
          title: p.title,
          amount: p.amount,
          notes: p.notes,
          vendorId: p.vendorId || null,
          tipperId: p.tipperId || null,
        },
      },
    },
  });

  revalidatePath("/expense");
  revalidatePath("/cash");
  revalidatePath("/");
  redirect("/expense");
}

export async function deleteExpense(id: string) {
  const exp = await prisma.expense.findUnique({ where: { id } });
  if (!exp) return;
  await prisma.$transaction([
    prisma.expense.delete({ where: { id } }),
    ...(exp.cashEntryId ? [prisma.cashEntry.delete({ where: { id: exp.cashEntryId } })] : []),
  ]);
  revalidatePath("/expense");
  revalidatePath("/cash");
  revalidatePath("/");
}
