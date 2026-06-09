import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { ACCESS_AREAS } from "@/lib/access";
import { UsersManager } from "./manager";
import { createUser, updateUser, deleteUser } from "../actions";

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
        areas={ACCESS_AREAS.map((a) => ({ key: a.key, label: a.label }))}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          active: u.active,
          permissions: u.permissions,
        }))}
        onCreate={async (d) => {
          "use server";
          await createUser(d);
        }}
        onUpdate={async (id, d) => {
          "use server";
          await updateUser(id, d);
        }}
        onDelete={async (id) => {
          "use server";
          await deleteUser(id);
        }}
      />
    </>
  );
}
