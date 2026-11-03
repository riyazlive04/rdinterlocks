/**
 * Navigation grouping — build-docs/features/navigation-by-role.md
 *
 * Pure logic, no database: `groupedNav` takes a user object and returns an
 * arrangement, so the whole feature is testable without Postgres. That is
 * also why it is in its own suite rather than bolted onto run-rbac.ts —
 * this one runs anywhere, including CI with no services.
 *
 * Run: npx tsx scripts/e2e/run-nav.ts
 */

import { tc, eq, ok, run } from "./harness";
import {
  primaryNav,
  mobileNav,
  visibleNav,
  groupedNav,
  isNavActive,
  NAV_GROUPS,
  type NavGroupKey,
} from "@/components/nav-config";
import { DEFAULT_AREAS_BY_ROLE, type AccessUser } from "@/lib/access";
import { ROLES } from "@/lib/roles";

const userFor = (role: string): AccessUser => ({
  role,
  permissions: DEFAULT_AREAS_BY_ROLE[role] ?? [],
});

const ids = (items: { id: string }[]) => items.map((i) => i.id).sort();

/** Every item the grouped view renders, in render order. */
function flattenGrouped(role: string): string[] {
  const nav = groupedNav(primaryNav, userFor(role));
  return [
    ...nav.pinned.map((i) => i.id),
    ...nav.groups.flatMap((g) => g.items.map((i) => i.id)),
    ...nav.footer.map((i) => i.id),
  ];
}

const groupKeys = (role: string): NavGroupKey[] =>
  groupedNav(primaryNav, userFor(role)).groups.map((g) => g.key);

/**
 * AC NAV-01 / NAV-05: grouping is a VIEW, not a second filter.
 *
 * This is the one test that makes the feature safe. If grouping ever drops an
 * item — an entry filed under a group key that does not exist, a typo in the
 * bucket map — a role silently loses a route, and on mobile the /menu sheet
 * is the only way to that route at all. Set equality against visibleNav for
 * every role in the hierarchy is what catches it.
 */
const noAccessChange = tc("NAV-01", "grouping neither grants nor loses a route", () => {
  for (const role of ROLES) {
    const flat = ids(visibleNav(primaryNav, userFor(role)));
    const grouped = flattenGrouped(role).sort();
    eq(`${role}: grouped set === visibleNav set`, grouped, flat);
  }
});

/** AC NAV-01: no item is rendered twice (two groups, or a group and the footer). */
const noDuplicates = tc("NAV-02", "no item appears in more than one place", () => {
  for (const role of ROLES) {
    const rendered = flattenGrouped(role);
    eq(`${role}: no duplicates`, rendered.length, new Set(rendered).size);
  }
});

/** AC NAV-02: a telecaller meets the Sell group and nothing else. */
const telecaller = tc("NAV-03", "a telecaller sees only Sell", () => {
  eq("groups", groupKeys("telecaller"), ["sell"]);
  const nav = groupedNav(primaryNav, userFor("telecaller"));
  // Six, not seven: `leadIntake` is NOT a telecaller default, so the Lead
  // intake entry only appears once an owner grants it. Asserted exactly,
  // because "roughly the sell items" would not have caught that.
  eq("Sell holds their six default entries", ids(nav.groups[0].items), [
    "duty",
    "leads",
    "quotations",
    "quote-review",
    "quote-send",
    "whatsapp",
  ]);
  eq("pinned stays reachable", ids(nav.pinned), ["home", "tasks"]);
  eq("the guide stays reachable", ids(nav.footer), ["guide"]);
  ok("no Money heading", !groupKeys("telecaller").includes("money"));
  ok("no Admin heading", !groupKeys("telecaller").includes("admin"));

  // Grouping follows the GRANT, not the role: granting one extra area adds
  // its entry to the right group and opens no other.
  const granted = groupedNav(primaryNav, {
    role: "telecaller",
    permissions: [...DEFAULT_AREAS_BY_ROLE.telecaller, "leadIntake"],
  });
  eq("a granted area adds no new group", granted.groups.map((g) => g.key), ["sell"]);
  ok(
    "and lands in Sell",
    ids(granted.groups[0].items).includes("lead-intake")
  );
});

/**
 * AC NAV-03: a supervisor sees Make and Move — plus the one Sell item they
 * are actually granted.
 *
 * The plan said "a supervisor's menu shows only Make and Move". That was
 * wrong, and this test records why rather than hiding it: `sales` is in
 * DEFAULT_AREAS_BY_ROLE.supervisor, so a supervisor can open Clients & Sales
 * today. Dropping it from their menu would be an ACCESS change, which this
 * feature is defined not to make — it would leave a page they can open with
 * no link to it.
 */
const supervisor = tc("NAV-04", "a supervisor sees Make, Move and their granted Sell items", () => {
  eq("groups", groupKeys("supervisor"), ["sell", "make", "move"]);
  const nav = groupedNav(primaryNav, userFor("supervisor"));
  const byKey = new Map(nav.groups.map((g) => [g.key, g.items]));
  // `register` (area sales) and `avm` (area tipper) joined these two
  // groups when main was merged in. They are listed here rather than
  // filtered out BY THE RULE THIS TEST RECORDS above: a supervisor holds
  // `sales` and `tipper`, so they can already open /clients/register and
  // /avm, and leaving them out of the menu would be the one thing this
  // feature is defined not to do — a reachable page with no link to it.
  eq("Sell is Clients & Sales plus the register", ids(byKey.get("sell")!), ["register", "sales"]);
  eq("Make", ids(byKey.get("make")!), ["day", "die", "fulfilment", "loading", "mason", "production"]);
  eq("Move", ids(byKey.get("move")!), ["avm", "deliveries", "tipper"]);
  ok("no Money heading", !byKey.has("money"));
  ok("no Admin heading", !byKey.has("admin"));
  ok("vehicles stays hidden (not granted)", !ids(byKey.get("move")!).includes("vehicles"));
});

/** AC NAV-04: owner and manager see all five. */
const fullAccess = tc("NAV-05", "owner and manager see all five groups", () => {
  const all = NAV_GROUPS.map((g) => g.key);
  eq("owner", groupKeys("owner"), all);
  eq("admin", groupKeys("admin"), all);
  eq("manager", groupKeys("manager"), all);
  const nav = groupedNav(primaryNav, userFor("owner"));
  const money = nav.groups.find((g) => g.key === "money")!;
  eq("Money holds the collections queue", ids(money.items), [
    "cash",
    "collections",
    "expense",
    "payments",
    "reports",
  ]);
});

/** AC NAV-06: an empty group is absent, not a heading with nothing under it. */
const noEmptyGroups = tc("NAV-06", "empty groups are omitted", () => {
  for (const role of ROLES) {
    const nav = groupedNav(primaryNav, userFor(role));
    ok(
      `${role}: every rendered group has items`,
      nav.groups.every((g) => g.items.length > 0)
    );
  }
  // `staff` holds no areas at all: the proof that a role with nothing in any
  // group still gets a usable sidebar rather than a blank one.
  const staff = groupedNav(primaryNav, userFor("staff"));
  eq("staff has no groups", staff.groups.length, 0);
  eq("staff keeps the dashboard and tasks", ids(staff.pinned), ["home", "tasks"]);
  eq("staff keeps the guide", ids(staff.footer), ["guide"]);
});

/**
 * Every item is filed somewhere deliberate. An unfiled item still renders
 * (it falls to the footer, so no route is lost) but that is a fallback, not
 * the intent — this asserts the intent for an owner, who sees everything.
 */
const everythingFiled = tc("NAV-07", "every nav entry is filed on purpose", () => {
  const unfiled = primaryNav.filter((it) => !it.group && !["home", "tasks", "guide"].includes(it.id));
  eq(`nothing unfiled (got ${unfiled.map((i) => i.id).join(", ") || "none"})`, unfiled.length, 0);
  const owner = groupedNav(primaryNav, userFor("owner"));
  eq("the owner's footer is the guide alone", ids(owner.footer), ["guide"]);
});

/** The bottom nav is untouched by this feature and must stay five items. */
const bottomNavUntouched = tc("NAV-08", "the mobile bottom nav is unchanged", () => {
  eq("five items", mobileNav.length, 5);
  eq("owner sees all five", visibleNav(mobileNav, userFor("owner")).length, 5);
  ok("'More' is always visible", ids(visibleNav(mobileNav, userFor("staff"))).includes("more"));
});

/** Active-state matching, since the sidebar rewrite re-renders every link. */
const activeState = tc("NAV-09", "active highlighting still resolves", () => {
  const find = (id: string) => primaryNav.find((i) => i.id === id)!;
  ok("dashboard active only at /", isNavActive(find("home"), "/"));
  ok("dashboard not active elsewhere", !isNavActive(find("home"), "/leads"));
  ok("leads active on a child route", isNavActive(find("leads"), "/leads/board"));
  // /quotations/review must light the review entry; it also prefix-matches
  // /quotations, which is why both are listed rather than assumed exclusive.
  ok("collections active", isNavActive(find("collections"), "/collections"));
  ok("quote review active", isNavActive(find("quote-review"), "/quotations/review"));
});

run("Navigation grouping", [
  noAccessChange,
  noDuplicates,
  telecaller,
  supervisor,
  fullAccess,
  noEmptyGroups,
  everythingFiled,
  bottomNavUntouched,
  activeState,
]);
