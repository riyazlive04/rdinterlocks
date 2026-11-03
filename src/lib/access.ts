// Areas of the app that access can be granted for. The admin/owner role
// always has full access; other users get only the areas in their
// `permissions` list. "revenue" is special — it gates money totals
// (dashboard cash/profit, reports revenue, cashbook) rather than a page.
export const ACCESS_AREAS = [
  { key: "production", label: "Production", group: "make" },
  { key: "die", label: "Dies (moulds)", group: "make" },
  { key: "day", label: "Daily entry", group: "make" },
  { key: "leads", label: "Leads (call enquiries)", group: "sell" },
  { key: "sales", label: "Clients & Sales", group: "sell" },
  { key: "deliveries", label: "Deliveries", group: "move" },
  { key: "tipper", label: "Tipper", group: "move" },
  { key: "mason", label: "Mason work", group: "make" },
  { key: "loading", label: "Loading work", group: "make" },
  { key: "expense", label: "Expense", group: "money" },
  { key: "employees", label: "Employees", group: "admin" },
  { key: "leave", label: "Leave marking", group: "admin" },
  { key: "payroll", label: "Payroll", group: "admin" },
  { key: "cash", label: "Cashbook", group: "money" },
  { key: "reports", label: "Reports", group: "money" },
  { key: "vehicles", label: "Vehicles & EMI", group: "move" },
  { key: "whatsapp", label: "WhatsApp nurturing", group: "sell" },
  { key: "quotations", label: "Quotations", group: "sell" },
  // Split from `quotations` on purpose. Reviewing and sending a quotation
  // move a status and write no amounts, so a telecaller can hold these
  // without `revenue` — the same reasoning that already lets
  // markQuotationSent run without price access while generateQuotation
  // cannot.
  { key: "quoteReview", label: "Review & approve quotations", group: "sell" },
  { key: "quoteSend", label: "Send approved quotations", group: "sell" },
  { key: "leadIntake", label: "Lead intake log & replay", group: "sell" },
  { key: "revenue", label: "See revenue, profit & cash totals", group: "money" },
] as const;

export type AreaKey = (typeof ACCESS_AREAS)[number]["key"];

/**
 * The five groups the areas are presented in — the SAME vocabulary the
 * navigation uses (components/nav-config.ts), so the permission screen reads
 * in the same order as the menu the grant controls. 22 flat checkboxes in
 * declaration order is the wall phase 6 removed from the sidebar, and this is
 * the one place where a mis-click hands somebody the payroll.
 */
export const AREA_GROUPS = [
  { key: "sell", label: "Sell" },
  { key: "make", label: "Make" },
  { key: "move", label: "Move" },
  { key: "money", label: "Money" },
  { key: "admin", label: "Admin" },
] as const;

export type AreaGroupKey = (typeof AREA_GROUPS)[number]["key"];

export type AreaGroup = {
  key: AreaGroupKey;
  label: string;
  areas: Array<{ key: string; label: string }>;
};

/**
 * Areas arranged into their groups, in group order.
 *
 * Every area carries a group, so nothing can fall out of this — an area
 * missing from a group would simply not render on either permission screen
 * and would look exactly like a revoked grant. PERM-01 asserts the coverage.
 */
export function groupedAreas(): AreaGroup[] {
  return AREA_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    areas: ACCESS_AREAS.filter((a) => a.group === g.key).map((a) => ({
      key: a.key,
      label: a.label,
    })),
  })).filter((g) => g.areas.length > 0);
}

/** Is this a real, grantable area? Guards the one action that writes grants. */
export function isAreaKey(key: string): key is AreaKey {
  return ACCESS_AREAS.some((a) => a.key === key);
}

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
