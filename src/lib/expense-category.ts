import { prisma } from "./db";

// Resolve an expense category by name for the auto-booked expenses (transport
// charges, die purchases, tipper dues). The category list is admin-editable, so
// a name may have been renamed or deleted — create it rather than fail the
// operation the user actually asked for.
export async function categoryIdByName(name: string, order = 50) {
  const existing = await prisma.expenseCategory.findUnique({ where: { name } });
  if (existing) return existing.id;
  const created = await prisma.expenseCategory.create({ data: { name, order } });
  return created.id;
}
