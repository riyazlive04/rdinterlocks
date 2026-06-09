"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";

// ─── Clients ──────────────────────────────────────────────────────────

const clientSchema = z.object({
  name: z.string().min(1),
  location: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
});

export async function createClient(input: z.infer<typeof clientSchema>) {
  const p = clientSchema.parse(input);
  const c = await prisma.client.create({
    data: {
      name: p.name.trim(),
      location: p.location?.trim() || null,
      phone: p.phone?.trim() || null,
      notes: p.notes?.trim() || null,
    },
  });
  revalidatePath("/clients");
  return c;
}

// Create a client and, if they pay an opening advance at the same time,
// record it as an unallocated client payment (cash in). Matches the owner's
// workflow of "add a new client the moment they pay an advance".
const clientWithAdvanceSchema = clientSchema.extend({
  advance: z.number().nonnegative().default(0),
  advanceMethod: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
  advanceDate: z.string().optional(),
});

export async function createClientWithAdvance(
  input: z.infer<typeof clientWithAdvanceSchema>
) {
  const p = clientWithAdvanceSchema.parse(input);
  const c = await prisma.client.create({
    data: {
      name: p.name.trim(),
      location: p.location?.trim() || null,
      phone: p.phone?.trim() || null,
      notes: p.notes?.trim() || null,
    },
  });
  if (p.advance > 0) {
    const date = p.advanceDate ? new Date(p.advanceDate) : new Date();
    await prisma.cashEntry.create({
      data: {
        date,
        amount: p.advance,
        direction: "in",
        source: "sale",
        category: "Advance from client",
        title: `${c.name} - opening advance`,
        method: p.advanceMethod,
        clientPayment: {
          create: {
            clientId: c.id,
            orderId: null,
            date,
            amount: p.advance,
            method: p.advanceMethod,
            notes: "Opening advance",
          },
        },
      },
    });
  }
  revalidatePath("/clients");
  revalidatePath("/cash");
  return c;
}

export async function updateClient(id: string, input: z.infer<typeof clientSchema>) {
  const p = clientSchema.parse(input);
  await prisma.client.update({
    where: { id },
    data: {
      name: p.name.trim(),
      location: p.location?.trim() || null,
      phone: p.phone?.trim() || null,
      notes: p.notes?.trim() || null,
    },
  });
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

export async function deleteClient(id: string) {
  await prisma.client.update({ where: { id }, data: { active: false } });
  revalidatePath("/clients");
}

// ─── Orders ───────────────────────────────────────────────────────────

const orderItemSchema = z.object({
  brickSizeId: z.string(),
  constructionTypeId: z.string(),
  quantity: z.number().int().positive(),
  pricePerBrick: z.number().positive(),
});

const orderSchema = z.object({
  clientId: z.string().min(1),
  date: z.string(),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(orderItemSchema).min(1),
  advance: z.number().nonnegative().default(0),
  advanceMethod: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
});

export async function createOrder(input: z.infer<typeof orderSchema>) {
  const p = orderSchema.parse(input);
  const date = new Date(p.date);
  const expected = p.expectedDeliveryDate ? new Date(p.expectedDeliveryDate) : null;

  const order = await prisma.order.create({
    data: {
      clientId: p.clientId,
      date,
      expectedDeliveryDate: expected,
      notes: p.notes,
      items: {
        create: p.items.map((it) => ({
          brickSizeId: it.brickSizeId,
          constructionTypeId: it.constructionTypeId,
          quantity: it.quantity,
          pricePerBrick: it.pricePerBrick,
          total: it.quantity * it.pricePerBrick,
        })),
      },
    },
    include: { client: true },
  });

  if (p.advance > 0) {
    await prisma.cashEntry.create({
      data: {
        date,
        amount: p.advance,
        direction: "in",
        source: "sale",
        category: "Advance from client",
        title: `${order.client.name} - order advance`,
        method: p.advanceMethod,
        clientPayment: {
          create: {
            clientId: p.clientId,
            orderId: order.id,
            date,
            amount: p.advance,
            method: p.advanceMethod,
            notes: "Order advance",
          },
        },
      },
    });
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${p.clientId}`);
  revalidatePath("/cash");
  redirect(`/clients/${p.clientId}`);
}

// Edit an order: update its fields and replace its line items. Advance /
// payments are separate cash entries and are left untouched here (edit those
// from the cash book / payments). Order status is recomputed against deliveries.
const orderEditSchema = z.object({
  date: z.string(),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(orderItemSchema).min(1),
});

export async function updateOrder(id: string, input: z.infer<typeof orderEditSchema>) {
  const p = orderEditSchema.parse(input);
  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) throw new Error("Order not found");
  const date = new Date(p.date);
  const expected = p.expectedDeliveryDate ? new Date(p.expectedDeliveryDate) : null;

  await prisma.$transaction([
    prisma.orderItem.deleteMany({ where: { orderId: id } }),
    prisma.order.update({
      where: { id },
      data: {
        date,
        expectedDeliveryDate: expected,
        notes: p.notes,
        items: {
          create: p.items.map((it) => ({
            brickSizeId: it.brickSizeId,
            constructionTypeId: it.constructionTypeId,
            quantity: it.quantity,
            pricePerBrick: it.pricePerBrick,
            total: it.quantity * it.pricePerBrick,
          })),
        },
      },
    }),
  ]);

  await recomputeOrderStatus(id);
  revalidatePath("/clients");
  revalidatePath(`/clients/${existing.clientId}`);
  redirect(`/clients/${existing.clientId}`);
}

export async function deleteOrder(id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: { payments: true, deliveries: true },
  });
  if (!order) return;
  // Remove payments + their cash entries
  for (const pay of order.payments) {
    if (pay.cashEntryId) await prisma.cashEntry.delete({ where: { id: pay.cashEntryId } });
  }
  await prisma.order.delete({ where: { id } });
  revalidatePath("/clients");
  if (order) revalidatePath(`/clients/${order.clientId}`);
}

// ─── Deliveries (with add-ons + returns) ──────────────────────────────

const deliveryItemSchema = z.object({
  brickSizeId: z.string(),
  constructionTypeId: z.string(),
  quantity: z.number().int().positive(),
  pricePerBrick: z.number().positive(),
});

const deliveryAddOnSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().default("unit"),
  pricePerUnit: z.number().nonnegative(),
});

const returnSchema = z.object({
  brickCount: z.number().int().positive(),
  refundAmount: z.number().nonnegative(),
  notes: z.string().optional(),
});

const deliverySchema = z.object({
  orderId: z.string().min(1),
  date: z.string(),
  truckPlate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(deliveryItemSchema).min(1),
  addOns: z.array(deliveryAddOnSchema).default([]),
  returns: z.array(returnSchema).default([]),
  paymentReceived: z.number().nonnegative().default(0),
  paymentMethod: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
});

export async function createDelivery(input: z.infer<typeof deliverySchema>) {
  const p = deliverySchema.parse(input);
  const date = new Date(p.date);
  const order = await prisma.order.findUnique({
    where: { id: p.orderId },
    include: { client: true },
  });
  if (!order) throw new Error("Order not found");

  await prisma.delivery.create({
    data: {
      orderId: p.orderId,
      date,
      truckPlate: p.truckPlate?.trim() || null,
      notes: p.notes,
      items: {
        create: p.items.map((it) => ({
          brickSizeId: it.brickSizeId,
          constructionTypeId: it.constructionTypeId,
          quantity: it.quantity,
          pricePerBrick: it.pricePerBrick,
          total: it.quantity * it.pricePerBrick,
        })),
      },
      addOns: p.addOns.length
        ? {
            create: p.addOns.map((a) => ({
              name: a.name,
              quantity: a.quantity,
              unit: a.unit,
              pricePerUnit: a.pricePerUnit,
              total: a.quantity * a.pricePerUnit,
            })),
          }
        : undefined,
      returns: p.returns.length
        ? {
            create: p.returns.map((r) => ({
              brickCount: r.brickCount,
              refundAmount: r.refundAmount,
              notes: r.notes,
            })),
          }
        : undefined,
    },
  });

  if (p.paymentReceived > 0) {
    await prisma.cashEntry.create({
      data: {
        date,
        amount: p.paymentReceived,
        direction: "in",
        source: "sale",
        category: "Sales",
        title: `${order.client.name} - payment`,
        method: p.paymentMethod,
        clientPayment: {
          create: {
            clientId: order.clientId,
            orderId: p.orderId,
            date,
            amount: p.paymentReceived,
            method: p.paymentMethod,
            notes: "Delivery payment",
          },
        },
      },
    });
  }

  // Update order status
  await recomputeOrderStatus(p.orderId);

  revalidatePath("/clients");
  revalidatePath(`/clients/${order.clientId}`);
  revalidatePath("/cash");
  redirect(`/clients/${order.clientId}`);
}

// Edit a delivery: update fields and replace its items / add-ons / returns.
// The payment recorded at delivery time is a separate cash entry and is left
// untouched (edit it from the cash book). Order status is recomputed.
const deliveryEditSchema = z.object({
  date: z.string(),
  truckPlate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(deliveryItemSchema).min(1),
  addOns: z.array(deliveryAddOnSchema).default([]),
  returns: z.array(returnSchema).default([]),
});

export async function updateDelivery(id: string, input: z.infer<typeof deliveryEditSchema>) {
  const p = deliveryEditSchema.parse(input);
  const existing = await prisma.delivery.findUnique({
    where: { id },
    include: { order: true },
  });
  if (!existing) throw new Error("Delivery not found");
  const date = new Date(p.date);

  await prisma.$transaction([
    prisma.deliveryItem.deleteMany({ where: { deliveryId: id } }),
    prisma.deliveryAddOn.deleteMany({ where: { deliveryId: id } }),
    prisma.deliveryReturn.deleteMany({ where: { deliveryId: id } }),
    prisma.delivery.update({
      where: { id },
      data: {
        date,
        truckPlate: p.truckPlate?.trim() || null,
        notes: p.notes,
        items: {
          create: p.items.map((it) => ({
            brickSizeId: it.brickSizeId,
            constructionTypeId: it.constructionTypeId,
            quantity: it.quantity,
            pricePerBrick: it.pricePerBrick,
            total: it.quantity * it.pricePerBrick,
          })),
        },
        addOns: p.addOns.length
          ? {
              create: p.addOns.map((a) => ({
                name: a.name,
                quantity: a.quantity,
                unit: a.unit,
                pricePerUnit: a.pricePerUnit,
                total: a.quantity * a.pricePerUnit,
              })),
            }
          : undefined,
        returns: p.returns.length
          ? {
              create: p.returns.map((r) => ({
                brickCount: r.brickCount,
                refundAmount: r.refundAmount,
                notes: r.notes,
              })),
            }
          : undefined,
      },
    }),
  ]);

  await recomputeOrderStatus(existing.orderId);
  revalidatePath("/clients");
  revalidatePath(`/clients/${existing.order.clientId}`);
  redirect(`/clients/${existing.order.clientId}`);
}

// Mark (or unmark) a delivery as done — used by the evening deliveries review.
export async function setDeliveryDone(id: string, done: boolean) {
  await prisma.delivery.update({
    where: { id },
    data: { completedAt: done ? new Date() : null },
  });
  revalidatePath("/deliveries");
}

export async function deleteDelivery(id: string) {
  const d = await prisma.delivery.findUnique({ where: { id }, include: { order: true } });
  if (!d) return;
  await prisma.delivery.delete({ where: { id } });
  await recomputeOrderStatus(d.orderId);
  revalidatePath(`/clients/${d.order.clientId}`);
}

async function recomputeOrderStatus(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, deliveries: { include: { items: true, returns: true } } },
  });
  if (!order) return;
  const orderedQty = order.items.reduce((s, i) => s + i.quantity, 0);
  let deliveredQty = 0;
  for (const d of order.deliveries) {
    deliveredQty += d.items.reduce((s, i) => s + i.quantity, 0);
    deliveredQty -= d.returns.reduce((s, r) => s + r.brickCount, 0);
  }
  const status =
    deliveredQty >= orderedQty ? "complete" : deliveredQty > 0 ? "partial" : "open";
  await prisma.order.update({ where: { id: orderId }, data: { status } });
}

// ─── Payments ─────────────────────────────────────────────────────────

const paymentSchema = z.object({
  clientId: z.string().min(1),
  orderId: z.string().optional(),
  date: z.string(),
  amount: z.number().positive(),
  method: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
  notes: z.string().optional(),
});

export async function recordPayment(input: z.infer<typeof paymentSchema>) {
  const p = paymentSchema.parse(input);
  const client = await prisma.client.findUnique({ where: { id: p.clientId } });
  if (!client) throw new Error("Client not found");
  const date = new Date(p.date);
  await prisma.cashEntry.create({
    data: {
      date,
      amount: p.amount,
      direction: "in",
      source: "sale",
      category: "Client payment",
      title: `${client.name} - payment`,
      notes: p.notes,
      method: p.method,
      clientPayment: {
        create: {
          clientId: p.clientId,
          orderId: p.orderId || null,
          date,
          amount: p.amount,
          method: p.method,
          notes: p.notes,
        },
      },
    },
  });
  revalidatePath(`/clients/${p.clientId}`);
  revalidatePath("/cash");
}
