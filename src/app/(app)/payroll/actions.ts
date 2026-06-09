"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";

const schema = z.object({
  personType: z.enum(["operator", "mason", "loader", "employee"]),
  personId: z.string().min(1),
  date: z.string(),
  amount: z.number().positive(),
  method: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
  notes: z.string().optional(),
});

// Record an advance for ANY worker type (operator, mason, loader, employee).
// Creates the cash-out entry + the linked Advance with the correct person FK,
// so payroll's "open advances" and the cash book both stay in sync.
export async function createWorkerAdvance(input: z.infer<typeof schema>) {
  const p = schema.parse(input);

  let name = "";
  const fk: {
    operatorId?: string;
    masonId?: string;
    loaderId?: string;
    employeeId?: string;
  } = {};

  if (p.personType === "operator") {
    const o = await prisma.operator.findUnique({ where: { id: p.personId } });
    if (!o) throw new Error("Operator not found");
    name = o.name;
    fk.operatorId = o.id;
  } else if (p.personType === "mason") {
    const m = await prisma.mason.findUnique({ where: { id: p.personId } });
    if (!m) throw new Error("Mason not found");
    name = m.name;
    fk.masonId = m.id;
  } else if (p.personType === "loader") {
    const l = await prisma.loader.findUnique({ where: { id: p.personId } });
    if (!l) throw new Error("Loader not found");
    name = l.name;
    fk.loaderId = l.id;
  } else {
    const e = await prisma.employee.findUnique({ where: { id: p.personId } });
    if (!e) throw new Error("Employee not found");
    name = e.name;
    fk.employeeId = e.id;
  }

  const categoryLabel =
    p.personType.charAt(0).toUpperCase() + p.personType.slice(1) + " advance";

  await prisma.cashEntry.create({
    data: {
      date: new Date(p.date),
      amount: p.amount,
      direction: "out",
      source: "advance",
      category: categoryLabel,
      title: `${name} - advance`,
      notes: p.notes,
      method: p.method,
      advance: {
        create: {
          date: new Date(p.date),
          personType: p.personType,
          ...fk,
          amount: p.amount,
          notes: p.notes,
        },
      },
    },
  });

  revalidatePath("/payroll");
  revalidatePath("/cash");
}
