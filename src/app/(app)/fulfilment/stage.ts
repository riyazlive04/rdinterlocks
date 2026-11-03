// The supervisor's stage vocabulary, in one place.
//
// `Order.fulfilmentStage` is deliberately NOT `Order.status`: that one is
// driven by delivery progress (open -> partial -> complete) and is not the
// supervisor's to move. This is the shop-floor view of the same order —
// queued in the godown, on the machine, stacked and ready, gone on a lorry.
//
// Lives beside the queue rather than in src/lib because the queue and the
// supervisor dashboard are its only two readers.

export const FULFILMENT_STAGES = ["queued", "in_production", "ready", "dispatched"] as const;

export type FulfilmentStage = (typeof FULFILMENT_STAGES)[number];

export const STAGE_LABEL: Record<FulfilmentStage, string> = {
  queued: "Queued",
  in_production: "In production",
  ready: "Ready",
  dispatched: "Dispatched",
};

export const STAGE_SUB: Record<FulfilmentStage, string> = {
  queued: "Paid for, nothing started yet",
  in_production: "On the machine now",
  ready: "Stacked and waiting for a lorry",
  dispatched: "Left the godown",
};

export const STAGE_TONE: Record<FulfilmentStage, "red" | "warning" | "success" | "slate"> = {
  queued: "red",
  in_production: "warning",
  ready: "success",
  dispatched: "slate",
};

/**
 * Where a stage sits on the line. Used for the one-step rule in actions.ts,
 * so the ordering lives next to the labels instead of being re-derived.
 */
export function stageIndex(stage: FulfilmentStage): number {
  return FULFILMENT_STAGES.indexOf(stage);
}

/**
 * Orders written before this column existed, or by anything that put a
 * value in it we don't know, read as `queued` rather than vanishing from the
 * queue — an order nobody can see is an order nobody makes.
 */
export function normalizeStage(stage: string): FulfilmentStage {
  return (FULFILMENT_STAGES as readonly string[]).includes(stage)
    ? (stage as FulfilmentStage)
    : "queued";
}

/** The single step forward offered on each row. Null at the end of the line. */
export function nextStage(stage: FulfilmentStage): FulfilmentStage | null {
  return FULFILMENT_STAGES[stageIndex(stage) + 1] ?? null;
}

/** What the order looks like to the transition rule. */
export type StageSubject = {
  /** Order.status — open | partial | complete | cancelled. */
  status: string;
  /** Null when no manager has approved the payment behind it. */
  approvedAt: Date | null;
  from: FulfilmentStage;
};

export type StageDecision =
  | { allowed: true; noop: boolean }
  | { allowed: false; reason: string };

/**
 * May this user move this order to this stage?
 *
 * Pulled out of the server action so the rule can be tested directly. The
 * action still owns authentication and the write; everything that decides
 * yes or no is here, which is the part worth pinning — the failure it
 * prevents is an order marked `dispatched` that was never produced, which
 * reads to the office as "sent to the customer", empties it out of the queue,
 * and is only discovered when the customer rings to ask where their bricks
 * are.
 *
 * A supervisor may only step FORWARD BY ONE. Owner/manager (`fullAccess`) may
 * set any stage in either direction, because correcting a mis-click is their
 * job and a supervisor who fat-fingers `ready` must have somebody able to put
 * it back.
 */
export function decideStageChange(
  subject: StageSubject,
  to: FulfilmentStage,
  opts: { fullAccess: boolean }
): StageDecision {
  // A double-tap, not an error. Reported as a no-op so the caller can skip
  // the write (and the stageChangedAt reset that would restart the clock).
  if (subject.from === to) return { allowed: true, noop: true };
  if (opts.fullAccess) return { allowed: true, noop: false };

  // The queue only lists orders whose payment was approved and which are
  // still live. Anything else reaching this rule is not something the
  // supervisor saw on screen, so it is not theirs to move either.
  if (!subject.approvedAt) {
    return { allowed: false, reason: "This order's payment has not been approved yet" };
  }
  if (subject.status === "cancelled" || subject.status === "complete") {
    return { allowed: false, reason: `This order is ${subject.status} — its stage is fixed` };
  }

  const step = stageIndex(to) - stageIndex(subject.from);
  if (step < 0) return { allowed: false, reason: "Only a manager can move an order back a stage" };
  if (step > 1) {
    return {
      allowed: false,
      reason: `Move the order one stage at a time — it cannot jump straight to ${to.replace("_", " ")}`,
    };
  }
  return { allowed: true, noop: false };
}

// How long this order has sat where it is, phrased to sit in front of "ago".
// The shared relativeTime() switches to a calendar date past a week ("12
// Oct"), which reads as nonsense in that sentence — and "waiting 11d" is
// exactly the number this queue exists to surface. Same helper shape as the
// quotation send list for the same reason.
export function waitingLabel(since: Date): string {
  const mins = Math.max(0, Math.floor((Date.now() - since.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
