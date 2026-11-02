// Presentation helpers for the lead activity log, shared by the "Log a call"
// form (client) and the timeline on the lead detail page (server) so a kind
// or an outcome reads the same in both. Deliberately mirrors the shape of
// stageLabel/stageTone in @/lib/leads.
//
// LeadActivity.kind and .outcome are stored free-form — the office can start
// recording a new disposition without a migration — so both lookups fall back
// to the raw value rather than assuming the lists below are exhaustive.

export const ACTIVITY_KINDS = ["call", "whatsapp", "visit", "note"] as const;

export const ACTIVITY_KIND_LABELS: Record<string, string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  visit: "Visit",
  note: "Note",
  stage: "Stage change",
  assign: "Assignment",
  quote: "Quotation",
};

export function kindLabel(kind: string): string {
  return ACTIVITY_KIND_LABELS[kind] ?? kind.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Call dispositions, in the order a telecaller works down them.
export const ACTIVITY_OUTCOMES = [
  "connected",
  "no-answer",
  "busy",
  "wrong-number",
  "not-interested",
  "call-back",
  "qualified",
] as const;

export const ACTIVITY_OUTCOME_LABELS: Record<string, string> = {
  connected: "Connected",
  "no-answer": "No answer",
  busy: "Busy",
  "wrong-number": "Wrong number",
  "not-interested": "Not interested",
  "call-back": "Call back",
  qualified: "Qualified",
};

export function outcomeLabel(outcome: string): string {
  return ACTIVITY_OUTCOME_LABELS[outcome] ?? outcome.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function outcomeTone(outcome: string): "slate" | "blue" | "warning" | "success" | "danger" {
  switch (outcome) {
    case "qualified":
      return "success";
    case "connected":
      return "blue";
    case "call-back":
      return "warning";
    case "not-interested":
    case "wrong-number":
      return "danger";
    default:
      return "slate";
  }
}
