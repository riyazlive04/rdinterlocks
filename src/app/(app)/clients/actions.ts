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
        title: `${order.client.name} — order advance`,
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
        title: `${order.client.name} — payment`,
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
      title: `${client.name} — payment`,
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
