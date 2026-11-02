// Shared presentation + rule helpers for the quotation review gate. Pure —
// no DB access — so the server actions, the review queue and the quotation
// pages all agree on what a status means. Same role lib/leads.ts plays for
// lead stages.

export const QUOTE_STATUSES = [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "sent",
  "accepted",
  "rejected",
  "expired",
] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
};

/** Unknown statuses are rendered rather than assumed away, exactly as stageLabel does. */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function statusTone(status: string): "slate" | "blue" | "warning" | "success" | "danger" {
  switch (status) {
    case "draft":
      return "slate";
    case "in_review":
      return "warning";
    case "changes_requested":
      return "danger";
    case "approved":
      return "blue";
    case "sent":
      return "blue";
    case "accepted":
      return "success";
    case "rejected":
      return "danger";
    case "expired":
      return "warning";
    default:
      return "slate";
  }
}

/**
 * "Locked" = never mutated in place again; an edit must create a linked
 * revision instead.
 *
 * Locking begins at `approved`, NOT at `sent` as it used to: submitting for
 * review renders and freezes the PDF (lib/quote-document.ts), and the
 * reviewer approves that exact file. Editing the quotation underneath an
 * approved, frozen document would leave the row and the approved bytes
 * disagreeing — i.e. it would invalidate the approval. So the row locks the
 * moment the approval is given, well before the customer receives anything.
 */
export function isLockedStatus(status: string): boolean {
  switch (status) {
    case "approved":
    case "sent":
    case "accepted":
    case "rejected":
    case "expired":
      return true;
    default:
      return false;
  }
}

/**
 * Directly editable in place. `changes_requested` qualifies on purpose —
 * a bounced quotation exists precisely to be fixed and resubmitted, so it
 * behaves like the draft it effectively is again.
 *
 * `in_review` is deliberately neither editable nor locked: it is parked with
 * the reviewer, so it must be approved or sent back before anyone touches it.
 */
export function canEditDraft(status: string): boolean {
  return status === "draft" || status === "changes_requested";
}

/**
 * Where a quotation lands when it is submitted.
 *
 * With Settings.quoteReviewRequired off, submission approves it outright, so
 * a desk that doesn't want the ceremony keeps today's one-step
 * draft -> send flow — the PDF is still frozen on the way through, which is
 * the part that is worth having either way.
 */
export function nextStatusOnSubmit(reviewRequired: boolean): QuoteStatus {
  return reviewRequired ? "in_review" : "approved";
}
