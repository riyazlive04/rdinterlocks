import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

// Days a lead has sat in its current stage, derived purely from
// stageEnteredAt's age — exactly how stock.ts derives a batch's curing stage
// from producedAt. No background job needed to keep this current.
export function daysInStage(stageEnteredAt: Date | null, now: Date = new Date()): number | null {
  if (!stageEnteredAt) return null;
  return Math.max(0, Math.floor((now.getTime() - stageEnteredAt.getTime()) / 86400000));
}

// Best-effort mapping from the free-text quotationStage string (the
// Transcriber/Meta ingestion contract) to a configured, active LeadStage —
// used by leads-import.ts to keep stageId in sync one-directionally.
// Returns null when nothing matches; an import never invents or reactivates
// a stage, it only ever attaches to one that already exists and is active.
export async function resolveStageBySlug(
  slug: string
): Promise<{ id: string; isWon: boolean; isLost: boolean } | null> {
  if (!slug) return null;
  return prisma.leadStage.findFirst({
    where: { slug, isActive: true },
    select: { id: true, isWon: true, isLost: true },
  });
}

/**
 * Auto-enroll a lead into every active WaSequence configured to trigger on
 * the stage it just entered. Called from every place Lead.stageId changes
 * (moveLeadStage, leads-import.ts's stage sync, deactivateLeadStage's
 * reassignment) — NEVER called when the destination is a won/lost stage,
 * since those paths already stop the lead's nurturing; auto-*starting* a new
 * sequence there would immediately contradict that.
 *
 * Accepts either the top-level prisma client or a $transaction callback's tx
 * client, so a caller already inside a transaction keeps this atomic with
 * the stage write, while leads-import.ts (which isn't transactional) can
 * still call it as a plain best-effort follow-up.
 */
export async function triggerWaSequencesForStage(
  db: Prisma.TransactionClient | typeof prisma,
  leadId: string,
  stageId: string
): Promise<void> {
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { whatsappOptOut: true } });
  if (!lead || lead.whatsappOptOut) return;

  const sequences = await db.waSequence.findMany({
    where: { triggerStageId: stageId, active: true },
    include: { steps: { orderBy: { stepOrder: "asc" }, take: 1 } },
  });

  for (const seq of sequences) {
    const firstStep = seq.steps[0];
    if (!firstStep) continue;
    await db.waEnrollment.upsert({
      where: { leadId_sequenceId: { leadId, sequenceId: seq.id } },
      update: {
        status: "active",
        stopReason: null,
        currentStepId: firstStep.id,
        nextRunAt: new Date(Date.now() + firstStep.delayMinutes * 60_000),
      },
      create: {
        leadId,
        sequenceId: seq.id,
        currentStepId: firstStep.id,
        nextRunAt: new Date(Date.now() + firstStep.delayMinutes * 60_000),
      },
    });
  }
}
