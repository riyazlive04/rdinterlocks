export type Stage = "produced" | "drying" | "curing" | "ready";

// Derive a batch's curing stage purely from its age in days, using the
// owner-configurable thresholds in Settings. No manual "advance" needed:
//   day 0            -> Produced
//   1 .. dryingDays  -> Drying
//   .. curingDays    -> Curing
//   > curingDays     -> Ready (sellable)
export function stageForAge(
  producedAt: Date,
  dryingDays: number,
  curingDays: number,
  now: Date = new Date()
): Stage {
  const days = Math.floor((now.getTime() - producedAt.getTime()) / 86400000);
  if (days <= 0) return "produced";
  if (days <= dryingDays) return "drying";
  if (days <= curingDays) return "curing";
  return "ready";
}

export const stageLabel: Record<Stage, string> = {
  produced: "Produced",
  drying: "Drying",
  curing: "Curing",
  ready: "Ready",
};
