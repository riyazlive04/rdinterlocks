// The payment-approval gate between a closed sale and the factory floor.
//
// The owner's flow: the telecaller generates a quote, the customer confirms
// and pays, the payment is recorded AGAINST THE QUOTATION, a manager checks
// that the money actually arrived, and that approval — nothing else — creates
// the Order that lands in the supervisor's production queue.
//
// Before this, acceptQuotation created the order on the spot, so bricks could
// be made for a payment nobody had looked at. Acceptance now only records
// that the customer said yes; approveQuotationPayment below is the one place
// an Order is born from a quotation.

import { prisma } from "./db";
import { convertQuotationToOrderTx } from "./quote";

/** The methods the office actually records, matching ClientPayment.method. */
export const PAYMENT_METHODS = ["cash", "gpay", "bank", "upi", "cheque"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** pending | approved | rejected — QuotationPayment.status. */
export const PAYMENT_STATUSES = ["pending", "approved", "rejected"] as const;

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  gpay: "GPay",
  bank: "Bank transfer",
  upi: "UPI",
  cheque: "Cheque",
};

/** Unknown values are rendered rather than assumed away, as statusLabel does. */
export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status] ?? status.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function paymentStatusTone(status: string): "slate" | "blue" | "warning" | "success" | "danger" {
  switch (status) {
    case "pending":
      return "warning";
    case "approved":
      return "success";
    case "rejected":
      return "danger";
    default:
      return "slate";
  }
}

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method.replace(/\b\w/g, (c) => c.toUpperCase());
}

export type QuotationPaymentInput = {
  amount: number;
  method?: string;
  /** UTR, cheque number, screenshot ref — how the manager finds it in the bank. */
  reference?: string;
  paidAt?: Date;
  notes?: string;
};

/**
 * Record that the customer has paid against a quotation.
 *
 * Allowed on `sent` and `accepted` only. `sent` is included deliberately:
 * customers frequently pay an advance in the same call in which they agree,
 * and forcing the telecaller to click Accept first would lose the money entry
 * to whichever step they forgot. Anything earlier has no price the customer
 * has seen, and anything later (rejected/expired) is not a live sale.
 *
 * The row always starts `pending`. Recording a payment is a claim, not a
 * receipt — see approveQuotationPayment for where it becomes real money.
 */
export async function recordQuotationPayment(
  quotationId: string,
  input: QuotationPaymentInput,
  userId: string
): Promise<string> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true, status: true, supersededById: true },
  });
  if (!quotation) throw new Error("Quotation not found.");
  if (quotation.supersededById) {
    throw new Error("This quotation was superseded by a later revision — record the payment against that one.");
  }
  if (quotation.status !== "sent" && quotation.status !== "accepted") {
    throw new Error(
      quotation.status === "rejected"
        ? "This quotation was rejected — a payment cannot be recorded against it."
        : "Only a quotation the customer has been given can take a payment. Mark it as sent first."
    );
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Enter the amount the customer actually paid.");
  }

  const payment = await prisma.quotationPayment.create({
    data: {
      quotationId,
      amount: input.amount,
      method: input.method?.trim() || "cash",
      reference: input.reference?.trim() ?? "",
      paidAt: input.paidAt ?? new Date(),
      notes: input.notes?.trim() ?? "",
      status: "pending",
      recordedByUserId: userId,
    },
  });
  return payment.id;
}

export type ApprovedPayment = {
  paymentId: string;
  quotationId: string;
  quotationNumber: string;
  orderId: string;
  clientId: string;
};

/**
 * Approve a recorded payment — and, by doing so, create the order.
 *
 * This is the whole feature. Everything here happens in ONE transaction, so
 * there is no state in which the payment is marked approved but no order
 * exists (production would never see the job), nor one in which an order
 * exists against a payment still sitting in the queue.
 */
export async function approveQuotationPayment(
  paymentId: string,
  userId: string,
  note?: string
): Promise<ApprovedPayment> {
  return prisma.$transaction(async (tx) => {
    // ─── Idempotency guard ───────────────────────────────────────────
    //
    // Two managers can have the approval queue open at once and both click
    // Approve on the same row. Without this, the second click would run the
    // whole body again: a second ClientPayment (the cashbook double-counting
    // real money) and a second attempt at an order.
    //
    // Re-read inside the transaction first, because the row read before the
    // transaction opened may already be stale...
    const payment = await tx.quotationPayment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error("Payment not found.");
    if (payment.status !== "pending") {
      throw new Error(
        payment.status === "approved"
          ? "This payment was already approved a moment ago."
          : "This payment was rejected and can no longer be approved."
      );
    }

    // ...and then claim it with a CONDITIONAL write, which is what actually
    // prevents the double approval. The read above cannot: under Postgres's
    // default READ COMMITTED isolation two concurrent transactions can both
    // read `pending` before either writes. `updateMany ... where status:
    // "pending"` makes the check and the state change a single atomic
    // statement — the loser matches zero rows and its whole transaction
    // (order, cash entry and all) rolls back. Same claim pattern as
    // convertQuotationToOrderTx's `orderId: null`.
    const claimed = await tx.quotationPayment.updateMany({
      where: { id: paymentId, status: "pending" },
      data: {
        status: "approved",
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        reviewNote: note?.trim() ?? "",
      },
    });
    if (claimed.count === 0) {
      throw new Error("This payment was reviewed by someone else a moment ago.");
    }

    // The order itself: the EXISTING conversion logic, with all of its guards
    // (one order per quotation, frozen prices copied verbatim, expiry, empty
    // line items) running inside this transaction rather than its own.
    const clientId = await convertQuotationToOrderTx(tx, payment.quotationId);

    const quotation = await tx.quotation.findUniqueOrThrow({
      where: { id: payment.quotationId },
      select: { number: true, orderId: true },
    });
    // convertQuotationToOrderTx's claim set this, or threw.
    const orderId = quotation.orderId!;

    const now = new Date();
    await tx.order.update({
      where: { id: orderId },
      data: {
        approvedByUserId: userId,
        approvedAt: now,
        // The supervisor's queue starts here. Set explicitly rather than
        // leaning on the column default, so the "waiting since" clock on the
        // production queue starts at the approval, not at row creation.
        fulfilmentStage: "queued",
        stageChangedAt: now,
      },
    });

    // ─── The real money record ───────────────────────────────────────
    //
    // QuotationPayment is deliberately NOT the money record. It is the
    // telecaller's claim that a customer paid, and it exists in a `pending`
    // state the business has not accepted yet — if the cashbook read it, every
    // unverified claim (and every rejected one) would show up as cash in hand.
    // It also hangs off a quotation, which is a document, not a ledger
    // account.
    //
    // ClientPayment + CashEntry is the authoritative pair the cashbook,
    // reports and the client's balance all read (see recordPayment in
    // clients/actions.ts, whose shape this matches). Writing it here, once,
    // at the moment of approval, means exactly one authoritative entry per
    // approved payment, carrying the amount the manager actually approved and
    // attached to the order it paid for.
    const client = await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true } });
    await tx.cashEntry.create({
      data: {
        date: payment.paidAt,
        amount: payment.amount,
        direction: "in",
        source: "sale",
        category: "Client payment",
        title: `${client.name} - payment`,
        notes: [`Quotation ${quotation.number}`, payment.reference && `ref ${payment.reference}`, payment.notes]
          .filter(Boolean)
          .join(" · "),
        method: payment.method,
        clientPayment: {
          create: {
            clientId,
            orderId,
            date: payment.paidAt,
            amount: payment.amount,
            method: payment.method,
            notes: `Quotation ${quotation.number}`,
          },
        },
      },
    });

    return {
      paymentId,
      quotationId: payment.quotationId,
      quotationNumber: quotation.number,
      orderId,
      clientId,
    };
  });
}

/**
 * Reject a recorded payment. No order is created and no money is written —
 * the quotation stays accepted and the telecaller can record a corrected
 * payment.
 *
 * The note is mandatory, for the same reason requestQuotationChanges' is: a
 * rejection with no reason tells the person who took the money nothing, and
 * just costs a phone call to find out.
 */
export async function rejectQuotationPayment(paymentId: string, userId: string, note: string): Promise<string> {
  const reason = (note ?? "").trim();
  if (!reason) {
    throw new Error("Say why the payment is being rejected — otherwise nobody can correct it.");
  }

  return prisma.$transaction(async (tx) => {
    const payment = await tx.quotationPayment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error("Payment not found.");
    if (payment.status !== "pending") {
      throw new Error(
        payment.status === "approved"
          ? "This payment has already been approved — the order it created would have to be cancelled instead."
          : "This payment has already been rejected."
      );
    }

    // Same conditional claim as the approval, so a reject racing an approve
    // cannot land after the order has been created.
    const claimed = await tx.quotationPayment.updateMany({
      where: { id: paymentId, status: "pending" },
      data: { status: "rejected", reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: reason },
    });
    if (claimed.count === 0) {
      throw new Error("This payment was reviewed by someone else a moment ago.");
    }

    return payment.quotationId;
  });
}

export type PaymentTotals = {
  /** Money a manager has approved — the only figure that is really in. */
  approved: number;
  /** Recorded but unverified. Shown separately, never added to `approved`. */
  pending: number;
  rejected: number;
  /** The quotation's own total, so a caller needs only this one object. */
  quotationTotal: number;
  /** quotationTotal - approved. Negative = overpaid. */
  balance: number;
  /** True once approved money covers the quotation. */
  settled: boolean;
  count: number;
};

/**
 * What has actually been paid against a quotation.
 *
 * `balance` counts APPROVED money only. A part payment therefore reads as a
 * part payment — the screen shows what is still outstanding instead of
 * implying the sale is settled because something was received, and a pile of
 * pending claims can never make a quotation look paid.
 */
export async function paymentTotals(quotationId: string): Promise<PaymentTotals> {
  const [quotation, payments] = await Promise.all([
    prisma.quotation.findUnique({ where: { id: quotationId }, select: { total: true } }),
    prisma.quotationPayment.findMany({ where: { quotationId }, select: { amount: true, status: true } }),
  ]);

  const sum = (status: string) =>
    payments.filter((p) => p.status === status).reduce((s, p) => s + p.amount, 0);

  const approved = sum("approved");
  const quotationTotal = quotation?.total ?? 0;
  return {
    approved,
    pending: sum("pending"),
    rejected: sum("rejected"),
    quotationTotal,
    balance: quotationTotal - approved,
    settled: quotationTotal > 0 && approved >= quotationTotal,
    count: payments.length,
  };
}
