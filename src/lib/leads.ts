// Shared presentation helpers for leads. Used by the /leads pages, the
// dashboard tile and the read API so a stage means the same thing everywhere.

export const STAGE_ORDER = ["new", "quoted", "negotiating", "won", "lost"] as const;

export const STAGE_LABELS: Record<string, string> = {
  new: "New",
  quoted: "Quoted",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
};

// Unrecognised stages are allowed through the import endpoint on purpose, so
// the UI must render them rather than assume the five canonical values.
export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function stageTone(stage: string): "slate" | "blue" | "warning" | "success" | "danger" {
  switch (stage) {
    case "new":
      return "slate";
    case "quoted":
      return "blue";
    case "negotiating":
      return "warning";
    case "won":
      return "success";
    case "lost":
      return "danger";
    default:
      return "slate";
  }
}

// A lead is "due" when its follow-up date is today or earlier and nobody has
// converted or discarded it yet.
export function isFollowUpDue(
  lead: { followUpDate: Date | null; status: string },
  now: Date = new Date()
): boolean {
  if (!lead.followUpDate) return false;
  if (lead.status !== "open") return false;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return lead.followUpDate.getTime() <= end.getTime();
}

/** "—" for a value the transcript never captured, so blanks read as intentional. */
export function orDash(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}
