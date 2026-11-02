"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireArea, requireAdmin } from "@/lib/auth";

// ─── Templates (admin-only) ─────────────────────────────────────────────
// Records of Meta-approved templates. Nothing here ever sends a message —
// see lib/whatsapp-send.ts, which refuses to send anything that isn't
// approved:true here.

const templateSchema = z.object({
  name: z.string().min(1),
  language: z.string().min(1).default("en_US"),
  category: z.string().min(1).default("utility"),
  variableCount: z.number().int().nonnegative().default(0),
  approved: z.boolean().default(false),
});

export async function createWaTemplate(data: z.infer<typeof templateSchema>) {
  await requireAdmin();
  const p = templateSchema.parse(data);
  await prisma.waTemplate.create({ data: { ...p, name: p.name.trim() } });
  revalidatePath("/whatsapp/templates");
}

export async function updateWaTemplate(id: string, data: z.infer<typeof templateSchema>) {
  await requireAdmin();
  const p = templateSchema.parse(data);
  await prisma.waTemplate.update({ where: { id }, data: { ...p, name: p.name.trim() } });
  revalidatePath("/whatsapp/templates");
}

export async function deleteWaTemplate(id: string) {
  await requireAdmin();
  await prisma.waTemplate.update({ where: { id }, data: { active: false } });
  revalidatePath("/whatsapp/templates");
}

// ─── Sequences (admin-only) ─────────────────────────────────────────────

const sequenceSchema = z.object({
  name: z.string().min(1),
  triggerStageId: z.string().optional(),
  active: z.boolean().default(true),
});

export async function createWaSequence(data: z.infer<typeof sequenceSchema>): Promise<string> {
  await requireAdmin();
  const p = sequenceSchema.parse(data);
  const seq = await prisma.waSequence.create({
    data: { name: p.name.trim(), triggerStageId: p.triggerStageId || null, active: p.active },
  });
  revalidatePath("/whatsapp/sequences");
  return seq.id;
}

export async function updateWaSequence(id: string, data: z.infer<typeof sequenceSchema>) {
  await requireAdmin();
  const p = sequenceSchema.parse(data);
  await prisma.waSequence.update({
    where: { id },
    data: { name: p.name.trim(), triggerStageId: p.triggerStageId || null, active: p.active },
  });
  revalidatePath("/whatsapp/sequences");
  revalidatePath(`/whatsapp/sequences/${id}`);
}

export async function deleteWaSequence(id: string) {
  await requireAdmin();
  await prisma.$transaction([
    prisma.waSequence.update({ where: { id }, data: { active: false } }),
    // A deactivated sequence must stop running, not just stop accepting new
    // enrollments — otherwise the tick endpoint would keep advancing leads
    // through a sequence the admin just turned off.
    prisma.waEnrollment.updateMany({
      where: { sequenceId: id, status: "active" },
      data: { status: "stopped", stopReason: "manual" },
    }),
  ]);
  revalidatePath("/whatsapp/sequences");
}

const stepSchema = z.object({
  stepOrder: z.number().int().positive(),
  delayMinutes: z.number().int().nonnegative(),
  templateId: z.string().min(1),
});

/**
 * Replaces every step of a sequence in one transaction. Blocked while any
 * lead is actively enrolled: a step id an active WaEnrollment.currentStepId
 * points at must never be deleted out from under it, and there's no safe way
 * to remap that reference across an arbitrary reorder/add/remove, so editing
 * requires the sequence to be clear of active enrollments first.
 */
export async function setSequenceSteps(sequenceId: string, steps: z.infer<typeof stepSchema>[]) {
  await requireAdmin();
  const parsed = z.array(stepSchema).parse(steps);

  const activeCount = await prisma.waEnrollment.count({ where: { sequenceId, status: "active" } });
  if (activeCount > 0) {
    throw new Error(
      `${activeCount} lead(s) are actively enrolled in this sequence — stop or wait for them to finish before editing its steps.`
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.waSequenceStep.deleteMany({ where: { sequenceId } });
    if (parsed.length > 0) {
      await tx.waSequenceStep.createMany({
        data: parsed.map((s) => ({
          sequenceId,
          stepOrder: s.stepOrder,
          delayMinutes: s.delayMinutes,
          templateId: s.templateId,
        })),
      });
    }
  });

  revalidatePath("/whatsapp/sequences");
  revalidatePath(`/whatsapp/sequences/${sequenceId}`);
}

// ─── Enrollment (any user with whatsapp access) ─────────────────────────

const enrollSchema = z.object({ leadId: z.string().min(1), sequenceId: z.string().min(1) });

export async function enrollLeadInSequence(input: z.infer<typeof enrollSchema>) {
  await requireArea("whatsapp");
  const p = enrollSchema.parse(input);

  const [lead, sequence] = await Promise.all([
    prisma.lead.findUnique({ where: { id: p.leadId }, include: { stage: true } }),
    prisma.waSequence.findUnique({
      where: { id: p.sequenceId },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    }),
  ]);
  if (!lead) throw new Error("Lead not found.");
  if (!sequence || !sequence.active) throw new Error("Sequence is not available.");
  if (sequence.steps.length === 0) throw new Error("This sequence has no steps configured yet.");
  if (lead.whatsappOptOut) throw new Error("This lead has opted out of WhatsApp messages.");
  if (lead.stage && (lead.stage.isWon || lead.stage.isLost)) {
    throw new Error("This lead is on a won/lost stage and can't be enrolled.");
  }

  const firstStep = sequence.steps[0];
  await prisma.waEnrollment.upsert({
    where: { leadId_sequenceId: { leadId: p.leadId, sequenceId: p.sequenceId } },
    update: {
      status: "active",
      stopReason: null,
      currentStepId: firstStep.id,
      nextRunAt: new Date(Date.now() + firstStep.delayMinutes * 60_000),
    },
    create: {
      leadId: p.leadId,
      sequenceId: p.sequenceId,
      currentStepId: firstStep.id,
      nextRunAt: new Date(Date.now() + firstStep.delayMinutes * 60_000),
    },
  });

  revalidatePath(`/leads/${p.leadId}`);
  revalidatePath("/whatsapp");
}

export async function stopEnrollment(id: string) {
  await requireArea("whatsapp");
  const enrollment = await prisma.waEnrollment.update({
    where: { id },
    data: { status: "stopped", stopReason: "manual" },
  });
  revalidatePath(`/leads/${enrollment.leadId}`);
  revalidatePath("/whatsapp");
}
