"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { deriveOrderStatus } from "@/lib/order-status";
import { applyStockDeltas, recomputeOrderStatus, stockDeltasFor } from "@/lib/delivery-sync";

// The register is the paper book turned into one screen: a whole enquiry —
// customer, what they want, the rate, the money — is one row. This action
// takes that row and fans it out into the client, order and payment records the
// rest of the app already runs on, so nothing downstream has to change.
const rowSchema = z.object({
  date: z.string(),
  phone: z.string().optional(),
  name: z.string().min(1, "Name is needed"),
  location: z.string().optional(),
  brickSizeId: z.string().min(1, "Pick the brick size"),
  constructionTypeId: z.string().min(1, "Pick room / compound"),
  quantity: z.number().int().positive("Total bricks must be more than 0"),
  pricePerBrick: z.number().positive("Rate must be more than 0"),
  advance: z.number().nonnegative().default(0),
  advanceMethod: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().optional(),
  // Existing customer picked from the list; blank means "match or create".
  clientId: z.string().optional(),
  // Set when the row is being written to bill a loading trip that already
  // happened. The bricks are then booked as delivered against the new order
  // and drawn from stock, so the load stops showing as unbilled.
  fromLoadGroupId: z.string().optional(),
});

export type RegisterRowInput = z.input<typeof rowSchema>;

// Same person, written slightly differently. Phone is the reliable key — the
// register's first column — so match on the digits and fall back to the name.
function digits(s: string) {
  return s.replace(/\D/g, "");
}

async function resolveClient(p: z.output<typeof rowSchema>) {
  if (p.clientId) {
    const found = await prisma.client.findUnique({ where: { id: p.clientId } });
    if (found) return found;
  }
  const phone = p.phone ? digits(p.phone) : "";
  if (phone.length >= 6) {
    const candidates = await prisma.client.findMany({ where: { active: true } });
    const match = candidates.find((c) => c.phone && digits(c.phone).endsWith(phone.slice(-10)));
    if (match) return match;
  }
  const byName = await prisma.client.findFirst({
    where: { active: true, name: { equals: p.name.trim(), mode: "insensitive" } },
  });
  if (byName) return byName;

  return prisma.client.create({
    data: {
      name: p.name.trim(),
      phone: p.phone?.trim() || null,
      location: p.location?.trim() || null,
    },
  });
}

export async function createRegisterRow(input: RegisterRowInput) {
  const p = rowSchema.parse(input);
  const date = new Date(p.date);
  const expected = p.expectedDeliveryDate ? new Date(p.expectedDeliveryDate) : null;
  const client = await resolveClient(p);

  // Fill in details the register captured that we didn't have before (a repeat
  // customer whose location or phone was blank until now).
  const fill: { phone?: string; location?: string } = {};
  if (!client.phone && p.phone?.trim()) fill.phone = p.phone.trim();
  if (!client.location && p.location?.trim()) fill.location = p.location.trim();
  if (Object.keys(fill).length > 0) {
    await prisma.client.update({ where: { id: client.id }, data: fill });
  }

  const status = deriveOrderStatus({
    orderedQty: p.quantity,
    deliveredQty: 0,
    date,
    expectedDeliveryDate: expected,
  });

  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      date,
      expectedDeliveryDate: expected,
      status,
      notes: p.notes?.trim() || null,
      items: {
        create: [
          {
            brickSizeId: p.brickSizeId,
            constructionTypeId: p.constructionTypeId,
            quantity: p.quantity,
            pricePerBrick: p.pricePerBrick,
            total: p.quantity * p.pricePerBrick,
          },
        ],
      },
    },
  });

  if (p.advance > 0) {
    await prisma.cashEntry.create({
      data: {
        date,
        amount: p.advance,
        direction: "in",
        source: "sale",
        category: "Advance from client",
        title: `${client.name} - order advance`,
        method: p.advanceMethod,
        clientPayment: {
          create: {
            clientId: client.id,
            orderId: order.id,
            date,
            amount: p.advance,
            method: p.advanceMethod,
            notes: "Advance (register)",
          },
        },
      },
    });
  }

  // Billing a trip that already went out: book the bricks that were loaded as
  // delivered on this new order, and draw them from stock — the same thing a
  // loading entry does when an order was picked at the time.
  if (p.fromLoadGroupId) {
    const already = await prisma.delivery.count({
      where: { loadGroupId: p.fromLoadGroupId },
    });
    const rows = await prisma.loadingWork.findMany({
      where: { loadGroupId: p.fromLoadGroupId, phase: { not: "unloading" }, loadType: "brick" },
    });
    if (already === 0 && rows.length > 0) {
      const perSize = new Map<string, number>();
      for (const r of rows) {
        if (!r.brickSizeId) continue;
        perSize.set(r.brickSizeId, (perSize.get(r.brickSizeId) ?? 0) + r.brickCount);
      }
      const items = [...perSize.entries()].map(([brickSizeId, quantity]) => ({
        brickSizeId,
        constructionTypeId: p.constructionTypeId,
        quantity,
        // The rate just agreed on this row applies to the size it was for;
        // any other size on the trip is billed at the same rate rather than
        // silently at zero.
        pricePerBrick: p.pricePerBrick,
        total: quantity * p.pricePerBrick,
      }));
      if (items.length > 0) {
        await prisma.delivery.create({
          data: {
            orderId: order.id,
            date,
            loadGroupId: p.fromLoadGroupId,
            notes: "Billed from a loading trip",
            items: { create: items },
          },
        });
        await applyStockDeltas(stockDeltasFor(items, []));
        await recomputeOrderStatus(order.id);
      }
    }
  }

  revalidatePath("/clients/register");
  revalidatePath("/clients");
  revalidatePath(`/clients/${client.id}`);
  revalidatePath("/loading");
  revalidatePath("/cash");
}

// Take a payment straight off a register row — the "Balance" column shrinking
// as the customer pays, without leaving the page.
const paySchema = z.object({
  orderId: z.string().min(1),
  amount: z.number().positive(),
  date: z.string(),
  method: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
  notes: z.string().optional(),
});

export async function payRegisterRow(input: z.infer<typeof paySchema>) {
  const p = paySchema.parse(input);
  const order = await prisma.order.findUnique({
    where: { id: p.orderId },
    include: { client: true },
  });
  if (!order) throw new Error("Order not found");
  const date = new Date(p.date);
  await prisma.cashEntry.create({
    data: {
      date,
      amount: p.amount,
      direction: "in",
      source: "sale",
      category: "Client payment",
      title: `${order.client.name} - payment`,
      method: p.method,
      notes: p.notes,
      clientPayment: {
        create: {
          clientId: order.clientId,
          orderId: order.id,
          date,
          amount: p.amount,
          method: p.method,
          notes: p.notes,
        },
      },
    },
  });
  revalidatePath("/clients/register");
  revalidatePath("/clients");
  revalidatePath(`/clients/${order.clientId}`);
  revalidatePath("/cash");
}

// Correct a row in place — the register is written in pen, but this isn't.
const editSchema = z.object({
  orderId: z.string().min(1),
  date: z.string(),
  phone: z.string().optional(),
  name: z.string().min(1),
  location: z.string().optional(),
  brickSizeId: z.string().min(1),
  constructionTypeId: z.string().min(1),
  quantity: z.number().int().positive(),
  pricePerBrick: z.number().positive(),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().optional(),
});

export async function updateRegisterRow(input: z.infer<typeof editSchema>) {
  const p = editSchema.parse(input);
  const order = await prisma.order.findUnique({
    where: { id: p.orderId },
    include: { items: true },
  });
  if (!order) throw new Error("Order not found");

  await prisma.client.update({
    where: { id: order.clientId },
    data: {
      name: p.name.trim(),
      phone: p.phone?.trim() || null,
      location: p.location?.trim() || null,
    },
  });

  // One register row is one brick line; replace it rather than guess which of
  // several lines the edit meant.
  await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
  await prisma.order.update({
    where: { id: order.id },
    data: {
      date: new Date(p.date),
      expectedDeliveryDate: p.expectedDeliveryDate ? new Date(p.expectedDeliveryDate) : null,
      notes: p.notes?.trim() || null,
      items: {
        create: [
          {
            brickSizeId: p.brickSizeId,
            constructionTypeId: p.constructionTypeId,
            quantity: p.quantity,
            pricePerBrick: p.pricePerBrick,
            total: p.quantity * p.pricePerBrick,
          },
        ],
      },
    },
  });

  revalidatePath("/clients/register");
  revalidatePath("/clients");
  revalidatePath(`/clients/${order.clientId}`);
}
