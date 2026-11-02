"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireArea, requireSession } from "@/lib/auth";
import { can, isAdmin } from "@/lib/access";
import { isFullAccess } from "@/lib/roles";
import {
  financialYearLabel,
  nextQuotationNumber,
  isQuotationExpired,
  resolveQuotationItems,
  syncLeadWonForQuotation,
} from "@/lib/quote";
import {
  approveQuotationPayment,
  recordQuotationPayment,
  rejectQuotationPayment,
} from "@/lib/quote-payment";
import { canEditDraft, isLockedStatus, nextStatusOnSubmit } from "@/lib/quote-review";
import { freezeQuotationPdf } from "@/lib/quote-document";
import { resolveStageBySlug, triggerWaSequencesForStage } from "@/lib/lead-stage";

// Quotations are a money document by nature, so generating or revising one —
// not just viewing the list — additionally requires the `revenue` area,
// mirroring how reports/dashboard gate money on screen.
async function requireQuotationWrite() {
  const session = await requireArea("quotations");
  if (!can(session, "revenue")) {
    throw new Error("You don't have permission to see or set prices.");
  }
  return session;
}

const itemSchema = z.object({
  brickSizeId: z.string().min(1),
  constructionTypeId: z.string().min(1),
  quantity: z.number().int().positive(),
  // Present only when the office typed a different price than the matrix;
  // absent means "autofill from ZonePrice (if a zone is picked) or
  // BrickPrice.sellPrice at generation time".
  unitPrice: z.number().nonnegative().optional(),
  // Customer supplies their own bricks — this line prices from the zone's
  // ZoneBrickRule.transportOnly instead of ZonePrice/BrickPrice.
  transportOnly: z.boolean().optional().default(false),
});

const quoteSchema = z
  .object({
    leadId: z.string().optional(),
    clientId: z.string().optional(),
    // Manual/walk-in entry: no existing lead or client, typed directly.
    // Only customerName is required — a quotation needs SOME identification,
    // but phone/place are as optional here as they are on a lead.
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    place: z.string().optional(),
    // Explicitly picked delivery zone — drives ZonePrice lookup below.
    // Never auto-matched from free-text place/lead data.
    zoneId: z.string().optional(),
    validUntil: z.string().optional(),
    items: z.array(itemSchema).min(1),
  })
  .refine((d) => !(d.leadId && d.clientId), {
    message: "A quotation can be generated from a lead OR a client, not both",
  })
  .refine((d) => !!d.leadId || !!d.clientId || !!d.customerName?.trim(), {
    message: "Pick a lead, pick a client, or enter the customer's name",
  });

type QuoteInput = z.infer<typeof quoteSchema>;
// The exported actions below are called with a plainer client-side shape
// (QuoteSubmit in item-form.tsx, where transportOnly is an optional boolean)
// before quoteSchema.parse() fills in its default — z.input is the pre-parse
// shape zod actually accepts, distinct from QuoteInput's post-default output.
type QuoteRawInput = z.input<typeof quoteSchema>;

async function resolveCustomer(p: QuoteInput) {
  if (p.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: p.leadId } });
    if (!lead) throw new Error("Lead not found.");
    return { customerName: lead.customerName, customerPhone: lead.phoneNumber || lead.phoneMasked, place: lead.place };
  }
  if (p.clientId) {
    const client = await prisma.client.findUnique({ where: { id: p.clientId } });
    if (!client) throw new Error("Client not found.");
    return { customerName: client.name, customerPhone: client.phone ?? "", place: client.location ?? "" };
  }
  // Manual entry — no lead/client record at all. The conversion that runs
  // when a manager approves the payment already handles clientId being null,
  // by creating a Client from these same snapshotted fields.
  return {
    customerName: p.customerName?.trim() ?? "",
    customerPhone: p.customerPhone?.trim() ?? "",
    place: p.place?.trim() ?? "",
  };
}

/**
 * Move a lead to the `quoted` pipeline stage because a quotation now exists
 * for it. Best-effort and deliberately OUTSIDE the quotation's own
 * transaction: a missing/inactive `quoted` stage, or a WhatsApp enrollment
 * write failing, must never roll back a quotation that has already been
 * priced and given a number from the financial-year counter.
 *
 * `quotationStage` (the Transcriber/Meta ingestion contract) is synced from
 * the stage move, never the other way round — the same one-directional rule
 * moveLeadStage and leads-import.ts follow.
 */
async function advanceLeadToQuoted(leadId: string, userId: string, quoteNumber: string): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, stageId: true, status: true, quotationStage: true },
  });
  if (!lead || lead.status !== "open") return;
  // Only ever advance. A lead already negotiating, won or lost has moved
  // past "we sent them a price", and a new quotation must not drag it back.
  if (lead.quotationStage !== "new" && lead.quotationStage !== "qualified") return;

  const stage = await resolveStageBySlug("quoted");

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: {
        quotationStage: "quoted",
        ...(stage ? { stageId: stage.id, stageEnteredAt: new Date() } : {}),
      },
    });
    if (!stage) return; // no configured `quoted` stage: the legacy string above is all there is to sync
    await tx.leadStageHistory.create({
      data: {
        leadId,
        fromStageId: lead.stageId,
        toStageId: stage.id,
        changedBy: userId,
        note: `Quotation ${quoteNumber} generated`,
      },
    });
    // Never auto-start a nurture sequence on a won/lost stage — those paths
    // stop nurturing, so starting one would contradict them (same rule as
    // moveLeadStage).
    if (!stage.isWon && !stage.isLost) {
      await triggerWaSequencesForStage(tx, leadId, stage.id);
    }
  });
}

export async function generateQuotation(input: QuoteRawInput): Promise<string> {
  const session = await requireQuotationWrite();
  const p = quoteSchema.parse(input);

  const [{ customerName, customerPhone, place }, resolvedItems] = await Promise.all([
    resolveCustomer(p),
    resolveQuotationItems(p.items, p.zoneId),
  ]);
  const subtotal = resolvedItems.reduce((s, it) => s + it.total, 0);
  const financialYear = financialYearLabel(new Date());

  const quotation = await prisma.$transaction(async (tx) => {
    const number = await nextQuotationNumber(tx, financialYear);
    return tx.quotation.create({
      data: {
        number,
        financialYear,
        leadId: p.leadId || null,
        clientId: p.clientId || null,
        zoneId: p.zoneId || null,
        customerName,
        customerPhone,
        place,
        validUntil: p.validUntil ? new Date(p.validUntil) : null,
        subtotal,
        total: subtotal,
        items: { create: resolvedItems },
      },
    });
  });

  // Until now, generating a quotation left the lead sitting in whatever
  // stage it was in, so the pipeline said "qualified" about a customer who
  // was holding our price. Swallow failures: the quotation is the record
  // that matters, and a stage that won't move is a reporting problem, not a
  // reason to lose it.
  if (p.leadId) {
    const leadId = p.leadId;
    try {
      await advanceLeadToQuoted(leadId, session.userId, quotation.number);
    } catch {
      // intentionally ignored — see above
    }
  }

  revalidatePath("/quotations");
  if (p.leadId) {
    revalidatePath(`/leads/${p.leadId}`);
    revalidatePath("/leads");
    revalidatePath("/leads/board");
  }
  if (p.clientId) revalidatePath(`/clients/${p.clientId}`);
  redirect(`/quotations/${quotation.id}`);
}

/**
 * Direct edit — replaces line items in place. Allowed on a draft and on a
 * quotation the reviewer sent back (canEditDraft), which is the whole point
 * of `changes_requested`: it goes back to behaving like the draft it is.
 */
export async function updateQuotation(id: string, input: QuoteRawInput) {
  await requireQuotationWrite();
  const existing = await prisma.quotation.findUnique({ where: { id } });
  if (!existing) throw new Error("Quotation not found.");
  if (!canEditDraft(existing.status)) {
    throw new Error(
      existing.status === "in_review"
        ? "This quotation is with the reviewer — ask them to send it back before editing it."
        : "This quotation has been approved and is locked — use Revise instead."
    );
  }

  const p = quoteSchema.parse(input);
  const [{ customerName, customerPhone, place }, resolvedItems] = await Promise.all([
    resolveCustomer(p),
    resolveQuotationItems(p.items, p.zoneId),
  ]);
  const subtotal = resolvedItems.reduce((s, it) => s + it.total, 0);

  await prisma.$transaction(async (tx) => {
    await tx.quotationItem.deleteMany({ where: { quotationId: id } });
    await tx.quotation.update({
      where: { id },
      data: {
        leadId: p.leadId || null,
        clientId: p.clientId || null,
        zoneId: p.zoneId || null,
        customerName,
        customerPhone,
        place,
        validUntil: p.validUntil ? new Date(p.validUntil) : null,
        subtotal,
        total: subtotal,
        items: { create: resolvedItems },
      },
    });
  });

  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
}

/**
 * Locked quotations are never mutated — editing creates a linked revision
 * instead. Locking starts at `approved` (see isLockedStatus): once a PDF has
 * been frozen and approved, the row behind it is history.
 */
export async function reviseQuotation(id: string, input: QuoteRawInput): Promise<string> {
  await requireQuotationWrite();
  const original = await prisma.quotation.findUnique({ where: { id } });
  if (!original) throw new Error("Quotation not found.");
  if (canEditDraft(original.status)) throw new Error("A draft quotation can be edited directly.");
  if (!isLockedStatus(original.status)) {
    // Only `in_review` lands here: parked with the reviewer, so it is
    // neither editable nor revisable until they decide.
    throw new Error("This quotation is with the reviewer — it can't be revised until they approve it or send it back.");
  }
  if (original.supersededById) throw new Error("This quotation has already been superseded by a later revision.");

  const p = quoteSchema.parse(input);
  const [{ customerName, customerPhone, place }, resolvedItems] = await Promise.all([
    resolveCustomer(p),
    resolveQuotationItems(p.items, p.zoneId ?? original.zoneId ?? undefined),
  ]);
  const subtotal = resolvedItems.reduce((s, it) => s + it.total, 0);
  const financialYear = financialYearLabel(new Date());

  const created = await prisma.$transaction(async (tx) => {
    const number = await nextQuotationNumber(tx, financialYear);
    const next = await tx.quotation.create({
      data: {
        number,
        financialYear,
        leadId: p.leadId || original.leadId,
        clientId: p.clientId || original.clientId,
        zoneId: p.zoneId || original.zoneId,
        customerName,
        customerPhone,
        place,
        validUntil: p.validUntil ? new Date(p.validUntil) : original.validUntil,
        revision: original.revision + 1,
        subtotal,
        total: subtotal,
        items: { create: resolvedItems },
      },
    });
    await tx.quotation.update({ where: { id: original.id }, data: { supersededById: next.id } });
    return next;
  });

  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  redirect(`/quotations/${created.id}`);
}

// ─── Review gate ─────────────────────────────────────────────────────────
//
// The actions below only ever move a status and record who moved it — they
// write no amounts — so, like markQuotationSent and rejectQuotation, they do
// NOT require `revenue`. They are gated on the areas that describe the job
// instead: `quotations` to submit your own work, `quoteReview` to judge
// someone else's, `quoteSend` to put an approved quote in the send list.

/**
 * Submit a draft (or a sent-back quotation) for review.
 *
 * The PDF is frozen HERE, before the status moves: the reviewer must be
 * looking at a file that cannot change afterwards, and a render failure must
 * leave the quotation editable rather than parked in a review queue with no
 * document to review. Rendering launches headless Chromium, so this action
 * is deliberately the slow one in this file.
 */
export async function submitQuotationForReview(id: string, note?: string): Promise<void> {
  const session = await requireArea("quotations");
  const q = await prisma.quotation.findUnique({ where: { id } });
  if (!q) throw new Error("Quotation not found.");
  if (!canEditDraft(q.status)) {
    throw new Error(
      q.status === "in_review"
        ? "This quotation is already in review."
        : "Only a draft quotation can be submitted for review."
    );
  }
  if (q.supersededById) throw new Error("This quotation has already been superseded by a later revision.");

  const settings = await prisma.settings.findUnique({ where: { id: "default" } });

  await freezeQuotationPdf(id);

  await prisma.quotation.update({
    where: { id },
    data: {
      status: nextStatusOnSubmit(settings?.quoteReviewRequired ?? false),
      submittedAt: new Date(),
      submittedByUserId: session.userId,
      // reviewNote is the row's one note field. A submission note seeds it
      // for the reviewer to read; their own decision note replaces it.
      ...(note?.trim() ? { reviewNote: note.trim() } : {}),
    },
  });

  revalidatePath("/quotations");
  revalidatePath("/quotations/review");
  revalidatePath("/quotations/send");
  revalidatePath(`/quotations/${id}`);
}

/** Approve a reviewed quotation — this is what freezes it as the document of record. */
export async function approveQuotation(id: string, note?: string): Promise<void> {
  const session = await requireArea("quoteReview");
  const q = await prisma.quotation.findUnique({
    where: { id },
    include: { lead: { select: { ownerUserId: true } } },
  });
  if (!q) throw new Error("Quotation not found.");
  if (q.status !== "in_review") throw new Error("Only a quotation that is in review can be approved.");

  const settings = await prisma.settings.findUnique({ where: { id: "default" } });

  // Review-by-owner rule: when Settings.quoteReviewByOwner is on and the
  // lead has an owner, the review belongs to the person who actually spoke
  // to the customer — they are the only one who can tell whether the price
  // and quantities match what was discussed. An admin/owner can always
  // override (someone has to be able to unblock a quote when the lead's
  // owner is on leave).
  //
  // The `quoteReview` area is NOT treated as an override here: requireArea
  // above already guarantees every caller holds it, so accepting it as one
  // would make this rule unreachable.
  const routedToOwner = (settings?.quoteReviewByOwner ?? true) && !!q.lead?.ownerUserId;
  if (routedToOwner && q.lead?.ownerUserId !== session.userId && !isAdmin(session.role)) {
    throw new Error("This review is routed to the lead's owner — only they (or an admin) can approve it.");
  }

  await prisma.quotation.update({
    where: { id },
    data: {
      status: "approved",
      reviewedAt: new Date(),
      reviewedByUserId: session.userId,
      reviewNote: note?.trim() ?? "",
    },
  });

  revalidatePath("/quotations");
  revalidatePath("/quotations/review");
  revalidatePath("/quotations/send");
  revalidatePath(`/quotations/${id}`);
}

/**
 * Send a quotation back to the person who submitted it. The note is
 * mandatory: a bounce with no reason tells the submitter nothing and just
 * costs another round trip.
 */
export async function requestQuotationChanges(id: string, note: string): Promise<void> {
  const session = await requireArea("quoteReview");
  const reason = (note ?? "").trim();
  if (!reason) throw new Error("Say what needs to change — a quotation sent back with no reason can't be fixed.");

  const q = await prisma.quotation.findUnique({ where: { id } });
  if (!q) throw new Error("Quotation not found.");
  if (q.status !== "in_review") throw new Error("Only a quotation that is in review can be sent back.");

  await prisma.quotation.update({
    where: { id },
    data: {
      status: "changes_requested",
      reviewedAt: new Date(),
      reviewedByUserId: session.userId,
      reviewNote: reason,
    },
  });

  revalidatePath("/quotations");
  revalidatePath("/quotations/review");
  revalidatePath("/quotations/send");
  revalidatePath(`/quotations/${id}`);
}

/**
 * Put an approved quotation in the send list. Does not change the status —
 * it stays `approved` until a human records the actual send through
 * markQuotationSent — so queueing is safely repeatable.
 */
export async function queueQuotationForSend(id: string): Promise<void> {
  await requireArea("quoteSend");
  const q = await prisma.quotation.findUnique({ where: { id } });
  if (!q) throw new Error("Quotation not found.");
  if (q.status !== "approved") throw new Error("Only an approved quotation can be queued for sending.");
  if (q.supersededById) throw new Error("This quotation has already been superseded by a later revision.");

  await prisma.quotation.update({
    where: { id },
    // Clear any error from a previous attempt: a re-queue is a retry, and a
    // stale failure message on a freshly queued quote is just noise.
    data: { sendQueuedAt: new Date(), sendError: "" },
  });

  revalidatePath("/quotations");
  revalidatePath("/quotations/review");
  revalidatePath("/quotations/send");
  revalidatePath(`/quotations/${id}`);
}

const sentSchema = z.object({ channel: z.enum(["whatsapp", "print", "email", "other"]) });

export async function markQuotationSent(id: string, input: z.infer<typeof sentSchema>) {
  const session = await requireArea("quotations");
  const p = sentSchema.parse(input);
  const q = await prisma.quotation.findUnique({ where: { id } });
  if (!q) throw new Error("Quotation not found.");

  const settings = await prisma.settings.findUnique({ where: { id: "default" } });

  // Sending is now downstream of the review gate. `approved` is the normal
  // state to send from (queueing leaves the status at `approved`, so a
  // queued quote qualifies). `draft` is still accepted so a desk with
  // Settings.quoteReviewRequired off keeps today's one-step flow — but with
  // the gate ON, an unapproved quotation can never be recorded as sent.
  if (q.status === "sent") throw new Error("This quotation has already been sent.");
  if (q.status !== "draft" && q.status !== "approved") {
    throw new Error("Only an approved quotation can be marked as sent.");
  }
  if (q.status !== "approved" && settings?.quoteReviewRequired) {
    throw new Error("Review is required — get this quotation approved before sending it.");
  }

  await prisma.quotation.update({
    where: { id },
    data: {
      status: "sent",
      sentAt: new Date(),
      sentChannel: p.channel,
      sentByUserId: session.userId,
      sendError: "",
    },
  });
  revalidatePath("/quotations");
  revalidatePath("/quotations/review");
  revalidatePath("/quotations/send");
  revalidatePath(`/quotations/${id}`);
}

export async function rejectQuotation(id: string) {
  await requireArea("quotations");
  const q = await prisma.quotation.findUnique({ where: { id } });
  if (!q) throw new Error("Quotation not found.");
  if (q.status === "accepted") throw new Error("This quotation has already been accepted.");
  await prisma.quotation.update({ where: { id }, data: { status: "rejected" } });
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
}

/**
 * Record that the customer agreed to this quotation. It no longer creates an
 * order.
 *
 * Acceptance used to call convertQuotationToOrder, so an Order — and with it
 * a job in the supervisor's production queue — existed before anyone had
 * checked that the money had arrived. The order is now created by a manager
 * approving the payment (lib/quote-payment.ts). Accepting means one thing:
 * the customer said yes, so record the payment next.
 *
 * It still writes no amounts itself, but it stays behind the `revenue` gate
 * rather than the bare `quotations` area: accepting commits the factory to
 * this document's frozen prices, and it is the step that opens the payment
 * form, so the person doing it has to be allowed to see the figures they are
 * committing to. markQuotationSent and rejectQuotation remain `quotations`
 * only, so a telecaller without price access can still record those.
 */
export async function acceptQuotation(id: string) {
  await requireQuotationWrite();
  const q = await prisma.quotation.findUnique({ where: { id }, include: { items: true } });
  if (!q) throw new Error("Quotation not found.");
  if (q.status === "accepted") throw new Error("This quotation has already been accepted.");
  if (q.status !== "sent") {
    throw new Error(
      q.status === "rejected"
        ? "This quotation was rejected. Revise it and send the new revision."
        : "Only a quotation the customer has been given can be accepted. Mark it as sent first."
    );
  }
  if (q.supersededById) throw new Error("This quotation has already been superseded by a later revision.");
  if (q.items.length === 0) throw new Error("This quotation has no line items.");
  // Checked here as well as in convertQuotationToOrderTx, because acceptance
  // no longer runs that function: the prices on this document were only
  // promised until validUntil, so an expired quote has to be revised rather
  // than accepted at a stale rate.
  if (isQuotationExpired(q)) {
    throw new Error(
      `This quotation expired on ${q.validUntil!.toLocaleDateString("en-IN")}. ` +
        `Revise it to pick up current prices, then accept the new revision.`
    );
  }

  await prisma.$transaction(async (tx) => {
    // Optimistic claim, so two people clicking Accept do not both run the
    // lead sync below.
    const claimed = await tx.quotation.updateMany({
      where: { id, status: "sent" },
      data: { status: "accepted" },
    });
    if (claimed.count === 0) {
      throw new Error("This quotation was already accepted by someone else a moment ago.");
    }
    // The pipeline moves on acceptance, not on payment approval — a customer
    // who has already agreed must not keep receiving nurture messages while a
    // manager checks the money. Idempotent, so the conversion's own call to
    // it later writes nothing further.
    if (q.leadId) await syncLeadWonForQuotation(tx, q.leadId);
  });

  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  if (q.leadId) {
    revalidatePath("/leads");
    revalidatePath("/leads/board");
    revalidatePath(`/leads/${q.leadId}`);
  }
  // Deliberately no redirect: the next step is on this page — record the
  // payment the customer made — and bouncing the user elsewhere is what made
  // the old flow feel finished when it was not.
}

// ─── Payment approval gate ───────────────────────────────────────────────
//
// Thin wrappers over lib/quote-payment.ts, which holds the rules. Recording a
// payment is part of closing the sale, so it takes the `quotations` area.
// Approving or rejecting one is a manager/owner act and is gated on the ROLE
// via isFullAccess: no granted area substitutes for it, because the entire
// point of the gate is that the person who closed the sale is not the person
// who confirms the money arrived.

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["cash", "gpay", "bank", "upi", "cheque"]).default("cash"),
  reference: z.string().optional().default(""),
  /** Date input value ("yyyy-mm-dd"); absent means "paid today". */
  paidAt: z.string().optional(),
  notes: z.string().optional().default(""),
});

type PaymentRawInput = z.input<typeof paymentSchema>;

/** Every screen the approval gate shows money on. */
function revalidatePayments(quotationId: string) {
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/payments");
  revalidatePath("/clients");
}

export async function recordPaymentAction(quotationId: string, input: PaymentRawInput): Promise<void> {
  const session = await requireArea("quotations");
  const p = paymentSchema.parse(input);
  await recordQuotationPayment(
    quotationId,
    {
      amount: p.amount,
      method: p.method,
      reference: p.reference,
      paidAt: p.paidAt ? new Date(p.paidAt) : undefined,
      notes: p.notes,
    },
    session.userId
  );
  revalidatePayments(quotationId);
}

/** Manager/owner only — this is the act that creates the order. */
export async function approvePaymentAction(paymentId: string, note?: string): Promise<void> {
  const session = await requireSession();
  if (!isFullAccess(session.role)) {
    throw new Error("Only a manager or the owner can approve a payment.");
  }
  const result = await approveQuotationPayment(paymentId, session.userId, note);
  revalidatePayments(result.quotationId);
  revalidatePath(`/clients/${result.clientId}`);
  revalidatePath("/production");
  revalidatePath("/cash");
}

/** Manager/owner only. The note is required — see rejectQuotationPayment. */
export async function rejectPaymentAction(paymentId: string, note: string): Promise<void> {
  const session = await requireSession();
  if (!isFullAccess(session.role)) {
    throw new Error("Only a manager or the owner can reject a payment.");
  }
  const quotationId = await rejectQuotationPayment(paymentId, session.userId, note);
  revalidatePayments(quotationId);
}
