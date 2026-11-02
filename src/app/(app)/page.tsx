import { requireSession } from "@/lib/auth";
import { can } from "@/lib/access";
import { isFullAccess } from "@/lib/roles";
import OwnerPanel from "./dashboard/owner-panel";
import SupervisorPanel from "./dashboard/supervisor-panel";
import TelecallerPanel from "./dashboard/telecaller-panel";

/**
 * The dashboard, which is no longer one dashboard.
 *
 * Four roles log into this app and three of them want a different first
 * screen: the owner and the manager want the business, the supervisor wants
 * the shop floor, the telecaller wants their own desk. One page showing all of
 * it would bury each of them in the other two's work.
 *
 * This file only ROUTES. All the fetching happens inside the panel that is
 * actually rendered, so a telecaller's dashboard runs a telecaller's queries
 * and never touches the cashbook — which is both faster and the simplest way
 * to be sure a panel cannot leak what it does not show.
 */
export default async function DashboardPage() {
  const session = await requireSession();

  // Owner and Manager share one panel: isFullAccess() is the same "sees the
  // whole system" test used everywhere else, so there is no second place for
  // the two of them to diverge.
  if (isFullAccess(session.role)) return <OwnerPanel session={session} />;

  if (session.role === "supervisor") return <SupervisorPanel session={session} />;

  // Legacy `staff` predates the four roles and can hold any mix of areas. One
  // who runs production gets the shop-floor panel; everyone else gets the
  // own-work panel, which shows only what belongs to the user looking at it
  // and so is the safe default for a role we cannot assume anything about.
  if (session.role === "staff" && can(session, "production")) {
    return <SupervisorPanel session={session} />;
  }

  return <TelecallerPanel session={session} />;
}
