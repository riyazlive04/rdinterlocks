"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { isFullAccess } from "@/lib/roles";
import { FULFILMENT_STAGES, normalizeStage, stageIndex } from "./stage";

const stageSchema = z.enum(FULFILMENT_STAGES);

/**
 * Move an order along the shop floor: queued -> in_production -> ready ->
 * dispatched.
 *
 * THE RULE, and the whole reason this action exists rather than a plain
 * update: a supervisor may only step FORWARD BY ONE stage. They cannot skip
 * ahead and they cannot go back. The failure this prevents is an order being
 * marked `dispatched` when it was never produced — which reads to the office
 * as "sent to the customer", empties it out of the queue, and is only
 * discovered when the customer rings to ask where their bricks are. Walking
 * it one stage at a time means the record matches what actually happened on
 * the floor.
 *
 * Owner/manager (`isFullAccess`) may set any stage in either direction,
 * because correcting a mis-click is their job and a supervisor who fat-fingers
 * `ready` must have somebody able to put it back.
 */
export async function setOrderFulfilmentStage(orderId: string, stage: string) {
  const session = await requireArea("production");
  const to = stageSchema.parse(stage);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, approvedAt: true, fulfilmentStage: true },
  });
  if (!order) throw new Error("Order not found");

  const from = normalizeStage(order.fulfilmentStage);
  if (from === to) return; // Nothing to do — a double-tap, not an error.

  const full = isFullAccess(session.role);

  if (!full) {
    // The queue only lists orders whose payment was approved and which are
    // still live. Anything else reaching this action is not something the
    // supervisor saw on screen, so it is not theirs to move either.
    if (!order.approvedAt) {
      throw new Error("This order's payment has not been approved yet");
    }
    if (order.status === "cancelled" || order.status === "complete") {
      throw new Error(`This order is ${order.status} — its stage is fixed`);
    }

    const step = stageIndex(to) - stageIndex(from);
    if (step < 0) {
      throw new Error("Only a manager can move an order back a stage");
    }
    if (step > 1) {
      throw new Error(
        "Move the order one stage at a time — it cannot jump straight to " +
          `${to.replace("_", " ")}`
      );
    }
  }

  await prisma.order.update({
    where: { id: orderId },
    // stageChangedAt is what "waiting 3d" on the queue is measured from, so
    // it moves with every stage change or the queue starts lying.
    data: { fulfilmentStage: to, stageChangedAt: new Date() },
  });

  revalidatePath("/fulfilment");
  revalidatePath("/");
}
