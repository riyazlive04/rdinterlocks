"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";

const schema = z.object({
  date: z.string(),
  loaderId: z.string().min(1),
  brickSizeId: z.string().optional(),
  brickCount: z.number().int().positive(),
  ratePerBrick: z.number().positive(),
});

export async function createLoadingWork(input: z.infer<typeof schema>) {
  const p = schema.parse(input);
  await prisma.loadingWork.create({
    data: {
      date: new Date(p.date),
      loaderId: p.loaderId,
      brickSizeId: p.brickSizeId || null,
      brickCount: p.brickCount,
      ratePerBrick: p.ratePerBrick,
      totalAmount: p.brickCount * p.ratePerBrick,
    },
  });
  revalidatePath("/loading");
  redirect("/loading");
}

export async function deleteLoadingWork(id: string) {
  await prisma.loadingWork.delete({ where: { id } });
  revalidatePath("/loading");
}
