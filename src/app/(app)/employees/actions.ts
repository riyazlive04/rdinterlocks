"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { startOfDay } from "@/lib/format";

export async function setAttendance(
  employeeId: string,
  date: string,
  status: "present" | "absent" | "leave" | "half"
) {
  const d = startOfDay(new Date(date));
  await prisma.employeeAttendance.upsert({
    where: { date_employeeId: { date: d, employeeId } },
    update: { status },
    create: { date: d, employeeId, status },
  });
  revalidatePath("/employees");
  revalidatePath(`/employees/${employeeId}`);
}

const advanceSchema = z.object({
  date: z.string(),
  employeeId: z.string().min(1),
  amount: z.number().positive(),
  notes: z.string().optional(),
  method: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
});

export async function giveEmployeeAdvance(input: z.infer<typeof advanceSchema>) {
  const p = advanceSchema.parse(input);
  const emp = await prisma.employee.findUnique({ where: { id: p.employeeId } });
  if (!emp) throw new Error("Employee not found");
  await prisma.cashEntry.create({
    data: {
      date: new Date(p.date),
      amount: p.amount,
      direction: "out",
      source: "advance",
      category: "Employee advance",
      title: `${emp.name} — advance`,
      notes: p.notes,
      method: p.method,
      advance: {
        create: {
          date: new Date(p.date),
          personType: "employee",
          employeeId: p.employeeId,
          amount: p.amount,
          notes: p.notes,
        },
      },
    },
  });
  revalidatePath("/employees");
  revalidatePath(`/employees/${p.employeeId}`);
  revalidatePath("/cash");
}

const payoutSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  baseAmount: z.number().nonnegative(),
  bonus: z.number().nonnegative().default(0),
  deductions: z.number().nonnegative().default(0),
  advancesSettled: z.number().nonnegative().default(0),
  notes: z.string().optional(),
  method: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
});

export async function recordPayout(input: z.infer<typeof payoutSchema>) {
  const p = payoutSchema.parse(input);
  const emp = await prisma.employee.findUnique({ where: { id: p.employeeId } });
  if (!emp) throw new Error("Employee not found");
  const net = p.baseAmount + p.bonus - p.deductions - p.advancesSettled;

  await prisma.cashEntry.create({
    data: {
      date: new Date(p.date),
      amount: net,
      direction: "out",
      source: "wage",
      category: "Salary",
      title: `${emp.name} — salary`,
      notes: p.notes,
      method: p.method,
      employeePayout: {
        create: {
          date: new Date(p.date),
          employeeId: p.employeeId,
          periodStart: new Date(p.periodStart),
          periodEnd: new Date(p.periodEnd),
          baseAmount: p.baseAmount,
          bonus: p.bonus,
          deductions: p.deductions,
          advancesSettled: p.advancesSettled,
          netPaid: net,
          notes: p.notes,
        },
      },
    },
  });

  // Mark advances as settled (greedy by date until budget exhausted)
  let remaining = p.advancesSettled;
  if (remaining > 0) {
    const open = await prisma.advance.findMany({
      where: { employeeId: p.employeeId, settled: false },
      orderBy: { date: "asc" },
    });
    for (const a of open) {
      if (remaining <= 0) break;
      if (a.amount <= remaining) {
        await prisma.advance.update({ where: { id: a.id }, data: { settled: true } });
        remaining -= a.amount;
      } else {
        // partial — leave rest unsettled
        remaining = 0;
      }
    }
  }

  revalidatePath(`/employees/${p.employeeId}`);
  revalidatePath("/employees");
  revalidatePath("/cash");
}
