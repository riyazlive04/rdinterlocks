"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { categoryIdByName } from "@/lib/expense-category";

// Money handed to a tipper vendor. Two kinds, and the difference matters:
//
//  advance — paid before the trips, against rent not yet charged
//  rent    — settling what is still owed afterwards (the office's "tipper due")
//
// Either way it is real cash going out, so each payment owns a cash entry AND
// an expense row. The rent the vendor CHARGES is booked separately when the
// loading entry is saved, without cash, so nothing is counted twice.
const schema = z.object({
  vendorId: z.string().min(1, "Pick the vendor"),
  tipperId: z.string().optional(),
  date: z.string(),
  kind: z.enum(["advance", "rent"]).default("advance"),
  amount: z.number().positive("Enter an amount"),
  method: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
  notes: z.string().optional(),
});

export type VendorPaymentInput = z.input<typeof schema>;

export async function createVendorPayment(input: VendorPaymentInput) {
  const p = schema.parse(input);
  const vendor = await prisma.vendor.findUnique({ where: { id: p.vendorId } });
  if (!vendor) throw new Error("Vendor not found");
  const date = new Date(p.date);

  const label = p.kind === "advance" ? "Advance" : "Tipper Due";
  const title = `${vendor.name} - ${p.kind === "advance" ? "advance" : "rent balance"}`;

  await prisma.cashEntry.create({
    data: {
      date,
      amount: p.amount,
      direction: "out",
      source: "tipper",
      category: label,
      title,
      method: p.method,
      notes: p.notes?.trim() || null,
      expense: {
        create: {
          date,
          categoryId: await categoryIdByName(p.kind === "advance" ? "Advance" : "Tipper Due"),
          title,
          amount: p.amount,
          vendorId: vendor.id,
          tipperId: p.tipperId || null,
          notes: p.notes?.trim() || null,
        },
      },
      vendorPayment: {
        create: {
          date,
          vendorId: vendor.id,
          tipperId: p.tipperId || null,
          kind: p.kind,
          amount: p.amount,
          method: p.method,
          notes: p.notes?.trim() || null,
        },
      },
    },
  });

  revalidatePath("/avm");
  revalidatePath("/tipper");
  revalidatePath("/expense");
  revalidatePath("/cash");
}

export async function deleteVendorPayment(id: string) {
  const payment = await prisma.vendorPayment.findUnique({ where: { id } });
  if (!payment) return;
  await prisma.vendorPayment.delete({ where: { id } });
  if (payment.cashEntryId) {
    // The expense hangs off the same cash entry — take both down together.
    const expense = await prisma.expense.findUnique({
      where: { cashEntryId: payment.cashEntryId },
    });
    if (expense) await prisma.expense.delete({ where: { id: expense.id } });
    await prisma.cashEntry.delete({ where: { id: payment.cashEntryId } });
  }
  revalidatePath("/avm");
  revalidatePath("/expense");
  revalidatePath("/cash");
}
