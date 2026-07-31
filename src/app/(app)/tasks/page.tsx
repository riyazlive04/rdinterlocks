import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { formatISODate } from "@/lib/format";
import { TasksView, type TaskDTO } from "./tasks-view";
import { createTask, setTaskStatus, deleteTask } from "./actions";

export default async function TasksPage() {
  const session = await requireSession();
  const admin = isAdmin(session.role);

  const toDTO = (t: {
    id: string;
    title: string;
    details: string | null;
    status: string;
    statusReason: string | null;
    dueDate: Date | null;
    assignedTo?: { name: string } | null;
    createdBy?: { name: string } | null;
  }): TaskDTO => ({
    id: t.id,
    title: t.title,
    details: t.details,
    status: t.status,
    statusReason: t.statusReason,
    dueDate: t.dueDate ? formatISODate(t.dueDate) : null,
    assignedToName: t.assignedTo?.name ?? "-",
    createdByName: t.createdBy?.name ?? null,
  });

  // Soonest due date first; the view splits in-progress from closed itself.
  const order = [{ dueDate: "asc" as const }, { createdAt: "desc" as const }];

  const [myTasksRaw, allTasksRaw, assignable] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: session.userId },
      include: { assignedTo: true, createdBy: true },
      orderBy: order,
    }),
    admin
      ? prisma.task.findMany({
          include: { assignedTo: true, createdBy: true },
          orderBy: order,
        })
      : Promise.resolve([]),
    admin
      ? prisma.user.findMany({
          where: { active: true, role: { notIn: ["admin", "owner"] } },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title="Tasks"
        sub={admin ? "Assign work to your team and track it" : "Work assigned to you"}
      />
      <TasksView
        admin={admin}
        users={assignable.map((u) => ({ id: u.id, name: u.name, role: u.role }))}
        myTasks={myTasksRaw.map(toDTO)}
        allTasks={allTasksRaw.map(toDTO)}
        onCreate={async (d) => {
          "use server";
          await createTask(d);
        }}
        onSetStatus={async (id, status, reason) => {
          "use server";
          await setTaskStatus(id, status, reason);
        }}
        onDelete={async (id) => {
          "use server";
          await deleteTask(id);
        }}
      />
    </>
  );
}
