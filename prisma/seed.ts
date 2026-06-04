import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function daysAgo(n: number) {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

async function main() {
  console.log("Seeding RD Interlock Bricks…");

  // wipe (children first)
  await prisma.materialStock.deleteMany().catch(() => {});
  await prisma.materialRecipe.deleteMany().catch(() => {});
  await prisma.cashEntry.deleteMany();
  await prisma.advance.deleteMany();
  await prisma.employeeAttendance.deleteMany();
  await prisma.employeePayout.deleteMany();
  await prisma.deliveryReturn.deleteMany();
  await prisma.deliveryAddOn.deleteMany();
  await prisma.deliveryItem.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.clientPayment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.client.deleteMany();
  await prisma.loadingWork.deleteMany();
  await prisma.masonWork.deleteMany();
  await prisma.tipperLoad.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.productionShare.deleteMany();
  await prisma.stockBatch.deleteMany();
  await prisma.productionEntry.deleteMany();
  await prisma.tipper.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.loader.deleteMany();
  await prisma.mason.deleteMany();
  await prisma.operator.deleteMany();
  await prisma.brickPrice.deleteMany();
  await prisma.constructionType.deleteMany();
  await prisma.machine.deleteMany().catch(() => {});
  await prisma.brickSize.deleteMany();
  await prisma.material.deleteMany();
  await prisma.expenseCategory.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();

  // Auth
  const password = process.env.DEFAULT_PASSWORD ?? "Admin@123";
  await prisma.user.create({
    data: { name: "Admin", pinHash: await bcrypt.hash(password, 10), role: "admin" },
  });

  await prisma.settings.create({
    data: {
      id: "default",
      factoryName: "RD Interlock Bricks",
      ownerName: "Admin",
      address: "Erode, Tamil Nadu",
      phone: "",
      cementBagsPer1000: 18,
      cashOpening: 50000,
      dayShiftRate: 2.5,
      nightShiftRate: 3.0,
    },
  });

  // Machines
  const machineA = await prisma.machine.create({ data: { name: "Machine A", order: 1 } });
  const machineB = await prisma.machine.create({ data: { name: "Machine B", order: 2 } });
  await prisma.machine.create({ data: { name: "Machine C", order: 3 } });

  // Brick sizes
  const size6 = await prisma.brickSize.create({ data: { label: '6"', order: 1 } });
  const size6h = await prisma.brickSize.create({ data: { label: '6"H', order: 2 } });
  const size8 = await prisma.brickSize.create({ data: { label: '8"', order: 3 } });

  // Construction types (admin can add more)
  const room = await prisma.constructionType.create({ data: { name: "Room", order: 1 } });
  const compound = await prisma.constructionType.create({
    data: { name: "Compound", order: 2 },
  });
  const godown = await prisma.constructionType.create({ data: { name: "Godown", order: 3 } });

  // Pricing matrix
  const matrix: Array<[string, string, number, number, number]> = [
    // [sizeId, ctypeId, sellPrice, masonRate, productionCost]
    [size6.id, room.id, 9, 9, 4.0],
    [size6.id, compound.id, 7, 7, 4.0],
    [size6.id, godown.id, 8, 8, 4.0],
    [size6h.id, room.id, 11, 10, 5.0],
    [size6h.id, compound.id, 9, 8, 5.0],
    [size6h.id, godown.id, 10, 9, 5.0],
    [size8.id, room.id, 12, 10, 6.0],
    [size8.id, compound.id, 9, 8, 6.0],
    [size8.id, godown.id, 11, 9, 6.0],
  ];
  for (const [bsId, ctId, sell, mason, cost] of matrix) {
    await prisma.brickPrice.create({
      data: {
        brickSizeId: bsId,
        constructionTypeId: ctId,
        sellPrice: sell,
        masonRate: mason,
        productionCost: cost,
      },
    });
  }

  // Expense categories (from customer's notes)
  for (const [name, order] of [
    ["Cement", 1],
    ["Flyash", 2],
    ["Powder", 3],
    ["Chips", 4],
    ["Admixer", 5],
    ["Sludge", 6],
    ["Diesel", 7],
    ["Oil", 8],
    ["Spares", 9],
    ["Bearings", 10],
    ["Mould (Die)", 11],
    ["PLC elements", 12],
    ["Welding", 13],
    ["Bolts & Nuts", 14],
    ["Lathe", 15],
    ["EB (Electricity)", 16],
    ["Land Rent", 17],
    ["Site Visit", 18],
    ["Gas", 19],
    ["Rice", 20],
    ["Gloves", 21],
    ["Tea", 22],
    ["Wifi", 23],
    ["Salary", 24],
    ["Bonus", 25],
    ["EMI", 26],
    ["Other", 99],
  ] as [string, number][]) {
    await prisma.expenseCategory.create({ data: { name, order } });
  }

  // Materials
  const materials: Record<string, { id: string }> = {};
  for (const [name, unit, order] of [
    ["Cement", "bag", 1],
    ["Flyash", "kg", 2],
    ["Powder", "ton", 3],
    ["Chips", "kg", 4],
    ["Admixer", "ltr", 5],
    ["Sludge", "nos", 6],
  ] as [string, string, number][]) {
    const m = await prisma.material.create({ data: { name, unit, order } });
    materials[name] = m;
  }

  // Material recipes — per 1000 bricks of each size
  // Example from customer's diary: 1000 bricks of 6" → 16.7 cement bags, 2400kg flyash, 9000kg powder
  await prisma.materialRecipe.createMany({
    data: [
      // 6" bricks
      { brickSizeId: size6.id, materialId: materials.Cement.id, qtyPer1000: 16.7 },
      { brickSizeId: size6.id, materialId: materials.Flyash.id, qtyPer1000: 2400 },
      { brickSizeId: size6.id, materialId: materials.Powder.id, qtyPer1000: 9.0 }, // 9 tons
      // 6"H
      { brickSizeId: size6h.id, materialId: materials.Cement.id, qtyPer1000: 17.5 },
      { brickSizeId: size6h.id, materialId: materials.Flyash.id, qtyPer1000: 2500 },
      { brickSizeId: size6h.id, materialId: materials.Powder.id, qtyPer1000: 9.5 },
      // 8" bricks
      { brickSizeId: size8.id, materialId: materials.Cement.id, qtyPer1000: 18 },
      { brickSizeId: size8.id, materialId: materials.Flyash.id, qtyPer1000: 2600 },
      { brickSizeId: size8.id, materialId: materials.Powder.id, qtyPer1000: 10 },
    ],
  });

  // Material stock with reorder threshold
  await prisma.materialStock.createMany({
    data: [
      { materialId: materials.Cement.id, quantity: 250, reorderAt: 50 },
      { materialId: materials.Flyash.id, quantity: 12000, reorderAt: 2000 },
      { materialId: materials.Powder.id, quantity: 35, reorderAt: 10 },
      { materialId: materials.Chips.id, quantity: 5000, reorderAt: 1000 },
      { materialId: materials.Admixer.id, quantity: 100, reorderAt: 20 },
      { materialId: materials.Sludge.id, quantity: 8, reorderAt: 2 },
    ],
  });

  // Operators
  const operators = await Promise.all(
    [
      { name: "Dula", phone: "9876543210" },
      { name: "Ashok", phone: "9876543211" },
      { name: "Kumari", phone: "9876543212" },
      { name: "Nathram", phone: "9876543213" },
    ].map((d) => prisma.operator.create({ data: d }))
  );

  // Masons
  const masons = await Promise.all(
    [
      { name: "Vijay", phone: "9811001100" },
      { name: "Suresh", phone: "9811001101" },
      { name: "Ravi", phone: "9811001102" },
    ].map((d) => prisma.mason.create({ data: d }))
  );

  // Loaders
  const loaders = await Promise.all(
    [
      { name: "Lal Singh", phone: "9722003000" },
      { name: "Mohan", phone: "9722003001" },
    ].map((d) => prisma.loader.create({ data: d }))
  );

  // Employees
  const employees = await Promise.all([
    prisma.employee.create({
      data: { name: "Rajesh (Driver)", role: "driver", payType: "daily", payRate: 800 },
    }),
    prisma.employee.create({
      data: { name: "Watchman", role: "watchman", payType: "monthly", payRate: 12000 },
    }),
  ]);

  // Vendors & Tippers
  const avm = await prisma.vendor.create({ data: { name: "AVM", phone: "9001112222" } });
  const rdTipper = await prisma.tipper.create({
    data: { name: "RD Tipper", plate: "TN-33 BX 4218", ownership: "own", emiAmount: 28000 },
  });
  const avmTipper = await prisma.tipper.create({
    data: { name: "AVM Tipper", plate: "TN-33 BV 8810", ownership: "vendor", vendorId: avm.id },
  });

  // Clients
  const raja = await prisma.client.create({
    data: { name: "Raja", location: "Salem", phone: "9100001000" },
  });
  const sureshBuilders = await prisma.client.create({
    data: { name: "Suresh Builders", location: "Erode", phone: "9100002000" },
  });
  const manjit = await prisma.client.create({
    data: { name: "Manjit Singh", location: "Bhavani", phone: "9100003000" },
  });

  // Some production for the past week
  for (let d = 6; d >= 0; d--) {
    const date = daysAgo(d);
    const count = 800 + Math.floor(Math.random() * 400);
    const rate = 2.5;
    const total = count * rate;
    const entry = await prisma.productionEntry.create({
      data: {
        date,
        shift: d % 2 === 0 ? "day" : "night",
        machineId: d % 2 === 0 ? machineA.id : machineB.id,
        brickSizeId: size6.id,
        cementBagsUsed: Math.round((count / 1000) * 18 * 10) / 10,
        brickCount: count,
        damagedCount: Math.floor(Math.random() * 30),
        ratePerBrick: rate,
        totalWage: total,
      },
    });
    // Split equally between operators
    const share = total / operators.length;
    for (const op of operators) {
      await prisma.productionShare.create({
        data: { productionEntryId: entry.id, operatorId: op.id, amount: share },
      });
    }
    // Stock batch
    await prisma.stockBatch.create({
      data: {
        code: `B-${String(d).padStart(3, "0")}`,
        brickSizeId: size6.id,
        productionEntryId: entry.id,
        count,
        remaining: count,
        stage: d === 0 ? "produced" : d <= 2 ? "drying" : d <= 5 ? "curing" : "ready",
        producedAt: date,
        stageChangedAt: daysAgo(Math.max(0, d - 1)),
      },
    });
  }

  // Sample expenses
  const cementCat = await prisma.expenseCategory.findUnique({ where: { name: "Cement" } });
  const dieselCat = await prisma.expenseCategory.findUnique({ where: { name: "Diesel" } });
  const ebCat = await prisma.expenseCategory.findUnique({ where: { name: "EB (Electricity)" } });
  if (cementCat && dieselCat && ebCat) {
    await prisma.$transaction([
      prisma.cashEntry.create({
        data: {
          date: daysAgo(2),
          amount: 8500,
          direction: "out",
          source: "expense",
          category: "Cement",
          title: "Cement — 25 bags",
          notes: "₹340/bag",
          method: "cash",
          expense: {
            create: {
              date: daysAgo(2),
              categoryId: cementCat.id,
              title: "Cement — 25 bags",
              amount: 8500,
              notes: "₹340/bag",
            },
          },
        },
      }),
      prisma.cashEntry.create({
        data: {
          date: daysAgo(1),
          amount: 5700,
          direction: "out",
          source: "expense",
          category: "Diesel",
          title: "Diesel — RD Tipper",
          notes: "60 L",
          method: "cash",
          expense: {
            create: {
              date: daysAgo(1),
              categoryId: dieselCat.id,
              title: "Diesel — RD Tipper",
              amount: 5700,
              notes: "60 L",
              tipperId: rdTipper.id,
            },
          },
        },
      }),
      prisma.cashEntry.create({
        data: {
          date: daysAgo(3),
          amount: 14200,
          direction: "out",
          source: "expense",
          category: "EB (Electricity)",
          title: "Electricity bill",
          method: "bank",
          expense: {
            create: {
              date: daysAgo(3),
              categoryId: ebCat.id,
              title: "Electricity bill",
              amount: 14200,
            },
          },
        },
      }),
    ]);
  }

  // Sample order with one delivery + payment
  const order = await prisma.order.create({
    data: {
      clientId: sureshBuilders.id,
      date: daysAgo(2),
      expectedDeliveryDate: new Date(),
      status: "partial",
      items: {
        create: [
          {
            brickSizeId: size6.id,
            constructionTypeId: room.id,
            quantity: 2500,
            pricePerBrick: 9,
            total: 22500,
          },
        ],
      },
    },
  });
  const delivery = await prisma.delivery.create({
    data: {
      orderId: order.id,
      date: daysAgo(0),
      truckPlate: "TN-33 BX 4218",
      items: {
        create: [
          {
            brickSizeId: size6.id,
            constructionTypeId: room.id,
            quantity: 1000,
            pricePerBrick: 9,
            total: 9000,
          },
        ],
      },
    },
  });
  await prisma.cashEntry.create({
    data: {
      date: daysAgo(0),
      amount: 5000,
      direction: "in",
      source: "sale",
      category: "Sales",
      title: `${sureshBuilders.name} — partial payment`,
      method: "gpay",
      clientPayment: {
        create: {
          clientId: sureshBuilders.id,
          orderId: order.id,
          date: daysAgo(0),
          amount: 5000,
          method: "gpay",
        },
      },
    },
  });

  // Sample tipper load (RD delivering bricks)
  await prisma.tipperLoad.create({
    data: {
      date: daysAgo(0),
      tipperId: rdTipper.id,
      loadType: "bricks",
      brickSizeId: size6.id,
      quantity: 1000,
      unit: "pcs",
      fromLocation: "Factory",
      toLocation: "Erode",
      rentAmount: 0,
      rentDirection: "in",
      notes: "Own delivery",
    },
  });
  // AVM tipper load with rent paid out
  await prisma.cashEntry.create({
    data: {
      date: daysAgo(1),
      amount: 6000,
      direction: "out",
      source: "tipper",
      category: "Tipper rent",
      title: "AVM Tipper — Salem load",
      method: "cash",
      tipperLoad: {
        create: {
          date: daysAgo(1),
          tipperId: avmTipper.id,
          vendorId: avm.id,
          loadType: "bricks",
          brickSizeId: size6.id,
          quantity: 1000,
          fromLocation: "Factory",
          toLocation: "Salem",
          rentAmount: 6000,
          rentDirection: "out",
        },
      },
    },
  });

  // Sample mason work
  await prisma.masonWork.create({
    data: {
      date: daysAgo(1),
      masonId: masons[0].id,
      siteName: "Salem (Raja)",
      brickSizeId: size6.id,
      constructionTypeId: room.id,
      brickCount: 1000,
      ratePerBrick: 9,
      totalAmount: 9000,
    },
  });

  // Sample loading work
  await prisma.loadingWork.create({
    data: {
      date: daysAgo(0),
      loaderId: loaders[0].id,
      brickSizeId: size6.id,
      brickCount: 1000,
      ratePerBrick: 0.5,
      totalAmount: 500,
    },
  });

  // Sample advance for an operator
  await prisma.cashEntry.create({
    data: {
      date: daysAgo(2),
      amount: 2000,
      direction: "out",
      source: "advance",
      category: "Operator advance",
      title: `${operators[0].name} — advance`,
      method: "cash",
      advance: {
        create: {
          date: daysAgo(2),
          personType: "operator",
          operatorId: operators[0].id,
          amount: 2000,
          notes: "Family",
        },
      },
    },
  });

  // Sample employee attendance for today
  for (const emp of employees) {
    await prisma.employeeAttendance.upsert({
      where: { date_employeeId: { date: daysAgo(0), employeeId: emp.id } },
      update: { status: "present" },
      create: { date: daysAgo(0), employeeId: emp.id, status: "present" },
    });
  }

  console.log("✓ Seed complete");
  console.log(`  Login: Admin / ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
