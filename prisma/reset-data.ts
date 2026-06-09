/**
 * Reset all OPERATIONAL data to zero while keeping setup/master data.
 *
 * KEEPS: User, Client, Operator, Mason, Loader, Employee, Vendor, Tipper,
 *        BrickSize, ConstructionType, BrickPrice, ExpenseCategory, Material,
 *        MaterialRecipe, Machine, Settings.
 * CLEARS: production, stock batches, deliveries, orders, client payments,
 *         expenses, tipper loads, mason/loading work, payroll, attendance,
 *         advances, cashbook. Also zeroes MaterialStock.quantity and
 *         Settings.cashOpening.
 *
 * Run: npx tsx prisma/reset-data.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Counting current operational rows…");
  const before = {
    production: await prisma.productionEntry.count(),
    stockBatch: await prisma.stockBatch.count(),
    orders: await prisma.order.count(),
    deliveries: await prisma.delivery.count(),
    clientPayments: await prisma.clientPayment.count(),
    expenses: await prisma.expense.count(),
    tipperLoads: await prisma.tipperLoad.count(),
    masonWork: await prisma.masonWork.count(),
    loadingWork: await prisma.loadingWork.count(),
    payouts: await prisma.employeePayout.count(),
    attendance: await prisma.employeeAttendance.count(),
    advances: await prisma.advance.count(),
    cashEntries: await prisma.cashEntry.count(),
  };
  console.table(before);

  // Delete children before parents to satisfy foreign keys.
  await prisma.$transaction([
    prisma.productionShare.deleteMany({}),
    prisma.stockBatch.deleteMany({}),
    prisma.productionEntry.deleteMany({}),

    prisma.deliveryReturn.deleteMany({}),
    prisma.deliveryAddOn.deleteMany({}),
    prisma.deliveryItem.deleteMany({}),
    prisma.delivery.deleteMany({}),

    prisma.orderItem.deleteMany({}),
    prisma.clientPayment.deleteMany({}),
    prisma.order.deleteMany({}),

    prisma.masonWork.deleteMany({}),
    prisma.loadingWork.deleteMany({}),
    prisma.tipperLoad.deleteMany({}),

    prisma.expense.deleteMany({}),
    prisma.employeePayout.deleteMany({}),
    prisma.employeeAttendance.deleteMany({}),
    prisma.advance.deleteMany({}),

    // Cashbook last — everything above references it.
    prisma.cashEntry.deleteMany({}),

    // Zero out running balances kept on master rows.
    prisma.materialStock.updateMany({ data: { quantity: 0 } }),
    prisma.settings.updateMany({ data: { cashOpening: 0 } }),
  ]);

  console.log("\nDone. Verifying everything is at zero…");
  const after = {
    production: await prisma.productionEntry.count(),
    stockBatch: await prisma.stockBatch.count(),
    orders: await prisma.order.count(),
    deliveries: await prisma.delivery.count(),
    clientPayments: await prisma.clientPayment.count(),
    expenses: await prisma.expense.count(),
    tipperLoads: await prisma.tipperLoad.count(),
    masonWork: await prisma.masonWork.count(),
    loadingWork: await prisma.loadingWork.count(),
    payouts: await prisma.employeePayout.count(),
    attendance: await prisma.employeeAttendance.count(),
    advances: await prisma.advance.count(),
    cashEntries: await prisma.cashEntry.count(),
  };
  console.table(after);

  const kept = {
    users: await prisma.user.count(),
    clients: await prisma.client.count(),
    operators: await prisma.operator.count(),
    masons: await prisma.mason.count(),
    loaders: await prisma.loader.count(),
    employees: await prisma.employee.count(),
    vendors: await prisma.vendor.count(),
    tippers: await prisma.tipper.count(),
    brickSizes: await prisma.brickSize.count(),
    constructionTypes: await prisma.constructionType.count(),
    prices: await prisma.brickPrice.count(),
  };
  console.log("\nKept (setup/master) — should be unchanged:");
  console.table(kept);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
