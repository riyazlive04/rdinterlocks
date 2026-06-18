"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";

const workerType = z.enum(["operator", "loader", "mason", "employee"]);

function fk(type: "operator" | "loader" | "mason" | "employee", id: string) {
  return {
    personType: type,
    operatorId: type === "operator" ? id : null,
    loaderId: type === "loader" ? id : null,
    masonId: type === "mason" ? id : null,
    employeeId: type === "employee" ? id : null,
  };
}

const schema = z.object({
  date: z.string(),
  reason: z.string().optional(),
  persons: z.array(z.object({ type: workerType, id: z.string().min(1) })).min(1),
});

export async function createLeaves(input: z.infer<typeof schema>) {
  const p = schema.parse(input);
  const day = new Date(p.date);
  day.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);

  // Skip anyone already marked on leave that day (no duplicates).
  const existing = await prisma.leave.findMany({ where: { date: { gte: day, lte: dayEnd } } });
  const key = (t: string, id: string) => `${t}:${id}`;
  const have = new Set(
    existing.map((e) =>
      key(e.personType, e.operatorId ?? e.loaderId ?? e.masonId ?? e.employeeId ?? "")
    )
  );
  const toCreate = p.persons.filter((w) => !have.has(key(w.type, w.id)));

  if (toCreate.length > 0) {
    await prisma.$transaction(
      toCreate.map((w) =>
        prisma.leave.create({ data: { date: day, reason: p.reason || null, ...fk(w.type, w.id) } })
      )
    );
  }

  revalidatePath("/leave");
  revalidatePath("/payroll");
  revalidatePath("/reports");
}

export async function deleteLeave(id: string) {
  await prisma.leave.delete({ where: { id } });
  revalidatePath("/leave");
  revalidatePath("/payroll");
  revalidatePath("/reports");
}
