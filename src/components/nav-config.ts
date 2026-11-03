import { IconName } from "./icons";
import { can, isAdmin, type AccessUser } from "@/lib/access";

/**
 * The five groups the navigation is arranged into, in order.
 *
 * They follow the order-to-cash spine the app is built around — sell it, make
 * it, move it, bank it — with everything that administers the place rather
 * than running it at the end. The point is that a role with no business in a
 * group never sees its heading: a telecaller meets seven entries under one
 * heading instead of twenty-nine under none.
 */
export const NAV_GROUPS = [
  { key: "sell", label: "Sell" },
  { key: "make", label: "Make" },
  { key: "move", label: "Move" },
  { key: "money", label: "Money" },
  { key: "admin", label: "Admin" },
] as const;

export type NavGroupKey = (typeof NAV_GROUPS)[number]["key"];

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  matches?: string[];
  area?: string; // access area key; undefined = visible to all logged-in users
  adminOnly?: boolean;
  // Owner/admin OR manager. Used by the archive console, which both run.
  adminOrManager?: boolean;
  /**
   * Which group the item is filed under. An item with no group is not hidden
   * — it renders in the unheaded footer below the groups, so forgetting this
   * field misplaces an entry rather than losing a route.
   */
  group?: NavGroupKey;
};

/**
 * Items that sit above the groups with no heading of their own.
 *
 * The dashboard and the task list are not part of any one stretch of the
 * spine — every role lands on them — so filing them under a heading would
 * make them look like someone else's work.
 */
const PINNED_IDS = new Set(["home", "tasks"]);

export const primaryNav: NavItem[] = [
  { id: "home", label: "Dashboard", href: "/", icon: "Home" },
  { id: "tasks", label: "Tasks", href: "/tasks", icon: "Flag", matches: ["/tasks"] },
  {
    id: "production",
    label: "Production",
    href: "/production",
    icon: "Brick",
    matches: ["/production"],
    group: "make",
  },
  {
    id: "day",
    label: "Daily entry",
    href: "/day",
    icon: "Calendar",
    matches: ["/day"],
    group: "make",
  },
  {
    id: "leads",
    label: "Leads",
    href: "/leads",
    icon: "Mic",
    matches: ["/leads"],
    group: "sell",
  },
  {
    id: "sales",
    label: "Clients & Sales",
    href: "/clients",
    icon: "Receipt",
    matches: ["/clients"],
    group: "sell",
  },
  {
    id: "deliveries",
    label: "Deliveries",
    href: "/deliveries",
    icon: "Stack",
    matches: ["/deliveries"],
    group: "move",
  },
  {
    id: "tipper",
    label: "Tipper",
    href: "/tipper",
    icon: "Truck",
    matches: ["/tipper"],
    group: "move",
  },
  {
    id: "mason",
    label: "Mason",
    href: "/mason",
    icon: "Hammer",
    matches: ["/mason"],
    group: "make",
  },
  {
    id: "loading",
    label: "Loading",
    href: "/loading",
    icon: "Box",
    matches: ["/loading"],
    group: "make",
  },
  {
    id: "expense",
    label: "Expense",
    href: "/expense",
    icon: "Tag",
    matches: ["/expense"],
    group: "money",
  },
  {
    id: "employees",
    label: "Employees",
    href: "/employees",
    icon: "Users",
    matches: ["/employees"],
    group: "admin",
  },
  {
    id: "leave",
    label: "Leave",
    href: "/leave",
    icon: "Calendar",
    matches: ["/leave"],
    group: "admin",
  },
  {
    id: "payroll",
    label: "Payroll",
    href: "/payroll",
    icon: "Workers",
    matches: ["/payroll"],
    group: "admin",
  },
  {
    id: "cash",
    label: "Cashbook",
    href: "/cash",
    icon: "Cash",
    matches: ["/cash"],
    group: "money",
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    icon: "Chart",
    matches: ["/reports"],
    group: "money",
  },
  {
    id: "vehicles",
    label: "Vehicles & EMI",
    href: "/vehicles",
    icon: "Truck",
    matches: ["/vehicles"],
    group: "move",
  },
  {
    id: "quotations",
    label: "Quotations",
    href: "/quotations",
    icon: "FileText",
    matches: ["/quotations"],
    group: "sell",
  },
  {
    id: "duty",
    label: "On duty",
    href: "/duty",
    icon: "Clock",
    matches: ["/duty"],
    area: "leads",
    group: "sell",
  },
  {
    id: "payments",
    label: "Payment approvals",
    href: "/payments",
    icon: "Receipt",
    matches: ["/payments"],
    // Approving a payment is a manager/owner act, not a grantable area — the
    // page enforces isFullAccess, and adminOrManager keeps the nav honest
    // about that rather than showing a link that redirects.
    adminOrManager: true,
    group: "money",
  },
  {
    id: "die",
    label: "Dies (moulds)",
    href: "/die",
    icon: "Tools",
    matches: ["/die"],
    group: "make",
  },
  {
    id: "collections",
    label: "Collections",
    href: "/collections",
    icon: "Cash",
    matches: ["/collections"],
    // `revenue` is already "may see money totals", which is exactly what an
    // outstanding-balance queue is. No new access area for it.
    area: "revenue",
    group: "money",
  },
  {
    id: "fulfilment",
    label: "Production queue",
    href: "/fulfilment",
    icon: "Truck",
    matches: ["/fulfilment"],
    area: "production",
    group: "make",
  },
  {
    id: "quote-review",
    label: "Quote review",
    href: "/quotations/review",
    icon: "Check",
    matches: ["/quotations/review"],
    area: "quoteReview",
    group: "sell",
  },
  {
    id: "quote-send",
    label: "Send list",
    href: "/quotations/send",
    icon: "Chat",
    matches: ["/quotations/send"],
    area: "quoteSend",
    group: "sell",
  },
  {
    id: "lead-intake",
    label: "Lead intake",
    href: "/leads/intake",
    icon: "Download",
    matches: ["/leads/intake"],
    area: "leadIntake",
    group: "sell",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    href: "/whatsapp",
    icon: "Chat",
    matches: ["/whatsapp"],
    group: "sell",
  },
  {
    id: "guide",
    label: "App guide",
    href: "/guide",
    icon: "Phone",
    matches: ["/guide"],
  },
  {
    id: "archive",
    label: "Hide data & backups",
    href: "/archive",
    icon: "Download",
    matches: ["/archive"],
    adminOrManager: true,
    group: "admin",
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: "Settings",
    matches: ["/settings"],
    group: "admin",
  },
];

// Mobile bottom nav - 5 most-used. Everything else lives behind a "More" sheet.
export const mobileNav: NavItem[] = [
  { id: "home", label: "Home", href: "/", icon: "Home" },
  { id: "production", label: "Production", href: "/production", icon: "Brick", matches: ["/production"] },
  { id: "sales", label: "Sales", href: "/clients", icon: "Receipt", matches: ["/clients"] },
  { id: "cash", label: "Cash", href: "/cash", icon: "Cash", matches: ["/cash"] },
  { id: "more", label: "More", href: "/menu", icon: "Menu", matches: ["/menu"] },
];

export function isNavActive(item: NavItem, pathname: string) {
  if (item.href === "/" && pathname === "/") return true;
  if (item.matches?.some((m) => pathname.startsWith(m))) return true;
  return false;
}

// Items always shown to any logged-in user (no specific area gate).
const ALWAYS_VISIBLE = new Set(["home", "tasks", "guide", "more"]);

// Filter a nav list to what the user may access. Each operational item's id
// doubles as its access-area key; "settings" is admin-only.
export function visibleNav(items: NavItem[], user: AccessUser): NavItem[] {
  return items.filter((it) => {
    if (it.adminOrManager) return isAdmin(user.role) || user.role === "manager";
    if (it.id === "settings" || it.adminOnly) return isAdmin(user.role);
    if (ALWAYS_VISIBLE.has(it.id)) return true;
    return can(user, it.area ?? it.id);
  });
}

export type NavSection = { key: NavGroupKey; label: string; items: NavItem[] };

export type GroupedNav = {
  /** Above the groups, no heading. */
  pinned: NavItem[];
  /** Only groups with at least one visible item. */
  groups: NavSection[];
  /** Below the groups, no heading. Also catches any item filed nowhere. */
  footer: NavItem[];
};

/**
 * Arrange the navigation into its groups.
 *
 * This is a VIEW OVER `visibleNav`, never a second filter — it calls it and
 * partitions the result, so grouping cannot grant or withhold anything. That
 * is the whole safety property of the feature: whatever a role could reach
 * before it reaches after, and `visibleNav` keeps sole authority over
 * visibility. An empty group is dropped rather than rendered with a heading
 * and nothing under it.
 */
export function groupedNav(items: NavItem[], user: AccessUser): GroupedNav {
  const visible = visibleNav(items, user);
  const pinned: NavItem[] = [];
  const footer: NavItem[] = [];
  const buckets = new Map<NavGroupKey, NavItem[]>(NAV_GROUPS.map((g) => [g.key, []]));

  for (const it of visible) {
    if (PINNED_IDS.has(it.id)) pinned.push(it);
    // An unfiled item falls through to the footer rather than being dropped:
    // the wrong place is recoverable, a missing route is not.
    else if (it.group) buckets.get(it.group)!.push(it);
    else footer.push(it);
  }

  return {
    pinned,
    groups: NAV_GROUPS.filter((g) => buckets.get(g.key)!.length > 0).map((g) => ({
      key: g.key,
      label: g.label,
      items: buckets.get(g.key)!,
    })),
    footer,
  };
}
