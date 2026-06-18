"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";

// ─── Brick sizes ───────────────────────────────────────────────────────

export async function createBrickSize(data: {
  label: string;
  order?: number;
  dayRate?: number;
  nightRate?: number;
}) {
  await prisma.brickSize.create({
    data: {
      label: data.label.trim(),
      order: Number(data.order ?? 0),
      dayRate: Number(data.dayRate ?? 0),
      nightRate: Number(data.nightRate ?? 0),
    },
  });
  revalidatePath("/settings/brick-sizes");
}
export async function updateBrickSize(
  id: string,
  data: { label: string; order?: number; dayRate?: number; nightRate?: number }
) {
  await prisma.brickSize.update({
    where: { id },
    data: {
      label: data.label.trim(),
      order: Number(data.order ?? 0),
      dayRate: Number(data.dayRate ?? 0),
      nightRate: Number(data.nightRate ?? 0),
    },
  });
  revalidatePath("/settings/brick-sizes");
}
export async function deleteBrickSize(id: string) {
  await prisma.brickSize.delete({ where: { id } });
  revalidatePath("/settings/brick-sizes");
}

// ─── Construction types ───────────────────────────────────────────────

export async function createConstructionType(data: { name: string; order?: number }) {
  await prisma.constructionType.create({
    data: { name: data.name.trim(), order: Number(data.order ?? 0) },
  });
  revalidatePath("/settings/construction-types");
}
export async function updateConstructionType(id: string, data: { name: string; order?: number }) {
  await prisma.constructionType.update({
    where: { id },
    data: { name: data.name.trim(), order: Number(data.order ?? 0) },
  });
  revalidatePath("/settings/construction-types");
}
export async function deleteConstructionType(id: string) {
  await prisma.constructionType.delete({ where: { id } });
  revalidatePath("/settings/construction-types");
}

// ─── Price matrix ─────────────────────────────────────────────────────

const priceSchema = z.object({
  brickSizeId: z.string().min(1),
  constructionTypeId: z.string().min(1),
  sellPrice: z.number().nonnegative(),
  masonRate: z.number().nonnegative(),
  productionCost: z.number().nonnegative().default(0),
});

export async function upsertPrice(data: z.infer<typeof priceSchema>) {
  const parsed = priceSchema.parse(data);
  await prisma.brickPrice.upsert({
    where: {
      brickSizeId_constructionTypeId: {
        brickSizeId: parsed.brickSizeId,
        constructionTypeId: parsed.constructionTypeId,
      },
    },
    update: {
      sellPrice: parsed.sellPrice,
      masonRate: parsed.masonRate,
      productionCost: parsed.productionCost,
    },
    create: parsed,
  });
  revalidatePath("/settings/price-matrix");
}

// ─── Expense categories ───────────────────────────────────────────────

export async function createExpenseCategory(data: { name: string; order?: number }) {
  await prisma.expenseCategory.create({
    data: { name: data.name.trim(), order: Number(data.order ?? 0) },
  });
  revalidatePath("/settings/expense-categories");
}
export async function updateExpenseCategory(id: string, data: { name: string; order?: number }) {
  await prisma.expenseCategory.update({
    where: { id },
    data: { name: data.name.trim(), order: Number(data.order ?? 0) },
  });
  revalidatePath("/settings/expense-categories");
}
export async function deleteExpenseCategory(id: string) {
  await prisma.expenseCategory.delete({ where: { id } });
  revalidatePath("/settings/expense-categories");
}

// ─── Materials ────────────────────────────────────────────────────────

export async function createMaterial(data: { name: string; unit: string; order?: number }) {
  await prisma.material.create({
    data: { name: data.name.trim(), unit: data.unit.trim() || "unit", order: Number(data.order ?? 0) },
  });
  revalidatePath("/settings/materials");
}
export async function updateMaterial(id: string, data: { name: string; unit: string; order?: number }) {
  await prisma.material.update({
    where: { id },
    data: { name: data.name.trim(), unit: data.unit.trim() || "unit", order: Number(data.order ?? 0) },
  });
  revalidatePath("/settings/materials");
}
export async function deleteMaterial(id: string) {
  await prisma.material.delete({ where: { id } });
  revalidatePath("/settings/materials");
}

// ─── People (operators / masons / loaders) ────────────────────────────

const personSchema = z.object({ name: z.string().min(1), phone: z.string().optional() });

export async function createOperator(data: { name: string; phone?: string }) {
  const p = personSchema.parse(data);
  await prisma.operator.create({ data: { name: p.name.trim(), phone: p.phone?.trim() || null } });
  revalidatePath("/settings/operators");
}
export async function updateOperator(id: string, data: { name: string; phone?: string }) {
  const p = personSchema.parse(data);
  await prisma.operator.update({
    where: { id },
    data: { name: p.name.trim(), phone: p.phone?.trim() || null },
  });
  revalidatePath("/settings/operators");
}
export async function deleteOperator(id: string) {
  await prisma.operator.update({ where: { id }, data: { active: false } });
  revalidatePath("/settings/operators");
}

export async function createMason(data: { name: string; phone?: string }) {
  const p = personSchema.parse(data);
  await prisma.mason.create({ data: { name: p.name.trim(), phone: p.phone?.trim() || null } });
  revalidatePath("/settings/masons");
}
export async function updateMason(id: string, data: { name: string; phone?: string }) {
  const p = personSchema.parse(data);
  await prisma.mason.update({
    where: { id },
    data: { name: p.name.trim(), phone: p.phone?.trim() || null },
  });
  revalidatePath("/settings/masons");
}
export async function deleteMason(id: string) {
  await prisma.mason.update({ where: { id }, data: { active: false } });
  revalidatePath("/settings/masons");
}

export async function createLoader(data: { name: string; phone?: string }) {
  const p = personSchema.parse(data);
  await prisma.loader.create({ data: { name: p.name.trim(), phone: p.phone?.trim() || null } });
  revalidatePath("/settings/loaders");
}
export async function updateLoader(id: string, data: { name: string; phone?: string }) {
  const p = personSchema.parse(data);
  await prisma.loader.update({
    where: { id },
    data: { name: p.name.trim(), phone: p.phone?.trim() || null },
  });
  revalidatePath("/settings/loaders");
}
export async function deleteLoader(id: string) {
  await prisma.loader.update({ where: { id }, data: { active: false } });
  revalidatePath("/settings/loaders");
}

// ─── Employees ────────────────────────────────────────────────────────

const empSchema = z.object({
  name: z.string().min(1),
  role: z.string().default("staff"),
  payType: z.enum(["monthly", "daily", "hourly"]),
  payRate: z.number().nonnegative(),
  payFrequency: z.enum(["weekly", "monthly"]).default("monthly"),
  phone: z.string().optional(),
});

export async function createEmployee(data: z.infer<typeof empSchema>) {
  const p = empSchema.parse(data);
  await prisma.employee.create({
    data: { ...p, name: p.name.trim(), phone: p.phone?.trim() || null },
  });
  revalidatePath("/settings/employees");
  revalidatePath("/employees");
}
export async function updateEmployee(id: string, data: z.infer<typeof empSchema>) {
  const p = empSchema.parse(data);
  await prisma.employee.update({
    where: { id },
    data: { ...p, name: p.name.trim(), phone: p.phone?.trim() || null },
  });
  revalidatePath("/settings/employees");
  revalidatePath("/employees");
}
export async function deleteEmployee(id: string) {
  await prisma.employee.update({ where: { id }, data: { active: false } });
  revalidatePath("/settings/employees");
}

// ─── Vendors & Tippers ────────────────────────────────────────────────

const vendorSchema = z.object({ name: z.string().min(1), phone: z.string().optional(), notes: z.string().optional() });

export async function createVendor(data: z.infer<typeof vendorSchema>) {
  const p = vendorSchema.parse(data);
  await prisma.vendor.create({ data: { name: p.name.trim(), phone: p.phone?.trim() || null, notes: p.notes ?? null } });
  revalidatePath("/settings/vendors");
}
export async function updateVendor(id: string, data: z.infer<typeof vendorSchema>) {
  const p = vendorSchema.parse(data);
  await prisma.vendor.update({
    where: { id },
    data: { name: p.name.trim(), phone: p.phone?.trim() || null, notes: p.notes ?? null },
  });
  revalidatePath("/settings/vendors");
}
export async function deleteVendor(id: string) {
  await prisma.vendor.update({ where: { id }, data: { active: false } });
  revalidatePath("/settings/vendors");
}

const tipperSchema = z.object({
  name: z.string().min(1),
  plate: z.string().optional(),
  ownership: z.enum(["own", "vendor"]),
  vendorId: z.string().optional(),
  emiAmount: z.number().nonnegative().default(0),
});

export async function createTipper(data: z.infer<typeof tipperSchema>) {
  const p = tipperSchema.parse(data);
  await prisma.tipper.create({
    data: {
      name: p.name.trim(),
      plate: p.plate?.trim() || null,
      ownership: p.ownership,
      vendorId: p.ownership === "vendor" ? p.vendorId || null : null,
      emiAmount: p.ownership === "own" ? p.emiAmount : 0,
    },
  });
  revalidatePath("/settings/tippers");
}
export async function updateTipper(id: string, data: z.infer<typeof tipperSchema>) {
  const p = tipperSchema.parse(data);
  await prisma.tipper.update({
    where: { id },
    data: {
      name: p.name.trim(),
      plate: p.plate?.trim() || null,
      ownership: p.ownership,
      vendorId: p.ownership === "vendor" ? p.vendorId || null : null,
      emiAmount: p.ownership === "own" ? p.emiAmount : 0,
    },
  });
  revalidatePath("/settings/tippers");
}
export async function deleteTipper(id: string) {
  await prisma.tipper.update({ where: { id }, data: { active: false } });
  revalidatePath("/settings/tippers");
}

// ─── Factory profile ──────────────────────────────────────────────────

const settingsSchema = z.object({
  factoryName: z.string().min(1),
  ownerName: z.string().min(1),
  address: z.string().default(""),
  phone: z.string().default(""),
  gstin: z.string().default(""),
  cementBagsPer1000: z.number().nonnegative(),
  cashOpening: z.number(),
  dryingDays: z.number().int().nonnegative().default(3),
  curingDays: z.number().int().nonnegative().default(10),
  operatorPayFreq: z.enum(["weekly", "monthly"]).default("weekly"),
  loaderPayFreq: z.enum(["weekly", "monthly"]).default("weekly"),
  masonPayFreq: z.enum(["weekly", "monthly"]).default("weekly"),
});

export async function updateSettings(data: z.infer<typeof settingsSchema>) {
  const p = settingsSchema.parse(data);
  await prisma.settings.upsert({
    where: { id: "default" },
    create: { id: "default", ...p },
    update: p,
  });
  revalidatePath("/settings/factory");
}

// ─── Security ─────────────────────────────────────────────────────────

import bcrypt from "bcryptjs";
const passwordSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(4),
});
export async function changePassword(data: z.infer<typeof passwordSchema>) {
  const p = passwordSchema.parse(data);
  const owner = await prisma.user.findFirst({ where: { role: "admin" } });
  if (!owner) throw new Error("No admin user found");
  const ok = await bcrypt.compare(p.current, owner.pinHash);
  if (!ok) throw new Error("Current password is incorrect");
  await prisma.user.update({
    where: { id: owner.id },
    data: { pinHash: await bcrypt.hash(p.next, 10) },
  });
}

// ─── Users & access (admin-managed) ───────────────────────────────────

const roleEnum = z.enum(["admin", "manager", "staff"]);

const userCreateSchema = z.object({
  name: z.string().min(1),
  password: z.string().min(4),
  role: roleEnum.default("manager"),
  permissions: z.array(z.string()).default([]),
});

export async function createUser(input: z.infer<typeof userCreateSchema>) {
  const p = userCreateSchema.parse(input);
  await prisma.user.create({
    data: {
      name: p.name.trim(),
      pinHash: await bcrypt.hash(p.password, 10),
      role: p.role,
      // admins implicitly have everything, so we don't store per-area grants
      permissions: p.role === "admin" ? [] : p.permissions,
      active: true,
    },
  });
  revalidatePath("/settings/users");
}

const userUpdateSchema = z.object({
  name: z.string().min(1),
  role: roleEnum,
  permissions: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  password: z.string().optional(),
});

async function adminCount(activeOnly = true) {
  return prisma.user.count({
    where: { role: { in: ["admin", "owner"] }, ...(activeOnly ? { active: true } : {}) },
  });
}

export async function updateUser(id: string, input: z.infer<typeof userUpdateSchema>) {
  const p = userUpdateSchema.parse(input);
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new Error("User not found");
  const targetIsActiveAdmin =
    (target.role === "admin" || target.role === "owner") && target.active;
  // Don't let the last admin be demoted or deactivated.
  if (targetIsActiveAdmin && (p.role !== "admin" || !p.active)) {
    if ((await adminCount(true)) <= 1) throw new Error("This is the only admin - keep at least one.");
  }
  const data: {
    name: string;
    role: string;
    permissions: string[];
    active: boolean;
    pinHash?: string;
  } = {
    name: p.name.trim(),
    role: p.role,
    permissions: p.role === "admin" ? [] : p.permissions,
    active: p.active,
  };
  if (p.password && p.password.length >= 4) data.pinHash = await bcrypt.hash(p.password, 10);
  await prisma.user.update({ where: { id }, data });
  revalidatePath("/settings/users");
}

export async function deleteUser(id: string) {
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return;
  if (target.role === "admin" || target.role === "owner") {
    if ((await adminCount(false)) <= 1) throw new Error("Can't delete the only admin.");
  }
  await prisma.user.delete({ where: { id } });
  revalidatePath("/settings/users");
}
