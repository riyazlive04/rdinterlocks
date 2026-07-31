// The three states the office thinks in, mirroring how the paper register is
// marked up: an order is either still to start, running, or finished.
export const ORDER_STATUSES = [
  { key: "upcoming", label: "Upcoming", tone: "blue" as const },
  { key: "active", label: "Active", tone: "warning" as const },
  { key: "completed", label: "Completed", tone: "success" as const },
];

export type OrderStatus = "upcoming" | "active" | "completed" | "cancelled";

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
