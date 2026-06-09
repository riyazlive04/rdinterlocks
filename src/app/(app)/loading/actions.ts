"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { distributeInt } from "@/lib/distribute";

const workerType = z.enum(["loader", "operator", "employee"]);

// Map the generic (workerType, workerId) onto the right FK column.
function workerData(type: "loader" | "operator" | "employee", id: string) {
  return {
    workerType: type,
    loaderId: type === "loader" ? id : null,
    operatorId: type === "operator" ? id : null,
    employeeId: type === "employee" ? id : null,
  };
}

// Create: one or more workers share the total bricks (split evenly, remainder
// to the first). Each worker becomes its own LoadingWork row.
const createSchema = z.object({
  date: z.string(),
  workers: z.array(z.object({ type: workerType, id: z.string().min(1) })).min(1),
  brickSizeId: z.string().optional(),
  brickCount: z.number().int().positive(),
  ratePerBrick: z.number().positive(),
});

export async function createLoadingWork(input: z.infer<typeof createSchema>) {
  const p = createSchema.parse(input);
  const date = new Date(p.date);
  const shares = distributeInt(p.brickCount, p.workers.length);
  await prisma.$transaction(
    p.workers.map((w, i) =>
      prisma.loadingWork.create({
        data: {
          date,
          ...workerData(w.type, w.id),
          brickSizeId: p.brickSizeId || null,
          brickCount: shares[i],
          ratePerBrick: p.ratePerBrick,
          totalAmount: shares[i] * p.ratePerBrick,
        },
      })
    )
  );
  revalidatePath("/loading");
  redirect("/loading");
}

// Update edits a single existing row (one worker).
const updateSchema = z.object({
  date: z.string(),
  workerType: workerType.default("loader"),
  workerId: z.string().min(1),
  brickSizeId: z.string().optional(),
  brickCount: z.number().int().positive(),
  ratePerBrick: z.number().positive(),
});

export async function updateLoadingWork(id: string, input: z.infer<typeof updateSchema>) {
  const p = updateSchema.parse(input);
  await prisma.loadingWork.update({
    where: { id },
    data: {
      date: new Date(p.date),
      ...workerData(p.workerType, p.workerId),
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
