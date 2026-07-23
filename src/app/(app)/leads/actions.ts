"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { convertLeadCore, type ConvertInput } from "@/lib/lead-convert";

// Office-side lead handling. The import endpoint writes leads in; everything
// here is a human acting on one afterwards — correcting a bad extraction,
// chasing a follow-up, or turning the enquiry into a real client + order.

const leadSchema = z.object({
  customerName: z.string().default(""),
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
