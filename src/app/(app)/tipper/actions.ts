"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";

const schema = z.object({
  date: z.string(),
  tipperId: z.string().min(1),
  loadType: z.enum(["bricks", "material"]),
  brickSizeId: z.string().optional(),
  materialName: z.string().optional(),
  quantity: z.number().positive(),
  unit: z.string().default("pcs"),
  fromLocation: z.string().optional(),
  toLocation: z.string().optional(),
  rentAmount: z.number().nonnegative(),
  rentDirection: z.enum(["in", "out"]),
  notes: z.string().optional(),
  method: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
});

export async function createTipperLoad(input: z.infer<typeof schema>) {
  const p = schema.parse(input);
  const date = new Date(p.date);

  const tipper = await prisma.tipper.findUnique({
    where: { id: p.tipperId },
  });
  if (!tipper) throw new Error("Tipper not found");

  if (p.rentAmount > 0) {
    await prisma.cashEntry.create({
      data: {
        date,
        amount: p.rentAmount,
        direction: p.rentDirection,
        source: "tipper",
        category: p.rentDirection === "in" ? "Tipper rent received" : "Tipper rent paid",
        title: `${tipper.name} - ${p.toLocation ?? "load"}`,
        notes: p.notes,
        method: p.method,
        tipperLoad: {
          create: {
            date,
            tipperId: p.tipperId,
            vendorId: tipper.vendorId,
            loadType: p.loadType,
            brickSizeId: p.brickSizeId || null,
            materialName: p.materialName || null,
            quantity: p.quantity,
            unit: p.unit,
            fromLocation: p.fromLocation || null,
            toLocation: p.toLocation || null,
            rentAmount: p.rentAmount,
            rentDirection: p.rentDirection,
            notes: p.notes,
          },
        },
      },
    });
  } else {
    await prisma.tipperLoad.create({
      data: {
        date,
        tipperId: p.tipperId,
        vendorId: tipper.vendorId,
        loadType: p.loadType,
        brickSizeId: p.brickSizeId || null,
        materialName: p.materialName || null,
        quantity: p.quantity,
        unit: p.unit,
        fromLocation: p.fromLocation || null,
        toLocation: p.toLocation || null,
        rentAmount: 0,
        rentDirection: p.rentDirection,
        notes: p.notes,
      },
    });
  }

  revalidatePath("/tipper");
  revalidatePath("/cash");
  revalidatePath("/");
  redirect("/tipper");
}

export async function deleteTipperLoad(id: string) {
  const load = await prisma.tipperLoad.findUnique({ where: { id } });
  if (!load) return;
  await prisma.$transaction([
    prisma.tipperLoad.delete({ where: { id } }),
    ...(load.cashEntryId ? [prisma.cashEntry.delete({ where: { id: load.cashEntryId } })] : []),
  ]);
  revalidatePath("/tipper");
  revalidatePath("/cash");
  revalidatePath("/");
}
