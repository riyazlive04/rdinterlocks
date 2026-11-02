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
