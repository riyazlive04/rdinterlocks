"use server";

import { revalidatePath } from "next/cache";
import { requireArea, requireAnyArea } from "@/lib/auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isFullAccess } from "@/lib/roles";
import {
  checkDeliveryAgainstAllocation,
  type AllocatableOrder,
} from "@/lib/allocation";
import { applyStockDeltas, recomputeOrderStatus, stockDeltasFor } from "@/lib/delivery-sync";
import { CLOSED_ORDER_STATUSES } from "@/lib/order-status";

// ─── Clients ──────────────────────────────────────────────────────────

const clientSchema = z.object({
  name: z.string().min(1),
  location: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
});

export async function createClient(input: z.infer<typeof clientSchema>) {
  await requireArea("sales");
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
  await requireArea("sales");
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
  await requireArea("sales");
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
  await requireArea("sales");
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

// Lintel slab line: price per slab is optional (0 = spec only).
const orderSlabItemSchema = z.object({
  slabSizeId: z.string().min(1),
  quantity: z.number().int().positive(),
  pricePerSlab: z.number().nonnegative().default(0),
});

const orderSchema = z
  .object({
    clientId: z.string().min(1),
    date: z.string(),
    expectedDeliveryDate: z.string().optional(),
    notes: z.string().optional(),
    items: z.array(orderItemSchema).default([]),
    slabItems: z.array(orderSlabItemSchema).default([]),
    advance: z.number().nonnegative().default(0),
    advanceMethod: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
  })
  .refine((d) => d.items.length > 0 || d.slabItems.length > 0, {
    message: "Add at least one brick or slab item",
  });

export async function createOrder(input: z.infer<typeof orderSchema>) {
  await requireArea("sales");
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
      slabItems: {
        create: p.slabItems.map((it) => ({
          slabSizeId: it.slabSizeId,
          quantity: it.quantity,
          pricePerSlab: it.pricePerSlab,
          total: it.quantity * it.pricePerSlab,
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
const orderEditSchema = z
  .object({
    date: z.string(),
    expectedDeliveryDate: z.string().optional(),
    notes: z.string().optional(),
    items: z.array(orderItemSchema).default([]),
    slabItems: z.array(orderSlabItemSchema).default([]),
  })
  .refine((d) => d.items.length > 0 || d.slabItems.length > 0, {
    message: "Add at least one brick or slab item",
  });

export async function updateOrder(id: string, input: z.infer<typeof orderEditSchema>) {
  await requireArea("sales");
  const p = orderEditSchema.parse(input);
  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) throw new Error("Order not found");
  const date = new Date(p.date);
  const expected = p.expectedDeliveryDate ? new Date(p.expectedDeliveryDate) : null;

  await prisma.$transaction([
    prisma.orderItem.deleteMany({ where: { orderId: id } }),
    prisma.orderSlabItem.deleteMany({ where: { orderId: id } }),
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
        slabItems: {
          create: p.slabItems.map((it) => ({
            slabSizeId: it.slabSizeId,
            quantity: it.quantity,
            pricePerSlab: it.pricePerSlab,
            total: it.quantity * it.pricePerSlab,
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

// Delete an order and everything hanging off it. Items, slab items and
// deliveries cascade from the order itself; payments do NOT — their orderId is
// optional, so they'd survive with orderId set to null and keep counting
// toward the client's paid total while their cash entry was gone. So the
// payments and their cash entries are removed explicitly, in one transaction.
export async function deleteOrder(id: string) {
  await requireArea("sales");
  const order = await prisma.order.findUnique({
    where: { id },
    include: { payments: true },
  });
  if (!order) return;
  const cashEntryIds = order.payments
    .map((p) => p.cashEntryId)
    .filter((x): x is string => !!x);

  await prisma.$transaction([
    prisma.clientPayment.deleteMany({ where: { orderId: id } }),
    ...(cashEntryIds.length
      ? [prisma.cashEntry.deleteMany({ where: { id: { in: cashEntryIds } } })]
      : []),
    prisma.order.delete({ where: { id } }),
  ]);

  revalidatePath("/clients");
  revalidatePath(`/clients/${order.clientId}`);
  revalidatePath("/cash");
  revalidatePath("/");
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
  /// Dispatch anyway, taking stock allocated to an earlier order. Owner and
  /// manager only — see assertAllocationAllows.
  allowShortfall: z.boolean().default(false),
});

// ─── Stock allocation guard ───────────────────────────────────────────

/**
 * Refuse a delivery that would take ready bricks already allocated to an
 * order AHEAD of this one in the production queue.
 *
 * Why a refusal and not a warning: a warning returned from a server action is
 * a message nobody reads, and the failure it is guarding against —
 * dispatching bricks an earlier customer was already promised — is only
 * discovered when that customer rings to ask where theirs are.
 *
 * Why it is compared against the ALLOCATION and not against total ready
 * stock: the whole problem is that total stock looks sufficient precisely
 * when an earlier order has already been promised it.
 *
 * Three ways out, in order of preference: deliver less, produce more, or —
 * for an owner or manager, who are the people entitled to decide which
 * customer waits — override. The override is recorded on the delivery rather
 * than left to look like a counting error. A supervisor gets the refusal and
 * the name of the order holding the stock, which is what lets them go and
 * ask.
 *
 * Off by default (Settings.stockAllocationEnforced), because the failure mode
 * of a wrong check here is that dispatch stops.
 */
async function assertAllocationAllows(
  orderId: string,
  requested: Array<{ brickSizeId: string; quantity: number }>,
  opts: { allowShortfall: boolean; role: string }
): Promise<string | null> {
  const settings = await prisma.settings.findUnique({
    where: { id: "default" },
    select: { stockAllocationEnforced: true },
  });
  if (!settings?.stockAllocationEnforced) return null;

  const [queue, readyStock, sizes] = await Promise.all([
    // The same queue the supervisor sees on /fulfilment: payment approved and
    // still live. An order outside it is not competing for this pool.
    prisma.order.findMany({
      where: { approvedAt: { not: null }, status: { notIn: [...CLOSED_ORDER_STATUSES] } },
      select: {
        id: true,
        stageChangedAt: true,
        fulfilmentStage: true,
        client: { select: { name: true } },
        items: { select: { brickSizeId: true, quantity: true } },
        deliveries: { select: { items: { select: { brickSizeId: true, quantity: true } } } },
      },
    }),
    prisma.stockBatch.groupBy({
      by: ["brickSizeId"],
      where: { stage: "ready", remaining: { gt: 0 } },
      _sum: { remaining: true },
    }),
    prisma.brickSize.findMany({ select: { id: true, label: true } }),
  ]);

  // An order that never went through the approval gate (a direct sale) is not
  // in the queue, so there is no allocation to check it against.
  if (!queue.some((o) => o.id === orderId)) return null;

  const orders: AllocatableOrder[] = queue.map((o) => ({
    id: o.id,
    stageChangedAt: o.stageChangedAt,
    fulfilmentStage: o.fulfilmentStage,
    ordered: o.items,
    delivered: o.deliveries.flatMap((d) => d.items),
  }));
  const readyBySize = new Map(readyStock.map((r) => [r.brickSizeId, r._sum.remaining ?? 0]));

  const check = checkDeliveryAgainstAllocation(orderId, requested, orders, readyBySize);
  if (check.ok) return null;

  const label = new Map(sizes.map((b) => [b.id, b.label]));
  const name = new Map(queue.map((o) => [o.id, o.client.name]));
  const detail = check.shortfalls
    .map(
      (sf) =>
        `${label.get(sf.brickSizeId) ?? "bricks"}: ${sf.requested} requested, ${sf.allocated} allocated to this order`
    )
    .join("; ");
  const holders = check.blockedBy.map((id) => name.get(id) ?? id).filter(Boolean);
  const heldBy = holders.length ? ` Held for ${holders.join(", ")}.` : "";

  if (opts.allowShortfall) {
    if (!isFullAccess(opts.role)) {
      throw new Error(
        `Only an owner or manager can dispatch bricks allocated to an earlier order. ${detail}.${heldBy}`
      );
    }
    // Allowed, and recorded by the caller in the delivery notes.
    return `Dispatched over allocation: ${detail}.${heldBy}`;
  }

  throw new Error(
    `Not enough ready stock allocated to this order. ${detail}.${heldBy} ` +
      "Deliver less, produce more, or ask a manager to dispatch it anyway."
  );
}

// ─── Stock draw-down on delivery ──────────────────────────────────────
// Delivering bricks reduces READY stock; editing/deleting a delivery puts it
// back. We work off the same age-based "ready" definition the dashboard uses
// (returned batches are always ready; produced batches once past the curing
// window) and draw FIFO — oldest ready batch first. If a delivery exceeds the
// recorded ready stock the last batch is allowed to go negative, so the figure
// surfaces over-delivery instead of silently hiding it.

export async function createDelivery(input: z.input<typeof deliverySchema>) {
  const session = await requireArea("sales");
  const p = deliverySchema.parse(input);
  const date = new Date(p.date);
  const order = await prisma.order.findUnique({
    where: { id: p.orderId },
    include: { client: true },
  });
  if (!order) throw new Error("Order not found");

  // Before anything is written: would this take bricks an earlier order was
  // already promised? Throws unless it is covered or deliberately overridden.
  const override = await assertAllocationAllows(p.orderId, p.items, {
    allowShortfall: p.allowShortfall,
    role: session.role,
  });

  await prisma.delivery.create({
    data: {
      orderId: p.orderId,
      date,
      truckPlate: p.truckPlate?.trim() || null,
      // An override is recorded on the delivery, so an overdrawn godown
      // carries its reason instead of looking like a counting error.
      notes: [p.notes, override].filter(Boolean).join(" · ") || undefined,
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

  // Draw the delivered bricks out of ready stock
  await applyStockDeltas(stockDeltasFor(p.items, p.returns));

  // Update order status
  await recomputeOrderStatus(p.orderId);

  revalidatePath("/clients");
  revalidatePath(`/clients/${order.clientId}`);
  revalidatePath("/cash");
  revalidatePath("/");
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
  allowShortfall: z.boolean().default(false),
});

export async function updateDelivery(id: string, input: z.input<typeof deliveryEditSchema>) {
  const session = await requireArea("sales");
  const p = deliveryEditSchema.parse(input);
  const existing = await prisma.delivery.findUnique({
    where: { id },
    include: { order: true, items: true, returns: true },
  });
  if (!existing) throw new Error("Delivery not found");
  const date = new Date(p.date);

  // Only the INCREASE is checked against the allocation.
  //
  // This delivery's existing quantities have already been drawn out of stock
  // and are already subtracted from the order's outstanding need, so the
  // order's allocated remainder covers only what is still undelivered.
  // Checking the full new quantities would therefore double-count the part
  // that was already dispatched and refuse an edit that takes nothing new.
  const before = new Map<string, number>();
  for (const it of existing.items) {
    before.set(it.brickSizeId, (before.get(it.brickSizeId) ?? 0) + it.quantity);
  }
  const increase: Array<{ brickSizeId: string; quantity: number }> = [];
  const after = new Map<string, number>();
  for (const it of p.items) {
    after.set(it.brickSizeId, (after.get(it.brickSizeId) ?? 0) + it.quantity);
  }
  for (const [brickSizeId, qty] of after) {
    const delta = qty - (before.get(brickSizeId) ?? 0);
    if (delta > 0) increase.push({ brickSizeId, quantity: delta });
  }

  const override = increase.length
    ? await assertAllocationAllows(existing.orderId, increase, {
        allowShortfall: p.allowShortfall,
        role: session.role,
      })
    : null;

  // Reverse the old delivery's stock draw-down, then apply the new one.
  const reversed = new Map<string, number>();
  for (const [sizeId, delta] of stockDeltasFor(existing.items, existing.returns)) {
    reversed.set(sizeId, -delta);
  }

  await prisma.$transaction([
    prisma.deliveryItem.deleteMany({ where: { deliveryId: id } }),
    prisma.deliveryAddOn.deleteMany({ where: { deliveryId: id } }),
    prisma.deliveryReturn.deleteMany({ where: { deliveryId: id } }),
    prisma.delivery.update({
      where: { id },
      data: {
        date,
        truckPlate: p.truckPlate?.trim() || null,
        notes: [p.notes, override].filter(Boolean).join(" · ") || undefined,
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

  await applyStockDeltas(reversed);
  await applyStockDeltas(stockDeltasFor(p.items, p.returns));

  await recomputeOrderStatus(existing.orderId);
  revalidatePath("/clients");
  revalidatePath(`/clients/${existing.order.clientId}`);
  revalidatePath("/");
  redirect(`/clients/${existing.order.clientId}`);
}

// Mark (or unmark) a delivery as done — used by the evening deliveries review.
export async function setDeliveryDone(id: string, done: boolean) {
  await requireAnyArea(["sales", "deliveries"]);
  await prisma.delivery.update({
    where: { id },
    data: { completedAt: done ? new Date() : null },
  });
  revalidatePath("/deliveries");
}

export async function deleteDelivery(id: string) {
  await requireArea("sales");
  const d = await prisma.delivery.findUnique({
    where: { id },
    include: { order: true, items: true, returns: true },
  });
  if (!d) return;
  await prisma.delivery.delete({ where: { id } });

  // Put the delivered bricks back into ready stock.
  const restore = new Map<string, number>();
  for (const [sizeId, delta] of stockDeltasFor(d.items, d.returns)) {
    restore.set(sizeId, -delta);
  }
  await applyStockDeltas(restore);

  await recomputeOrderStatus(d.orderId);
  revalidatePath(`/clients/${d.order.clientId}`);
  revalidatePath("/");
}

// Set an order's status by hand — the register's Upcoming / Active / Completed
// chips. Deliveries still win: recording one recomputes the status.
export async function setOrderStatus(orderId: string, status: string) {
  const allowed = ["upcoming", "active", "completed", "cancelled"];
  if (!allowed.includes(status)) throw new Error("Unknown status");
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { status },
    select: { clientId: true },
  });
  revalidatePath("/clients");
  revalidatePath("/clients/register");
  revalidatePath(`/clients/${order.clientId}`);
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
  await requireArea("sales");
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
