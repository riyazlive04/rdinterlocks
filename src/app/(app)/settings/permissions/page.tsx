import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { groupedAreas, isAdmin } from "@/lib/access";
import { canSetUserAreas } from "@/lib/roles";
import { PageHeader, Card } from "@/components/ui";
import { PermissionMatrix, type PermUser } from "./matrix";
import { setUserArea } from "../actions";

/**
 * The permission center: every login against every area, in one grid.
 *
 * Settings → Users & access already edits one person at a time — role,
 * password, disabled, and a grant per area. This does not replace it. What it
 * adds is the view that editor cannot give: a column per area, so "who can
 * see the cashbook?" is one glance instead of opening every login in turn.
 */
export default async function PermissionsPage() {
  const session = await requireAdmin();
  const [users, groups] = await Promise.all([
    prisma.user.findMany({ orderBy: [{ active: "desc" }, { createdAt: "asc" }] }),
    Promise.resolve(groupedAreas()),
  ]);

  const rows: PermUser[] = users.map((u) => {
    // The same decision the action enforces, asked here so a row the signed-in
    // user may not change is rendered disabled rather than offered and then
    // refused.
    const decision = canSetUserAreas(
      { userId: session.userId, role: session.role },
      { id: u.id, role: u.role }
    );
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      active: u.active,
      permissions: u.permissions,
      fullAccess: isAdmin(u.role),
      editable: decision.allowed,
      lockedReason: decision.allowed ? "" : decision.reason,
    };
  });

  return (
    <>
      <PageHeader
        title="Permission center"
        sub="Who can open what — tick to grant, untick to take away"
        back="/settings"
        right={
          <Link
            href="/settings/users"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
          >
            Add a login
          </Link>
        }
      />

      {users.length === 0 ? (
        <Card>
          <div className="text-center text-sm text-slate-500 py-6">
            No logins yet.{" "}
            <Link href="/settings/users" className="underline">
              Create one first.
            </Link>
          </div>
        </Card>
      ) : (
        <PermissionMatrix
          users={rows}
          groups={groups}
          onToggle={async (userId, area, granted) => {
            "use server";
            await setUserArea(userId, area, granted);
          }}
        />
      )}
    </>
  );
}
