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

// One physical load of bricks is recorded as a LOADING crew and an optional
// UNLOADING crew (different people / rate). Both crews split the SAME brick
// count, so bricks aren't double-counted (the list counts the loading phase
// only); each crew is paid separately. Each worker becomes its own row.
const crewSchema = z.object({
  workers: z.array(z.object({ type: workerType, id: z.string().min(1) })).min(1),
  ratePerBrick: z.number().positive(),
});
const createSchema = z.object({
  date: z.string(),
  brickSizeId: z.string().optional(),
  brickCount: z.number().int().positive(),
  loading: crewSchema,
  unloading: crewSchema.optional(),
});

export async function createLoadingWork(input: z.infer<typeof createSchema>) {
  const p = createSchema.parse(input);
  const date = new Date(p.date);

  const rowsFor = (
    crew: z.infer<typeof crewSchema>,
    phase: "loading" | "unloading"
  ) => {
    const shares = distributeInt(p.brickCount, crew.workers.length);
    return crew.workers.map((w, i) =>
      prisma.loadingWork.create({
        data: {
          date,
          phase,
          ...workerData(w.type, w.id),
          brickSizeId: p.brickSizeId || null,
          brickCount: shares[i],
          ratePerBrick: crew.ratePerBrick,
          totalAmount: shares[i] * crew.ratePerBrick,
        },
      })
    );
  };

  const ops = [...rowsFor(p.loading, "loading")];
  if (p.unloading) ops.push(...rowsFor(p.unloading, "unloading"));
  await prisma.$transaction(ops);

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
