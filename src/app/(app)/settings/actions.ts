"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession, requireAdmin } from "@/lib/auth";
import { triggerWaSequencesForStage } from "@/lib/lead-stage";
import { isValidVpa } from "@/lib/upi-vpa";
import { isAreaKey } from "@/lib/access";
import { ROLES, canAdministerUser, canConferRole, canSetUserAreas, isFullAccess, isOwner, passwordProblem } from "@/lib/roles";

// ─── Brick sizes ───────────────────────────────────────────────────────

export async function createBrickSize(data: {
  label: string;
  dimensions?: string;
  order?: number;
  dayRate?: number;
  nightRate?: number;
}) {
  await requireAdmin();
  await prisma.brickSize.create({
    data: {
      label: data.label.trim(),
      dimensions: (data.dimensions ?? "").trim(),
      order: Number(data.order ?? 0),
      dayRate: Number(data.dayRate ?? 0),
      nightRate: Number(data.nightRate ?? 0),
    },
  });
  revalidatePath("/settings/brick-sizes");
}
export async function updateBrickSize(
  id: string,
  data: { label: string; dimensions?: string; order?: number; dayRate?: number; nightRate?: number }
) {
  await requireAdmin();
  await prisma.brickSize.update({
    where: { id },
    data: {
      label: data.label.trim(),
      dimensions: (data.dimensions ?? "").trim(),
      order: Number(data.order ?? 0),
      dayRate: Number(data.dayRate ?? 0),
      nightRate: Number(data.nightRate ?? 0),
    },
  });
  revalidatePath("/settings/brick-sizes");
}
export async function deleteBrickSize(id: string) {
  await requireAdmin();
  await prisma.brickSize.delete({ where: { id } });
  revalidatePath("/settings/brick-sizes");
}

// ─── Construction types ───────────────────────────────────────────────

export async function createConstructionType(data: { name: string; order?: number }) {
  await requireAdmin();
  await prisma.constructionType.create({
    data: { name: data.name.trim(), order: Number(data.order ?? 0) },
  });
  revalidatePath("/settings/construction-types");
}
export async function updateConstructionType(id: string, data: { name: string; order?: number }) {
  await requireAdmin();
  await prisma.constructionType.update({
    where: { id },
    data: { name: data.name.trim(), order: Number(data.order ?? 0) },
  });
  revalidatePath("/settings/construction-types");
}
export async function deleteConstructionType(id: string) {
  await requireAdmin();
  await prisma.constructionType.delete({ where: { id } });
  revalidatePath("/settings/construction-types");
}

// ─── Lintel slab sizes ────────────────────────────────────────────────

export async function createSlabSize(data: { label: string; order?: number }) {
  await requireAdmin();
  await prisma.slabSize.create({
    data: { label: String(data.label).trim(), order: Number(data.order ?? 0) },
  });
  revalidatePath("/settings/slab-sizes");
}
export async function updateSlabSize(id: string, data: { label: string; order?: number }) {
  await requireAdmin();
  await prisma.slabSize.update({
    where: { id },
    data: { label: String(data.label).trim(), order: Number(data.order ?? 0) },
  });
  revalidatePath("/settings/slab-sizes");
}
export async function deleteSlabSize(id: string) {
  await requireAdmin();
  await prisma.slabSize.delete({ where: { id } });
  revalidatePath("/settings/slab-sizes");
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
  await requireAdmin();
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

// ─── Delivery zones (location-based quotation pricing) ────────────────

const zoneRuleSchema = z.object({
  brickSizeId: z.string().min(1),
  minBricks: z.number().int().nonnegative().default(0),
  transportOnly: z.number().nonnegative().nullable().default(null),
});

const zonePriceSchema = z.object({
  brickSizeId: z.string().min(1),
  constructionTypeId: z.string().min(1),
  sellPrice: z.number().nonnegative(),
});

const deliveryZoneSchema = z.object({
  name: z.string().min(1),
  distanceLabel: z.string().default(""),
  areas: z.string().default(""),
  order: z.number().int().default(0),
  rules: z.array(zoneRuleSchema).default([]),
  prices: z.array(zonePriceSchema).default([]),
});

async function saveZoneRulesAndPrices(tx: Prisma.TransactionClient, zoneId: string, p: z.infer<typeof deliveryZoneSchema>) {
  for (const r of p.rules) {
    await tx.zoneBrickRule.upsert({
      where: { zoneId_brickSizeId: { zoneId, brickSizeId: r.brickSizeId } },
      update: { minBricks: r.minBricks, transportOnly: r.transportOnly },
      create: { zoneId, brickSizeId: r.brickSizeId, minBricks: r.minBricks, transportOnly: r.transportOnly },
    });
  }
  for (const pr of p.prices) {
    await tx.zonePrice.upsert({
      where: {
        zoneId_brickSizeId_constructionTypeId: {
          zoneId,
          brickSizeId: pr.brickSizeId,
          constructionTypeId: pr.constructionTypeId,
        },
      },
      update: { sellPrice: pr.sellPrice },
      create: { zoneId, brickSizeId: pr.brickSizeId, constructionTypeId: pr.constructionTypeId, sellPrice: pr.sellPrice },
    });
  }
}

export async function createDeliveryZone(input: z.infer<typeof deliveryZoneSchema>) {
  await requireAdmin();
  const p = deliveryZoneSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    const zone = await tx.deliveryZone.create({
      data: {
        name: p.name.trim(),
        distanceLabel: p.distanceLabel.trim(),
        areas: p.areas.trim(),
        order: p.order,
      },
    });
    await saveZoneRulesAndPrices(tx, zone.id, p);
  });
  revalidatePath("/settings/delivery-zones");
  revalidatePath("/quotations/new");
}

export async function updateDeliveryZone(id: string, input: z.infer<typeof deliveryZoneSchema>) {
  await requireAdmin();
  const p = deliveryZoneSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    await tx.deliveryZone.update({
      where: { id },
      data: {
        name: p.name.trim(),
        distanceLabel: p.distanceLabel.trim(),
        areas: p.areas.trim(),
        order: p.order,
      },
    });
    await saveZoneRulesAndPrices(tx, id, p);
  });
  revalidatePath("/settings/delivery-zones");
  revalidatePath("/quotations/new");
}

export async function deactivateDeliveryZone(id: string) {
  await requireAdmin();
  await prisma.deliveryZone.update({ where: { id }, data: { active: false } });
  revalidatePath("/settings/delivery-zones");
  revalidatePath("/quotations/new");
}

export async function reactivateDeliveryZone(id: string) {
  await requireAdmin();
  await prisma.deliveryZone.update({ where: { id }, data: { active: true } });
  revalidatePath("/settings/delivery-zones");
  revalidatePath("/quotations/new");
}

// ─── Expense categories ───────────────────────────────────────────────

export async function createExpenseCategory(data: { name: string; order?: number }) {
  await requireAdmin();
  await prisma.expenseCategory.create({
    data: { name: data.name.trim(), order: Number(data.order ?? 0) },
  });
  revalidatePath("/settings/expense-categories");
}
export async function updateExpenseCategory(id: string, data: { name: string; order?: number }) {
  await requireAdmin();
  await prisma.expenseCategory.update({
    where: { id },
    data: { name: data.name.trim(), order: Number(data.order ?? 0) },
  });
  revalidatePath("/settings/expense-categories");
}
export async function deleteExpenseCategory(id: string) {
  await requireAdmin();
  await prisma.expenseCategory.delete({ where: { id } });
  revalidatePath("/settings/expense-categories");
}

// ─── Materials ────────────────────────────────────────────────────────

export async function createMaterial(data: { name: string; unit: string; order?: number }) {
  await requireAdmin();
  await prisma.material.create({
    data: { name: data.name.trim(), unit: data.unit.trim() || "unit", order: Number(data.order ?? 0) },
  });
  revalidatePath("/settings/materials");
}
export async function updateMaterial(id: string, data: { name: string; unit: string; order?: number }) {
  await requireAdmin();
  await prisma.material.update({
    where: { id },
    data: { name: data.name.trim(), unit: data.unit.trim() || "unit", order: Number(data.order ?? 0) },
  });
  revalidatePath("/settings/materials");
}
export async function deleteMaterial(id: string) {
  await requireAdmin();
  await prisma.material.delete({ where: { id } });
  revalidatePath("/settings/materials");
}

// ─── Material recipe (usage per basis bricks, per brick size) ──────────

const recipeSchema = z.object({
  brickSizeId: z.string().min(1),
  materialId: z.string().min(1),
  qtyPerBasis: z.number().nonnegative(),
});

export async function upsertRecipe(data: z.infer<typeof recipeSchema>) {
  await requireAdmin();
  const p = recipeSchema.parse(data);
  await prisma.materialRecipe.upsert({
    where: { brickSizeId_materialId: { brickSizeId: p.brickSizeId, materialId: p.materialId } },
    update: { qtyPer1000: p.qtyPerBasis },
    create: { brickSizeId: p.brickSizeId, materialId: p.materialId, qtyPer1000: p.qtyPerBasis },
  });
  revalidatePath("/settings/materials");
}

// ─── Material stock on hand ───────────────────────────────────────────

const stockSchema = z.object({
  materialId: z.string().min(1),
  quantity: z.number(),
  reorderAt: z.number().nonnegative().default(0),
});

// Set the current stock level and reorder threshold outright.
export async function setMaterialStock(data: z.infer<typeof stockSchema>) {
  await requireAdmin();
  const p = stockSchema.parse(data);
  await prisma.materialStock.upsert({
    where: { materialId: p.materialId },
    update: { quantity: p.quantity, reorderAt: p.reorderAt },
    create: { materialId: p.materialId, quantity: p.quantity, reorderAt: p.reorderAt },
  });
  revalidatePath("/settings/material-stock");
  revalidatePath("/");
}

// Add received stock to the current level (a delivery of raw material arrived).
export async function addMaterialStock(materialId: string, amount: number) {
  await requireAdmin();
  const amt = Number(amount);
  if (!amt) return;
  await prisma.materialStock.upsert({
    where: { materialId },
    update: { quantity: { increment: amt } },
    create: { materialId, quantity: amt, reorderAt: 0 },
  });
  revalidatePath("/settings/material-stock");
  revalidatePath("/");
}

// ─── People (operators / masons / loaders) ────────────────────────────

const personSchema = z.object({ name: z.string().min(1), phone: z.string().optional() });

export async function createOperator(data: { name: string; phone?: string }) {
  await requireAdmin();
  const p = personSchema.parse(data);
  await prisma.operator.create({ data: { name: p.name.trim(), phone: p.phone?.trim() || null } });
  revalidatePath("/settings/operators");
}
export async function updateOperator(id: string, data: { name: string; phone?: string }) {
  await requireAdmin();
  const p = personSchema.parse(data);
  await prisma.operator.update({
    where: { id },
    data: { name: p.name.trim(), phone: p.phone?.trim() || null },
  });
  revalidatePath("/settings/operators");
}
export async function deleteOperator(id: string) {
  await requireAdmin();
  await prisma.operator.update({ where: { id }, data: { active: false } });
  revalidatePath("/settings/operators");
}

export async function createMason(data: { name: string; phone?: string }) {
  await requireAdmin();
  const p = personSchema.parse(data);
  await prisma.mason.create({ data: { name: p.name.trim(), phone: p.phone?.trim() || null } });
  revalidatePath("/settings/masons");
}
export async function updateMason(id: string, data: { name: string; phone?: string }) {
  await requireAdmin();
  const p = personSchema.parse(data);
  await prisma.mason.update({
    where: { id },
    data: { name: p.name.trim(), phone: p.phone?.trim() || null },
  });
  revalidatePath("/settings/masons");
}
export async function deleteMason(id: string) {
  await requireAdmin();
  await prisma.mason.update({ where: { id }, data: { active: false } });
  revalidatePath("/settings/masons");
}

// ─── Machines ─────────────────────────────────────────────────────────

const machineSchema = z.object({ name: z.string().min(1), order: z.number().optional() });

export async function createMachine(data: { name: string; order?: number }) {
  await requireAdmin();
  const p = machineSchema.parse(data);
  await prisma.machine.create({ data: { name: p.name.trim(), order: Number(p.order ?? 0) } });
  revalidatePath("/settings/machines");
}
export async function updateMachine(id: string, data: { name: string; order?: number }) {
  await requireAdmin();
  const p = machineSchema.parse(data);
  await prisma.machine.update({
    where: { id },
    data: { name: p.name.trim(), order: Number(p.order ?? 0) },
  });
  revalidatePath("/settings/machines");
}
export async function deleteMachine(id: string) {
  await requireAdmin();
  await prisma.machine.update({ where: { id }, data: { active: false } });
  revalidatePath("/settings/machines");
}

export async function createLoader(data: { name: string; phone?: string }) {
  await requireAdmin();
  const p = personSchema.parse(data);
  await prisma.loader.create({ data: { name: p.name.trim(), phone: p.phone?.trim() || null } });
  revalidatePath("/settings/loaders");
}
export async function updateLoader(id: string, data: { name: string; phone?: string }) {
  await requireAdmin();
  const p = personSchema.parse(data);
  await prisma.loader.update({
    where: { id },
    data: { name: p.name.trim(), phone: p.phone?.trim() || null },
  });
  revalidatePath("/settings/loaders");
}
export async function deleteLoader(id: string) {
  await requireAdmin();
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
  await requireAdmin();
  const p = empSchema.parse(data);
  await prisma.employee.create({
    data: { ...p, name: p.name.trim(), phone: p.phone?.trim() || null },
  });
  revalidatePath("/settings/employees");
  revalidatePath("/employees");
}
export async function updateEmployee(id: string, data: z.infer<typeof empSchema>) {
  await requireAdmin();
  const p = empSchema.parse(data);
  await prisma.employee.update({
    where: { id },
    data: { ...p, name: p.name.trim(), phone: p.phone?.trim() || null },
  });
  revalidatePath("/settings/employees");
  revalidatePath("/employees");
}
export async function deleteEmployee(id: string) {
  await requireAdmin();
  await prisma.employee.update({ where: { id }, data: { active: false } });
  revalidatePath("/settings/employees");
}

// ─── Vendors & Tippers ────────────────────────────────────────────────

const vendorSchema = z.object({ name: z.string().min(1), phone: z.string().optional(), notes: z.string().optional() });

export async function createVendor(data: z.infer<typeof vendorSchema>) {
  await requireAdmin();
  const p = vendorSchema.parse(data);
  await prisma.vendor.create({ data: { name: p.name.trim(), phone: p.phone?.trim() || null, notes: p.notes ?? null } });
  revalidatePath("/settings/vendors");
}
export async function updateVendor(id: string, data: z.infer<typeof vendorSchema>) {
  await requireAdmin();
  const p = vendorSchema.parse(data);
  await prisma.vendor.update({
    where: { id },
    data: { name: p.name.trim(), phone: p.phone?.trim() || null, notes: p.notes ?? null },
  });
  revalidatePath("/settings/vendors");
}
export async function deleteVendor(id: string) {
  await requireAdmin();
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
  await requireAdmin();
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
  await requireAdmin();
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
  await requireAdmin();
  await prisma.tipper.update({ where: { id }, data: { active: false } });
  revalidatePath("/settings/tippers");
}

// ─── Factory profile ──────────────────────────────────────────────────

const settingsSchema = z.object({
  factoryName: z.string().min(1),
  ownerName: z.string().min(1),
  address: z.string().default(""),
  phone: z.string().default(""),
  email: z.string().default(""),
  gstin: z.string().default(""),
  cementBagsPer1000: z.number().nonnegative(),
  materialBasis: z.number().int().positive().default(1000),
  cashOpening: z.number(),
  dryingDays: z.number().int().nonnegative().default(3),
  curingDays: z.number().int().nonnegative().default(10),
  operatorPayFreq: z.enum(["weekly", "monthly"]).default("weekly"),
  loaderPayFreq: z.enum(["weekly", "monthly"]).default("weekly"),
  masonPayFreq: z.enum(["weekly", "monthly"]).default("weekly"),
});

export async function updateSettings(data: z.infer<typeof settingsSchema>) {
  await requireAdmin();
  const p = settingsSchema.parse(data);
  await prisma.settings.upsert({
    where: { id: "default" },
    create: { id: "default", ...p },
    update: p,
  });
  revalidatePath("/settings/factory");
}

// ─── Quotation PDF content (bilingual boilerplate + payment QR) ──────────

// A data: URL is ~1.37x the original file size; 700KB of encoded text caps
// the source image at roughly 500KB, generous for a scanned signature while
// keeping the Settings row (and every quotation PDF generation that reads
// it) bounded. Empty string is always allowed — that's "no signature set".
const MAX_SIGNATURE_DATA_URL_LENGTH = 700_000;

const quoteContentSchema = z.object({
  quoteAddressTa: z.string().default(""),
  quoteTermsEn: z.string().default(""),
  quoteTermsTa: z.string().default(""),
  quoteOurScopeEn: z.string().default(""),
  quoteOurScopeTa: z.string().default(""),
  quoteClientScopeEn: z.string().default(""),
  quoteClientScopeTa: z.string().default(""),
  // A UPI ID is a VPA — `handle@psp`, never a bare phone number. Stored
  // without the handle it still renders a QR (upi-qr.ts only checks the
  // string is non-empty), but `pa=8870714655` names no payee, so every
  // quotation goes out with a code the customer's app refuses to resolve and
  // nothing on screen says why. Validated here rather than in upi-qr.ts so
  // the person who can fix it is told at the moment they type it.
  quoteUpiId: z
    .string()
    .trim()
    .refine((v) => v === "" || isValidVpa(v), 'A UPI ID must look like "number@bank", e.g. 8870714655@ybl.')
    .default(""),
  quoteUpiPayeeName: z.string().default(""),
  quoteSignatureImage: z
    .string()
    .max(MAX_SIGNATURE_DATA_URL_LENGTH, "Signature image is too large — please use a smaller file.")
    .refine((v) => v === "" || v.startsWith("data:image/"), "Signature must be an image file.")
    .default(""),
});

export async function updateQuoteContent(data: z.infer<typeof quoteContentSchema>) {
  await requireAdmin();
  const p = quoteContentSchema.parse(data);
  await prisma.settings.upsert({
    where: { id: "default" },
    create: { id: "default", ...p },
    update: p,
  });
  revalidatePath("/settings/quote-content");
}

// ─── Review gate & scheduled automation ──────────────────────────────

// Every field here defaults to today's behaviour in the schema, and this
// action is the only way any of them changes. The flags are read by
// lib/auto-quote.ts (driven by api/v1/cron/sweep) and by the quotation review
// gate — nothing is auto-SENT by any of them: autoQuoteEnabled produces a
// DRAFT that a human must approve.
const automationSchema = z.object({
  quoteReviewRequired: z.boolean().default(false),
  quoteReviewByOwner: z.boolean().default(true),
  autoQuoteEnabled: z.boolean().default(false),
  // A LeadStage.slug, picked from the configured stages on screen rather than
  // typed — a slug that matches no stage makes the sweep a silent no-op.
  autoQuoteOnStage: z.string().min(1).default("qualified"),
  autoQuoteRequiresZone: z.boolean().default(true),
  leadAutoAssign: z.boolean().default(false),
  // 0 disables expiry. Capped at a year: a "validity" longer than that is a
  // typo, and the number is printed on a document the customer keeps.
  quoteExpiryDays: z.number().int().nonnegative().max(365).default(0),
  // Off by default: the failure mode of a wrong allocation check is that
  // dispatch stops, which is worse than the overdraw it prevents.
  stockAllocationEnforced: z.boolean().default(false),
});

export async function updateAutomationSettings(data: z.infer<typeof automationSchema>) {
  await requireAdmin();
  const p = automationSchema.parse(data);
  await prisma.settings.upsert({
    where: { id: "default" },
    create: { id: "default", ...p },
    update: p,
  });
  revalidatePath("/settings/automation");
  revalidatePath("/quotations");
  revalidatePath("/leads");
  revalidatePath("/fulfilment");
}

// ─── Security ─────────────────────────────────────────────────────────

import bcrypt from "bcryptjs";
const passwordSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(1),
});

/**
 * Change YOUR OWN password.
 *
 * It used to load `findFirst({ where: { role: "admin" } })` and change that
 * row, which was wrong in two ways. Settings is open to managers, so a
 * manager changing "their" password was editing the owner's account — not an
 * escalation, since they still had to know the owner's current password, but
 * it meant their own password never changed and they had no way to tell. And
 * if the sole owner's role string was `owner` rather than `admin` the lookup
 * matched nobody and the page simply threw "No admin user found".
 *
 * It now operates on the session user, re-read from the database so the role
 * driving the length rule is the stored one and never the cookie's.
 */
export async function changePassword(data: z.infer<typeof passwordSchema>) {
  const session = await requireAdmin();
  const p = passwordSchema.parse(data);
  const me = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!me) throw new Error("Your account no longer exists — sign in again.");

  const ok = await bcrypt.compare(p.current, me.pinHash);
  if (!ok) throw new Error("Current password is incorrect");

  const problem = passwordProblem(me.role, p.next);
  if (problem) throw new Error(problem);
  if (p.next === p.current) throw new Error("The new password is the same as the current one.");

  await prisma.user.update({
    where: { id: me.id },
    data: { pinHash: await bcrypt.hash(p.next, 10) },
  });
}

// ─── Users & access (admin-managed) ───────────────────────────────────

// Derived from ROLES rather than re-listed, so adding a role to the
// hierarchy can never leave this behind. It already had: the dropdown
// offered `supervisor` and `owner` while this enum still named four roles,
// so saving either threw a validation error from a form that looked valid.
const roleEnum = z.enum(ROLES);

const userCreateSchema = z.object({
  name: z.string().min(1),
  // Length is checked against the ROLE below, not here: an owner or manager
  // password must be 8, a supervisor's 4, and a flat `min` cannot express
  // that.
  password: z.string().min(1),
  role: roleEnum.default("manager"),
  permissions: z.array(z.string()).default([]),
});

/**
 * Only an owner may mint or confer owner rank.
 *
 * Manager deliberately carries the same ACCESS as owner — that was the
 * decision, and nothing operational is withheld from them. But access and
 * rank are different things: the role field is the chain of command itself,
 * so a manager who could set it could promote themselves out of the
 * hierarchy, or demote the owner out of it. This is the one asymmetry, and
 * it costs managers nothing they could otherwise do.
 */
function assertMayConferRole(actorRole: string, targetRole: string) {
  // Rule itself lives in lib/roles.ts as canConferRole, so it is testable
  // without a request context and cannot drift from the permission screen's
  // own copy of it.
  if (!canConferRole(actorRole, targetRole)) {
    throw new Error("Only an owner can grant owner rank.");
  }
}

/** Likewise, only an owner may edit or remove an existing owner. */
function assertMayAdministerUser(actorRole: string, subjectRole: string) {
  if (!canAdministerUser(actorRole, subjectRole)) {
    throw new Error("Only an owner can change another owner's account.");
  }
}

/**
 * The name IS the login, so it has to be unique.
 *
 * verifyLogin() matches a typed name case-insensitively against every active
 * user and accepts the first whose password also matches. With two people
 * called "Raj" that resolves by table order: at best each signs into their
 * own account by luck, at worst one lands in the other's. Nothing in the UI
 * would show anything wrong — they would simply see someone else's leads.
 *
 * Enforced here rather than as a database constraint because the check has
 * to be case-insensitive ("Raj" and "raj" are one login to verifyLogin), and
 * a plain @unique would still admit both.
 */
async function assertNameAvailable(name: string, exceptUserId?: string) {
  const wanted = name.trim().toLowerCase();
  if (!wanted) throw new Error("A login name is required.");

  const clash = (await prisma.user.findMany({ select: { id: true, name: true, active: true } })).find(
    (u) => u.id !== exceptUserId && u.name.trim().toLowerCase() === wanted
  );
  if (clash) {
    throw new Error(
      `There is already a login called "${clash.name}"${clash.active ? "" : " (deactivated)"}. ` +
        `Login names must be different — try adding a surname or initial.`
    );
  }
}

export async function createUser(input: z.infer<typeof userCreateSchema>) {
  const session = await requireAdmin();
  const p = userCreateSchema.parse(input);
  assertMayConferRole(session.role, p.role);
  // Against the role being GRANTED, so a new owner or manager cannot be
  // created with a 4-character password.
  const problem = passwordProblem(p.role, p.password);
  if (problem) throw new Error(problem);
  await assertNameAvailable(p.name);
  await prisma.user.create({
    data: {
      name: p.name.trim(),
      pinHash: await bcrypt.hash(p.password, 10),
      role: p.role,
      // admins implicitly have everything, so we don't store per-area grants
      permissions: isFullAccess(p.role) ? [] : p.permissions,
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
  const session = await requireAdmin();
  const p = userUpdateSchema.parse(input);
  const target = await prisma.user.findUnique({ where: { id } });

  // Nobody edits their own rank or switches themselves off.
  //
  // Settings is open to managers as well as owners, and manager now carries
  // the same access as owner — so without this, a manager could simply
  // promote themselves and step outside the chain of command the owner set
  // up, which is the one thing the hierarchy exists to fix. It also stops the
  // ordinary accident of an owner deactivating the account they are signed in
  // with. Editing OTHER people is untouched; this is only about yourself.
  if (target && target.id === session.userId) {
    if (p.role !== target.role) {
      throw new Error("You can't change your own role — ask another owner to do it.");
    }
    if (!p.active) {
      throw new Error("You can't deactivate your own account.");
    }
  }

  // Rank is owner-only in both directions: a manager may not hand out owner
  // rank, and may not edit someone who already holds it.
  if (target) assertMayAdministerUser(session.role, target.role);
  assertMayConferRole(session.role, p.role);
  await assertNameAvailable(p.name, id);
  if (!target) throw new Error("User not found");
  const targetIsActiveAdmin = isOwner(target.role) && target.active;
  // Don't let the last owner be demoted or deactivated.
  //
  // Compared with isOwner() rather than the literal "admin": adminCount()
  // counts admin AND owner, so checking `p.role !== "admin"` treated
  // admin -> owner as a demotion and blocked a rename that changes nothing,
  // while leaving owner -> manager unguarded in the other direction. Manager
  // is deliberately NOT counted here — it has the same access, but an org
  // with no owner left has nobody above the managers.
  if (targetIsActiveAdmin && (!isOwner(p.role) || !p.active)) {
    if ((await adminCount(true)) <= 1) throw new Error("This is the only owner - keep at least one.");
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
    permissions: isFullAccess(p.role) ? [] : p.permissions,
    active: p.active,
  };
  // A blank field means "leave the password alone". A non-blank one is
  // checked against the role the user will HOLD after this edit — promoting
  // a supervisor to manager while leaving their 4-character password would
  // otherwise slip a weak password onto a full-access account.
  if (p.password) {
    const pwProblem = passwordProblem(p.role, p.password);
    if (pwProblem) throw new Error(pwProblem);
    data.pinHash = await bcrypt.hash(p.password, 10);
  }
  await prisma.user.update({ where: { id }, data });
  revalidatePath("/settings/users");
}

/**
 * Grant or revoke ONE area for ONE user — the permission center's only write.
 *
 * Deliberately not a call into updateUser. That one takes name, role,
 * permissions and active together, so driving a single checkbox through it
 * means the browser sends the whole user back: a stale tab would silently
 * revert a rename done elsewhere, or re-enable a login somebody just
 * disabled. This touches `permissions` and nothing else, which also means two
 * owners toggling different areas on the same user cannot clobber each other.
 *
 * Every refusal is in canSetUserAreas (lib/roles.ts) except the area-key
 * check, which belongs here because it is about the payload rather than the
 * actor: without it any string lands in `permissions`, where it is dead
 * weight that reads like a real grant on every screen that lists them.
 */
export async function setUserArea(userId: string, area: string, granted: boolean) {
  const session = await requireAdmin();

  if (!isAreaKey(area)) {
    throw new Error(`"${area}" is not an access area.`);
  }

  // Re-read the subject: the role that decides this must be the stored one,
  // never a role that arrived with the request.
  const subject = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, permissions: true },
  });
  if (!subject) throw new Error("User not found");

  const decision = canSetUserAreas(
    { userId: session.userId, role: session.role },
    { id: subject.id, role: subject.role }
  );
  if (!decision.allowed) throw new Error(decision.reason);

  // Set semantics: granting twice does not duplicate, revoking something they
  // never had is a no-op. `permissions` is an unconstrained string array, so
  // this is enforced here or not at all.
  const next = new Set(subject.permissions);
  if (granted) next.add(area);
  else next.delete(area);

  await prisma.user.update({
    where: { id: userId },
    data: { permissions: [...next] },
  });

  revalidatePath("/settings/permissions");
  revalidatePath("/settings/users");
}

export async function deleteUser(id: string) {
  const session = await requireAdmin();
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return;

  // Same self-protection as updateUser: you cannot delete yourself. Settings
  // is open to managers as well as owners, so without this a manager could
  // remove their own account mid-session and leave an orphaned session cookie
  // pointing at a user row that no longer exists.
  if (target.id === session.userId) {
    throw new Error("You can't delete your own account — ask another owner to do it.");
  }

  assertMayAdministerUser(session.role, target.role);

  // Deleting a user with history is refused outright, because the cascade is
  // worse than it looks: Task.assignedTo and DutySession cascade, so their
  // assigned work and shift record go with them. Deactivating keeps all of
  // it and still blocks sign-in, which is what "this person has left" nearly
  // always means. Delete stays available for a genuine mistake — a duplicate
  // account created minutes ago, which by definition has no history.
  const [taskCount, shiftCount, leadCount] = await Promise.all([
    prisma.task.count({ where: { assignedToId: id } }),
    prisma.dutySession.count({ where: { userId: id } }),
    prisma.lead.count({ where: { ownerUserId: id } }),
  ]);
  if (taskCount + shiftCount + leadCount > 0) {
    throw new Error(
      `${target.name} has history in the system (${taskCount} task(s), ${shiftCount} shift(s), ` +
        `${leadCount} lead(s)). Deleting would take their tasks and shift record with them — ` +
        `switch the account to inactive instead, which blocks sign-in and keeps the history.`
    );
  }

  if (isOwner(target.role)) {
    if ((await adminCount(false)) <= 1) throw new Error("Can't delete the only owner.");
  }

  // Deleting a user is destructive beyond the row itself: Task.assignedTo and
  // DutySession cascade, so their assigned work and shift history go with
  // them, while lead ownership, activity authorship and payment approvals are
  // SetNull and merely lose the name. Deactivating (active: false) keeps all
  // of it and is what the UI should steer people towards; this stays for
  // genuine mistakes like a duplicate account created minutes ago.
  await prisma.user.delete({ where: { id } });
  revalidatePath("/settings/users");
}

// ─── Lead pipeline stages ──────────────────────────────────────────────
//
// Admin-configurable Kanban columns for the leads pipeline. Never hard
// deleted (Lead.stageId and LeadStageHistory.toStageId reference it) — see
// deactivateLeadStage. `slug` is set once at creation and is not part of the
// update schema below, so there is no code path that can change it later.

function slugifyStageName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "") || "stage";
}

const leadStageSchema = z.object({
  name: z.string().min(1),
  colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value like #64748B")
    .default("#64748B"),
  isDefault: z.boolean().default(false),
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

export async function createLeadStage(input: z.infer<typeof leadStageSchema>) {
  await requireAdmin();
  const p = leadStageSchema.parse(input);

  const baseSlug = slugifyStageName(p.name);
  let slug = baseSlug;
  for (let n = 2; await prisma.leadStage.findUnique({ where: { slug } }); n++) {
    slug = `${baseSlug}-${n}`;
  }

  await prisma.$transaction(async (tx) => {
    // isDefault is exclusive — one stage answers "where an unstaged lead
    // resolves to". isWon/isLost are not exclusive; several stages may
    // legitimately count as won or lost.
    if (p.isDefault) {
      await tx.leadStage.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }
    await tx.leadStage.create({
      data: {
        name: p.name.trim(),
        slug,
        colour: p.colour,
        isDefault: p.isDefault,
        isWon: p.isWon,
        isLost: p.isLost,
        sortOrder: p.sortOrder,
      },
    });
  });
  revalidatePath("/settings/lead-stages");
  revalidatePath("/leads/board");
}

export async function updateLeadStage(id: string, input: z.infer<typeof leadStageSchema>) {
  await requireAdmin();
  const p = leadStageSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    if (p.isDefault) {
      await tx.leadStage.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    await tx.leadStage.update({
      where: { id },
      data: {
        name: p.name.trim(),
        colour: p.colour,
        isDefault: p.isDefault,
        isWon: p.isWon,
        isLost: p.isLost,
        sortOrder: p.sortOrder,
      },
    });
  });
  revalidatePath("/settings/lead-stages");
  revalidatePath("/leads/board");
}

/**
 * Soft-deactivate a stage. Guards are re-checked INSIDE the transaction
 * (not just as a pre-check) for the same reason convertLeadCore's claim
 * guard is — a concurrent admin action could otherwise invalidate a
 * pre-check between the read and the write:
 *
 *   1. block if this is the only active stage
 *   2. block if it's the active default and no other active default exists
 *   3. block if it's isWon/isLost and no other active one of that kind exists
 *   4. if leads still reference it, destinationStageId is required (and must
 *      be a different, active stage) — reassign them + write one
 *      LeadStageHistory row per lead, syncing quotationStage when the
 *      destination is won/lost
 *   5. finally mark it inactive
 */
export async function deactivateLeadStage(id: string, destinationStageId?: string | null) {
  await requireAdmin();
  const session = await getSession();

  await prisma.$transaction(async (tx) => {
    const stage = await tx.leadStage.findUnique({ where: { id } });
    if (!stage) throw new Error("Stage not found.");
    if (!stage.isActive) return;

    const activeCount = await tx.leadStage.count({ where: { isActive: true } });
    if (activeCount <= 1) throw new Error("Can't deactivate the only active stage.");

    if (stage.isDefault) {
      const otherDefault = await tx.leadStage.count({
        where: { isActive: true, isDefault: true, NOT: { id } },
      });
      if (otherDefault === 0) {
        throw new Error("Set another stage as default before deactivating this one.");
      }
    }
    if (stage.isWon) {
      const otherWon = await tx.leadStage.count({ where: { isActive: true, isWon: true, NOT: { id } } });
      if (otherWon === 0) throw new Error('Can\'t deactivate the only "won" stage.');
    }
    if (stage.isLost) {
      const otherLost = await tx.leadStage.count({ where: { isActive: true, isLost: true, NOT: { id } } });
      if (otherLost === 0) throw new Error('Can\'t deactivate the only "lost" stage.');
    }

    const leadsOnStage = await tx.lead.findMany({ where: { stageId: id }, select: { id: true } });
    if (leadsOnStage.length > 0) {
      if (!destinationStageId || destinationStageId === id) {
        throw new Error(
          `${leadsOnStage.length} lead(s) are on this stage — pick a different destination stage to move them to first.`
        );
      }
      const destination = await tx.leadStage.findUnique({ where: { id: destinationStageId } });
      if (!destination || !destination.isActive) {
        throw new Error("Destination stage must be an active stage.");
      }

      const now = new Date();
      const derivedQuotationStage = destination.isWon ? "won" : destination.isLost ? "lost" : undefined;

      await tx.lead.updateMany({
        where: { id: { in: leadsOnStage.map((l) => l.id) } },
        data: {
          stageId: destination.id,
          stageEnteredAt: now,
          ...(derivedQuotationStage ? { quotationStage: derivedQuotationStage } : {}),
        },
      });
      await tx.leadStageHistory.createMany({
        data: leadsOnStage.map((l) => ({
          leadId: l.id,
          fromStageId: id,
          toStageId: destination.id,
          changedBy: session?.userId ?? null,
          note: "Stage deactivated — leads reassigned",
        })),
      });
      if (!destination.isWon && !destination.isLost) {
        for (const l of leadsOnStage) {
          await triggerWaSequencesForStage(tx, l.id, destination.id);
        }
      }
    }

    await tx.leadStage.update({ where: { id }, data: { isActive: false } });
  });

  revalidatePath("/settings/lead-stages");
  revalidatePath("/leads");
  revalidatePath("/leads/board");
}

export async function reactivateLeadStage(id: string) {
  await requireAdmin();
  await prisma.$transaction(async (tx) => {
    const stage = await tx.leadStage.findUnique({ where: { id } });
    if (!stage) throw new Error("Stage not found.");
    if (stage.isActive) return;
    // Carried over from before it was deactivated — enforce the same
    // exclusivity create/update apply, so reactivating a stage that was
    // default before can't produce two simultaneously-active defaults.
    if (stage.isDefault) {
      await tx.leadStage.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    await tx.leadStage.update({ where: { id }, data: { isActive: true } });
  });
  revalidatePath("/settings/lead-stages");
  revalidatePath("/leads/board");
}
