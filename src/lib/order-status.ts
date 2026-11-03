// The three states the office thinks in, mirroring how the paper register is
// marked up: an order is either still to start, running, or finished.
export const ORDER_STATUSES = [
  { key: "upcoming", label: "Upcoming", tone: "blue" as const },
  { key: "active", label: "Active", tone: "warning" as const },
  { key: "completed", label: "Completed", tone: "success" as const },
];

export type OrderStatus = "upcoming" | "active" | "completed" | "cancelled";

/**
 * Every spelling that means somebody is still owing bricks, and every one
 * that means nobody is.
 *
 * This app carried TWO order vocabularies until main was merged in:
 * `open`/`partial`/`complete` on one side, `upcoming`/`active`/`completed`
 * here. Screens written against one set silently matched nothing once a row
 * held the other — an owner's "Pending orders" panel reading
 * `in: ["open", "partial"]` went blank the moment the column defaulted to
 * `active`.
 *
 * Both lists therefore carry the LEGACY spellings as well as the canonical
 * ones, because rows written before the merge are still in the database and
 * are not rewritten by it. The canonical values come first and are the only
 * ones ever WRITTEN — deriveOrderStatus() below emits nothing else, and the
 * three chips in ORDER_STATUSES offer nothing else.
 *
 * A legacy `complete` counts as CLOSED rather than being left to fall
 * through as open: a finished order wrongly treated as open would reappear
 * in the fulfilment queue and the owner's pending panel, which is the louder
 * and more misleading of the two failures.
 */
export const OPEN_ORDER_STATUSES = ["upcoming", "active", "open", "partial"] as const;
export const CLOSED_ORDER_STATUSES = ["completed", "cancelled", "complete"] as const;

/** True while an order can still receive deliveries. */
export function isOrderOpen(status: string) {
  return !(CLOSED_ORDER_STATUSES as readonly string[]).includes(status);
}



export function orderStatusLabel(status: string) {
  return ORDER_STATUSES.find((s) => s.key === status)?.label ?? "Cancelled";
}

export function orderStatusTone(status: string) {
  return ORDER_STATUSES.find((s) => s.key === status)?.tone ?? "slate";
}

/**
 * Work out where an order stands from what has actually been delivered.
 *
 * - completed — everything ordered has gone out
 * - active    — part of it has gone out, or it is due now / overdue
 * - upcoming  — nothing delivered yet and the delivery date is still ahead
 *
 * A cancelled order stays cancelled; that is a decision, not something to
 * re-derive. Anything else the admin set by hand is only overridden once real
 * deliveries contradict it.
 */
export function deriveOrderStatus(o: {
  orderedQty: number;
  deliveredQty: number;
  date: Date;
  expectedDeliveryDate?: Date | null;
  current?: string;
  now?: Date;
}): OrderStatus {
  if (o.current === "cancelled") return "cancelled";
  if (o.orderedQty > 0 && o.deliveredQty >= o.orderedQty) return "completed";
  if (o.deliveredQty > 0) return "active";
  // Nothing delivered: an order the office already marked completed by hand
  // (the common case when deliveries aren't logged row by row) keeps that.
  if (o.current === "completed") return "completed";
  const due = o.expectedDeliveryDate ?? o.date;
  return due > (o.now ?? new Date()) ? "upcoming" : "active";
}
