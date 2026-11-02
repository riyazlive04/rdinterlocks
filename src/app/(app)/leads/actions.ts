"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { convertLeadCore, type ConvertInput } from "@/lib/lead-convert";
import { resolveStageBySlug, triggerWaSequencesForStage } from "@/lib/lead-stage";

// Office-side lead handling. The import endpoint writes leads in; everything
// here is a human acting on one afterwards — correcting a bad extraction,
// chasing a follow-up, or turning the enquiry into a real client + order.

const leadSchema = z.object({
  customerName: z.string().default(""),
  phoneNumber: z.string().default(""),
  place: z.string().default(""),
  brickType: z.string().default(""),
  brickCount: z.number().int().nonnegative().nullable().default(null),
  constructionType: z.string().default(""),
  costPerBrick: z.number().nonnegative().nullable().default(null),
  totalBudget: z.number().nonnegative().nullable().default(null),
  notes: z.string().default(""),
  followUpDate: z.string().optional(),
  quotationStage: z.string().default("new"),
  brickSizeId: z.string().optional(),
  constructionTypeId: z.string().optional(),
});

export async function updateLead(id: string, input: z.infer<typeof leadSchema>) {
  await requireArea("leads");
  const p = leadSchema.parse(input);

  // A converted lead is a historical record of what the customer originally
  // asked for. Editing it after the fact would rewrite that history while the
  // client and order it produced stay unchanged.
  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing) throw new Error("Lead not found");
  if (existing.convertedAt) throw new Error("This lead has been converted and can no longer be edited.");

  await prisma.lead.update({
    where: { id },
    data: {
      customerName: p.customerName.trim(),
      phoneNumber: p.phoneNumber.trim(),
      place: p.place.trim(),
      brickType: p.brickType.trim(),
      brickCount: p.brickCount,
      constructionType: p.constructionType.trim(),
      costPerBrick: p.costPerBrick,
      totalBudget: p.totalBudget,
      notes: p.notes.trim(),
      followUpDate: p.followUpDate ? new Date(p.followUpDate) : null,
      quotationStage: p.quotationStage,
      brickSizeId: p.brickSizeId || null,
      constructionTypeId: p.constructionTypeId || null,
    },
  });

  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  redirect(`/leads/${id}`);
}

export async function setLeadStage(id: string, stage: string) {
  await requireArea("leads");
  await prisma.lead.update({ where: { id }, data: { quotationStage: stage } });
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
}

export async function setFollowUp(id: string, date: string | null) {
  await requireArea("leads");
  await prisma.lead.update({
    where: { id },
    data: { followUpDate: date ? new Date(date) : null },
  });
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
}

// Discard is reversible and keeps the audit trail; delete is not. The office
// gets discard on the lead itself, delete only for genuine junk.
export async function discardLead(id: string) {
  await requireArea("leads");
  await prisma.lead.update({
    where: { id },
    data: { status: "discarded", quotationStage: "lost" },
  });
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
}

export async function reopenLead(id: string) {
  await requireArea("leads");
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) throw new Error("Lead not found");
  if (lead.convertedAt) throw new Error("A converted lead cannot be reopened.");
  await prisma.lead.update({ where: { id }, data: { status: "open" } });
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
}

export async function deleteLead(id: string) {
  await requireArea("leads");
  // Audit rows outlive the lead deliberately — LeadImport.leadId is SetNull, so
  // the record of what the Transcriber sent survives even if the lead is binned.
  await prisma.lead.delete({ where: { id } });
  revalidatePath("/leads");
  redirect("/leads");
}

// ─── Conversion ───────────────────────────────────────────────────────

/**
 * Turn a lead into a real customer. The transaction itself lives in
 * lib/lead-convert.ts so it can run outside a request; this layer adds auth,
 * cache invalidation and the redirect.
 */
export async function convertLead(id: string, input: ConvertInput) {
  await requireArea("leads");
  const clientId = await convertLeadCore(id, input);

  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}

// ─── Kanban board ───────────────────────────────────────────────────────

const moveStageSchema = z.object({
  leadId: z.string().min(1),
  toStageId: z.string().min(1),
});

/**
 * A drag on the Kanban board. Writes the new stage plus one LeadStageHistory
 * row in a single transaction — the same "one write, one audit row" shape
 * every other stage-changing path in this app follows (see
 * deactivateLeadStage, convertLeadCore). Moving into a won/lost-flagged
 * stage syncs the legacy quotationStage string and stops any active
 * WhatsApp nurture enrollment for the lead, but does NOT itself convert the
 * lead to a client — that stays the deliberate, explicit "Convert" action.
 */
export async function moveLeadStage(input: z.infer<typeof moveStageSchema>) {
  const session = await requireArea("leads");
  const { leadId, toStageId } = moveStageSchema.parse(input);

  await prisma.$transaction(async (tx) => {
    const [lead, destination] = await Promise.all([
      tx.lead.findUnique({ where: { id: leadId } }),
      tx.leadStage.findUnique({ where: { id: toStageId } }),
    ]);
    if (!lead) throw new Error("Lead not found.");
    if (lead.convertedAt) throw new Error("This lead has been converted and can no longer be moved.");
    if (!destination || !destination.isActive) throw new Error("Destination stage is not available.");
    if (lead.stageId === toStageId) return;

    const derivedQuotationStage = destination.isWon ? "won" : destination.isLost ? "lost" : undefined;

    await tx.lead.update({
      where: { id: leadId },
      data: {
        stageId: toStageId,
        stageEnteredAt: new Date(),
        ...(derivedQuotationStage ? { quotationStage: derivedQuotationStage } : {}),
      },
    });
    await tx.leadStageHistory.create({
      data: { leadId, fromStageId: lead.stageId, toStageId, changedBy: session.userId },
    });
    if (destination.isWon || destination.isLost) {
      await tx.waEnrollment.updateMany({
        where: { leadId, status: "active" },
        data: { status: "stopped", stopReason: "stage" },
      });
    } else {
      // Never trigger a fresh sequence on a won/lost stage — those paths
      // just stopped nurturing above, and starting one would contradict it.
      await triggerWaSequencesForStage(tx, leadId, toStageId);
    }
  });

  revalidatePath("/leads");
  revalidatePath("/leads/board");
  revalidatePath(`/leads/${leadId}`);
}

// ─── Ownership + call activity ───────────────────────────────────────────

// Every lead ingested from Meta lands unassigned, which is why ownership and
// the call log live together here: assigning a lead and logging what happened
// on the phone are the two halves of the same daily loop. Both append a
// LeadActivity row — that table is append-only by design, so nothing below
// ever updates or deletes one.

const ACTIVITY_KINDS = ["call", "whatsapp", "visit", "note", "stage", "assign", "quote"] as const;

const activitySchema = z.object({
  kind: z.string().default("call"),
  // Free-form on purpose, exactly like Lead.quotationStage: the office can
  // start recording a new disposition without a migration or a deploy.
  outcome: z.string().default(""),
  note: z.string().default(""),
  nextActionAt: z.string().nullish(),
});

/**
 * The converted-lead lock, in the same words updateLead uses. A converted
 * lead is a historical record of what the customer originally asked for;
 * bolting a new owner or a new call onto it afterwards would rewrite that
 * history while the client and order it produced stay unchanged.
 */
function assertWritable(lead: { convertedAt: Date | null; status: string }) {
  if (lead.convertedAt || lead.status === "converted")
    throw new Error("This lead has been converted and can no longer be edited.");
}

/**
 * Hand a lead to someone (or back to nobody). Writes ownerUserId plus one
 * LeadActivity row of kind `assign` in a single transaction — the same "one
 * write, one audit row" shape moveLeadStage follows.
 */
export async function assignLead(leadId: string, userId: string | null) {
  const session = await requireArea("leads");

  await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      select: { convertedAt: true, status: true, ownerUserId: true },
    });
    if (!lead) throw new Error("Lead not found");
    assertWritable(lead);
    if (lead.ownerUserId === userId) return;

    const owner = userId
      ? await tx.user.findUnique({ where: { id: userId }, select: { name: true, active: true } })
      : null;
    if (userId && (!owner || !owner.active)) throw new Error("That user is not available.");

    await tx.lead.update({ where: { id: leadId }, data: { ownerUserId: userId } });
    // The note spells the destination out in words rather than leaning on a
    // join: Lead.ownerUserId is SetNull on user deletion, so the trail has to
    // survive the user it refers to.
    await tx.leadActivity.create({
      data: {
        leadId,
        userId: session.userId,
        kind: "assign",
        note: owner ? `Assigned to ${owner.name}` : "Unassigned",
      },
    });
  });

  revalidatePath("/leads");
  revalidatePath("/leads/board");
  revalidatePath(`/leads/${leadId}`);
}

/**
 * Set (or clear) the lead's delivery zone.
 *
 * The zone is what the whole rate chart turns on — ₹43/brick inside 20km
 * against ₹58 beyond 160km — and the schema refuses to infer it from the
 * free-text `place` because the bands' area lists overlap. So it is recorded
 * explicitly, by the person who established on the call where the site is.
 *
 * Mirrors assignLead: same writable guard, same append-only activity trail,
 * same revalidation. The note names the zone in words because Lead.zoneId is
 * SetNull on zone deletion and the trail has to outlive the row it points at.
 */
export async function setLeadZone(leadId: string, zoneId: string | null) {
  const session = await requireArea("leads");

  await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      select: { convertedAt: true, status: true, zoneId: true },
    });
    if (!lead) throw new Error("Lead not found");
    assertWritable(lead);
    if (lead.zoneId === zoneId) return;

    const zone = zoneId
      ? await tx.deliveryZone.findUnique({
          where: { id: zoneId },
          select: { name: true, distanceLabel: true, active: true },
        })
      : null;
    if (zoneId && (!zone || !zone.active)) throw new Error("That delivery zone is not available.");

    await tx.lead.update({ where: { id: leadId }, data: { zoneId } });
    await tx.leadActivity.create({
      data: {
        leadId,
        userId: session.userId,
        kind: "note",
        outcome: "zone",
        note: zone
          ? `Delivery zone set to ${zone.name}${zone.distanceLabel ? ` (${zone.distanceLabel})` : ""}`
          : "Delivery zone cleared",
      },
    });
  });

  revalidatePath("/leads");
  revalidatePath("/leads/board");
  revalidatePath(`/leads/${leadId}`);
}

/**
 * Record what happened on a call (or a visit, or a WhatsApp exchange).
 *
 * Two side effects beyond the activity row itself, both deliberate:
 *
 *  1. `nextActionAt` is ALSO written to Lead.followUpDate. The "Follow-ups
 *     due" button, the `due=1` list filter and isFollowUpDue() all read
 *     Lead.followUpDate and nothing else — mirroring the date onto it is what
 *     keeps every one of them working unchanged, with no second notion of
 *     "when is this lead next due". LeadActivity.nextActionAt stays as the
 *     historical record of what was promised on each individual call.
 *
 *  2. An outcome of `qualified` advances the pipeline, because a telecaller
 *     marking a lead qualified IS the stage move. It reuses
 *     resolveStageBySlug + triggerWaSequencesForStage and writes the same
 *     LeadStageHistory row as moveLeadStage, so this is not a second stage
 *     mechanism — just the existing one, triggered from the call log.
 */
export async function logLeadActivity(
  leadId: string,
  input: { kind?: string; outcome?: string; note?: string; nextActionAt?: string | null }
) {
  const session = await requireArea("leads");
  const p = activitySchema.parse(input);
  const kind = (ACTIVITY_KINDS as readonly string[]).includes(p.kind) ? p.kind : "call";
  const nextActionAt = p.nextActionAt ? new Date(p.nextActionAt) : null;

  await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      select: { convertedAt: true, status: true, stageId: true },
    });
    if (!lead) throw new Error("Lead not found");
    assertWritable(lead);

    await tx.leadActivity.create({
      data: {
        leadId,
        userId: session.userId,
        kind,
        outcome: p.outcome.trim(),
        note: p.note.trim(),
        nextActionAt,
      },
    });

    // (1) above — Lead.followUpDate is the single field every follow-up view
    // reads, so the promised date has to land there too.
    if (nextActionAt) {
      await tx.lead.update({ where: { id: leadId }, data: { followUpDate: nextActionAt } });
    }

    // (2) above.
    if (p.outcome.trim() === "qualified") {
      const destination = await resolveStageBySlug("qualified");
      if (destination && destination.id !== lead.stageId) {
        // quotationStage is derived from the destination, never the reverse —
        // the same one-directional sync moveLeadStage does. An admin could in
        // principle flag the `qualified` stage won or lost, so the derivation
        // is branched identically rather than hardcoded to the slug.
        const derivedQuotationStage = destination.isWon
          ? "won"
          : destination.isLost
            ? "lost"
            : "qualified";

        await tx.lead.update({
          where: { id: leadId },
          data: {
            stageId: destination.id,
            stageEnteredAt: new Date(),
            quotationStage: derivedQuotationStage,
          },
        });
        await tx.leadStageHistory.create({
          data: {
            leadId,
            fromStageId: lead.stageId,
            toStageId: destination.id,
            changedBy: session.userId,
          },
        });
        await tx.leadActivity.create({
          data: {
            leadId,
            userId: session.userId,
            kind: "stage",
            note: "Moved to Qualified by a qualified call outcome",
          },
        });
        if (destination.isWon || destination.isLost) {
          await tx.waEnrollment.updateMany({
            where: { leadId, status: "active" },
            data: { status: "stopped", stopReason: "stage" },
          });
        } else {
          // Never trigger a fresh sequence on a won/lost stage — same rule as
          // moveLeadStage.
          await triggerWaSequencesForStage(tx, leadId, destination.id);
        }
      }
    }
  });

  revalidatePath("/leads");
  revalidatePath("/leads/board");
  revalidatePath(`/leads/${leadId}`);
}
