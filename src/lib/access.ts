// Areas of the app that access can be granted for. The admin/owner role
// always has full access; other users get only the areas in their
// `permissions` list. "revenue" is special — it gates money totals
// (dashboard cash/profit, reports revenue, cashbook) rather than a page.
export const ACCESS_AREAS = [
  { key: "production", label: "Production" },
  { key: "die", label: "Dies (moulds)" },
  { key: "day", label: "Daily entry" },
  { key: "leads", label: "Leads (call enquiries)" },
  { key: "sales", label: "Clients & Sales" },
  { key: "deliveries", label: "Deliveries" },
  { key: "tipper", label: "Tipper" },
  { key: "mason", label: "Mason work" },
  { key: "loading", label: "Loading work" },
  { key: "expense", label: "Expense" },
  { key: "employees", label: "Employees" },
  { key: "leave", label: "Leave marking" },
  { key: "payroll", label: "Payroll" },
  { key: "cash", label: "Cashbook" },
  { key: "reports", label: "Reports" },
  { key: "vehicles", label: "Vehicles & EMI" },
  { key: "whatsapp", label: "WhatsApp nurturing" },
  { key: "quotations", label: "Quotations" },
  // Split from `quotations` on purpose. Reviewing and sending a quotation
  // move a status and write no amounts, so a telecaller can hold these
  // without `revenue` — the same reasoning that already lets
  // markQuotationSent run without price access while generateQuotation
  // cannot.
  { key: "quoteReview", label: "Review & approve quotations" },
  { key: "quoteSend", label: "Send approved quotations" },
  { key: "leadIntake", label: "Lead intake log & replay" },
  { key: "revenue", label: "See revenue, profit & cash totals" },
] as const;

export type AreaKey = (typeof ACCESS_AREAS)[number]["key"];

export type AccessUser = { role: string; permissions: string[] };

/**
 * Unrestricted access.
 *
 * `manager` now sits alongside owner/admin: the factory runs with the owner
 * and the manager seeing the same system, and a manager who could not price a
 * quotation or open Settings could not cover for the owner. They stay
 * separate ROLE STRINGS because the task hierarchy in lib/roles.ts still has
 * to tell them apart — an owner assigns work to a manager, never the reverse.
 *
 * The name is kept as isAdmin() because ~20 call sites across the app read
 * "is this user unrestricted"; lib/roles.ts exports isFullAccess() as the
 * clearer name for new code, and isOwner() for anything that must outrank a
 * manager.
 */
export function isAdmin(role: string) {
  return role === "admin" || role === "owner" || role === "manager";
}

export function can(user: AccessUser, area: string) {
  if (isAdmin(user.role)) return true;
  return user.permissions.includes(area);
}

/**
 * Areas granted to a role by default when a user is created. Not a ceiling —
 * an owner can grant any area to anyone from Settings -> Users; this is only
 * the sensible starting point so a new supervisor or telecaller is useful
 * immediately instead of seeing an empty app.
 */
export const DEFAULT_AREAS_BY_ROLE: Record<string, string[]> = {
  // Everything, via isAdmin — listing areas here would be misleading.
  owner: [],
  admin: [],
  manager: [],
  // Runs production and gets stock out of the godown.
  // `die` is here because the register is theirs to keep: the mould goes
  // in, gets flipped and gets retired on the floor, not in the office.
  // Booking what it COST still needs `expense` on top — see
  // app/(app)/die/actions.ts.
  supervisor: ["production", "day", "deliveries", "loading", "tipper", "mason", "sales", "die"],
  // Works the phone: leads, the quotations they raise, reviewing them, and
  // sending them. `quoteReview` belongs here because the review gate was
  // built for exactly this person — the brief was that the quotation is
  // checked by "the telecaller or the person who spoke to the client" before
  // it goes out. Without it the queue exists and nobody who should staff it
  // can open it.
  telecaller: ["leads", "quotations", "quoteReview", "quoteSend", "whatsapp"],
  staff: [],
};
