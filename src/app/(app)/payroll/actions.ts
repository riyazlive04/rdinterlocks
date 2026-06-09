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

// ── Resolve a person to a display name + the matching FK key ───────────
async function resolvePerson(personType: PersonType, personId: string) {
  if (personType === "operator") {
    const o = await prisma.operator.findUnique({ where: { id: personId } });
    if (!o) throw new Error("Operator not found");
    return { name: o.name, fkKey: "operatorId" as const };
  }
  if (personType === "mason") {
    const m = await prisma.mason.findUnique({ where: { id: personId } });
    if (!m) throw new Error("Mason not found");
    return { name: m.name, fkKey: "masonId" as const };
  }
  if (personType === "loader") {
    const l = await prisma.loader.findUnique({ where: { id: personId } });
    if (!l) throw new Error("Loader not found");
    return { name: l.name, fkKey: "loaderId" as const };
  }
  const e = await prisma.employee.findUnique({ where: { id: personId } });
  if (!e) throw new Error("Employee not found");
  return { name: e.name, fkKey: "employeeId" as const };
}

type PersonType = "operator" | "mason" | "loader" | "employee";

const paySchema = z.object({
  personType: z.enum(["operator", "mason", "loader", "employee"]),
  personId: z.string().min(1),
  date: z.string(),
  earned: z.number().nonnegative().default(0),
  advancesSettled: z.number().nonnegative().default(0),
  netPaid: z.number().nonnegative(),
  method: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
  notes: z.string().optional(),
});

// Pay a worker's wages/salary: records the cash-out (if any), snapshots the
// payout, and settles their open advances up to advancesSettled. Net payable
// on payroll = earned − advances − paid, so after this the row reads ₹0.
export async function payWorker(input: z.infer<typeof paySchema>) {
  const p = paySchema.parse(input);
  const { name, fkKey } = await resolvePerson(p.personType, p.personId);
  const label = p.personType.charAt(0).toUpperCase() + p.personType.slice(1);

  const payoutData = {
    date: new Date(p.date),
    personType: p.personType,
    [fkKey]: p.personId,
    earned: p.earned,
    advancesSettled: p.advancesSettled,
    netPaid: p.netPaid,
    notes: p.notes,
  };

  if (p.netPaid > 0) {
    // Cash actually changes hands → record it in the cash book.
    await prisma.cashEntry.create({
      data: {
        date: new Date(p.date),
        amount: p.netPaid,
        direction: "out",
        source: "wage",
        category: `${label} salary`,
        title: `${name} - salary`,
        notes: p.notes,
        method: p.method,
        workerPayout: { create: payoutData },
      },
    });
  } else {
    // Fully offset by advance → no cash moves, but still record the payout.
    await prisma.workerPayout.create({ data: payoutData });
  }

  // Settle open advances (oldest first) up to the amount deducted.
  let remaining = p.advancesSettled;
  if (remaining > 0) {
    const open = await prisma.advance.findMany({
      where: { [fkKey]: p.personId, settled: false },
      orderBy: { date: "asc" },
    });
    for (const a of open) {
      if (remaining <= 0.001) break;
      if (a.amount <= remaining + 0.001) {
        await prisma.advance.update({ where: { id: a.id }, data: { settled: true } });
        remaining -= a.amount;
      } else {
        remaining = 0; // partial — leave the rest open
      }
    }
  }

  revalidatePath("/payroll");
  revalidatePath("/cash");
  revalidatePath("/");
}
