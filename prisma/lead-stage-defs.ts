export type LeadStageDef = {
  slug: string;
  name: string;
  sortOrder: number;
  colour: string;
  isDefault?: boolean;
  isWon?: boolean;
  isLost?: boolean;
};

// The five pipeline stages that used to live only as hard-coded
// Lead.quotationStage string values (see src/lib/leads.ts STAGE_ORDER).
// Shared by prisma/seed.ts (fresh install) and
// prisma/backfill-lead-stages.ts (one-off production backfill) so both
// create the exact same rows.
export const LEAD_STAGE_DEFS: LeadStageDef[] = [
  { slug: "new", name: "New", sortOrder: 1, colour: "#64748B", isDefault: true },
  // Spoken to, and worth quoting. The gap this fills: "new" covered both a
  // lead nobody had called yet and one that had been qualified on the phone
  // but not yet priced, so the pipeline could not distinguish work not
  // started from work in progress. It is also the default trigger for
  // auto-drafting a quotation (Settings.autoQuoteOnStage).
  { slug: "qualified", name: "Qualified", sortOrder: 2, colour: "#0891B2" },
  { slug: "quoted", name: "Quoted", sortOrder: 3, colour: "#2563EB" },
  { slug: "negotiating", name: "Negotiating", sortOrder: 4, colour: "#D97706" },
  { slug: "won", name: "Won", sortOrder: 5, colour: "#16A34A", isWon: true },
  { slug: "lost", name: "Lost", sortOrder: 6, colour: "#DC2626", isLost: true },
];
