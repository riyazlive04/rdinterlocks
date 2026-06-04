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
  // Only allow deleting manual entries — auto entries should be deleted via their source
  const entry = await prisma.cashEntry.findUnique({ where: { id } });
  if (!entry) return;
  if (entry.source !== "manual") {
    throw new Error(
      "This entry was created by a " +
        entry.source +
        " — delete it from that page to keep records consistent."
    );
  }
  await prisma.cashEntry.delete({ where: { id } });
  revalidatePath("/cash");
  revalidatePath("/");
}
