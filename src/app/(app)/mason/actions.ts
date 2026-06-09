"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";

const workSchema = z.object({
  date: z.string(),
  masonId: z.string().min(1),
  siteName: z.string().min(1),
  brickSizeId: z.string().min(1),
  constructionTypeId: z.string().min(1),
  brickCount: z.number().int().positive(),
  ratePerBrick: z.number().positive(),
});

export async function createMasonWork(input: z.infer<typeof workSchema>) {
  const p = workSchema.parse(input);
  const total = p.brickCount * p.ratePerBrick;
  await prisma.masonWork.create({
    data: {
      date: new Date(p.date),
      masonId: p.masonId,
      siteName: p.siteName,
      brickSizeId: p.brickSizeId,
      constructionTypeId: p.constructionTypeId,
      brickCount: p.brickCount,
      ratePerBrick: p.ratePerBrick,
      totalAmount: total,
    },
  });
  revalidatePath("/mason");
  redirect("/mason");
}

export async function updateMasonWork(id: string, input: z.infer<typeof workSchema>) {
  const p = workSchema.parse(input);
  await prisma.masonWork.update({
    where: { id },
    data: {
      date: new Date(p.date),
      masonId: p.masonId,
      siteName: p.siteName,
      brickSizeId: p.brickSizeId,
      constructionTypeId: p.constructionTypeId,
      brickCount: p.brickCount,
      ratePerBrick: p.ratePerBrick,
      totalAmount: p.brickCount * p.ratePerBrick,
    },
  });
  revalidatePath("/mason");
  redirect("/mason");
}

export async function deleteMasonWork(id: string) {
  await prisma.masonWork.delete({ where: { id } });
  revalidatePath("/mason");
}

const advanceSchema = z.object({
  date: z.string(),
  masonId: z.string().min(1),
  amount: z.number().positive(),
  notes: z.string().optional(),
  method: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
});

export async function giveMasonAdvance(input: z.infer<typeof advanceSchema>) {
  const p = advanceSchema.parse(input);
  const mason = await prisma.mason.findUnique({ where: { id: p.masonId } });
  if (!mason) throw new Error("Mason not found");
  await prisma.cashEntry.create({
    data: {
      date: new Date(p.date),
      amount: p.amount,
      direction: "out",
      source: "advance",
      category: "Mason advance",
      title: `${mason.name} - advance`,
      notes: p.notes,
      method: p.method,
      advance: {
        create: {
          date: new Date(p.date),
          personType: "mason",
          masonId: p.masonId,
          amount: p.amount,
          notes: p.notes,
        },
      },
    },
  });
  revalidatePath("/mason");
  revalidatePath("/cash");
}
