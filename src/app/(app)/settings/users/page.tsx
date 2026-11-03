import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { groupedAreas } from "@/lib/access";
import { UsersManager } from "./manager";
import { createUser, updateUser, deleteUser } from "../actions";

// The role accepted by createUser/updateUser, taken from their own zod enum
// rather than restated here, so the form can never offer a role the action
// would reject. That enum is now derived from ROLES, so all six are valid.
type ActionRole = Parameters<typeof createUser>[0]["role"];

export default async function UsersPage() {
  await requireAdmin();
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return (
    <>
      <PageHeader
        title="Users & access"
        sub="Create logins for staff and choose what each can see"
        back="/settings"
      />
      <UsersManager
        areaGroups={groupedAreas()}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          active: u.active,
          permissions: u.permissions,
        }))}
        onCreate={async (d) => {
          "use server";
          await createUser({ ...d, role: d.role as ActionRole });
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateUser(id, { ...d, role: d.role as ActionRole });
        }}
        onDelete={async (id) => {
          "use server";
          await deleteUser(id);
        }}
      />
    </>
  );
}
