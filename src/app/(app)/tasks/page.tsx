import { prisma } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { requireSession } from "@/lib/auth";
import { assignableRoles, canDelegate, canManageTaskOf, roleLabel } from "@/lib/roles";
import { formatISODate, formatNumber } from "@/lib/format";
import { TasksView, type TaskDTO } from "./tasks-view";
import {
  createTask,
  deleteTask,
  reassignTask,
  setTaskStatus,
  setTaskStatusReason,
} from "./actions";

export default async function TasksPage() {
  const session = await requireSession();

  // Who this user may hand work to, by role. Driven entirely by
  // lib/roles.ts, so an owner sees managers in the list while a manager does
  // not — and a telecaller gets an empty list, no create form, and still a
  // useful screen made of their own tasks.
  const delegates = canDelegate(session.role);
  const teamRoles = assignableRoles(session.role);

  // "open" before "done", then soonest due date first. Overdue is pulled to
  // the top of each section afterwards, once we know today's date.
  const order = [{ status: "asc" as const }, { dueDate: "asc" as const }, { createdAt: "desc" as const }];
  const include = { assignedTo: true, createdBy: true };

  const [mineRaw, byMeRaw, teamRaw, assignable] = await Promise.all([
    // Assigned to me.
    prisma.task.findMany({
      where: { assignedToId: session.userId },
      include,
      orderBy: order,
    }),
    // Assigned by me — the other half of a delegator's day, and the only
    // place a task they handed out shows up once it has left their desk.
    prisma.task.findMany({
      where: { createdById: session.userId },
      include,
      orderBy: order,
    }),
    // My team's tasks: everyone whose role sits below mine in the chain,
    // whoever gave them the work. A manager sees the supervisors' and
    // telecallers' load even for tasks the owner assigned.
    delegates
      ? prisma.task.findMany({
          where: { assignedTo: { role: { in: [...teamRoles] } } },
          include,
          orderBy: order,
        })
      : Promise.resolve([]),
    // The assignable list is a role filter, not a "not an admin" filter: an
    // owner may legitimately put work on a manager.
    delegates
      ? prisma.user.findMany({
          where: { active: true, role: { in: [...teamRoles] } },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const today = formatISODate(new Date());

  // Row-level permissions are decided here, server-side, from the
  // assignee's stored role — the same calls the actions make. The client
  // only gets booleans, so a hidden button is never the thing protecting an
  // action; the action re-checks regardless.
  const toDTO = (t: {
    id: string;
    title: string;
    details: string | null;
    status: string;
    statusReason: string | null;
    dueDate: Date | null;
    assignedToId: string;
    createdById: string | null;
    assignedTo?: { name: string; role: string } | null;
    createdBy?: { name: string } | null;
  }): TaskDTO => {
    const assigneeRole = t.assignedTo?.role ?? "staff";
    const isMine = t.assignedToId === session.userId;
    const outranks = canManageTaskOf(session.role, assigneeRole);
    const isCreator = t.createdById === session.userId;
    return {
      id: t.id,
      title: t.title,
      details: t.details,
      status: t.status,
      statusReason: t.statusReason,
      dueDate: t.dueDate ? formatISODate(t.dueDate) : null,
      assignedToName: t.assignedTo?.name ?? "-",
      assigneeRoleLabel: roleLabel(assigneeRole),
      createdByName: t.createdBy?.name ?? null,
      isMine,
      // Completing is the assignee's own right; everyone else must outrank
      // them.
      canManage: isMine || outranks,
      canReassign: delegates && (isCreator || outranks),
      // Never the assignee alone — finishing is theirs, deleting is not.
      canRemove: isCreator || outranks,
    };
  };

  // Overdue first within a section, then whatever order the DB gave us.
  const overdue = (t: TaskDTO) => t.status !== "done" && !!t.dueDate && t.dueDate < today;
  const overdueFirst = (rows: TaskDTO[]) =>
    [...rows].sort((a, b) => Number(overdue(b)) - Number(overdue(a)));

  const myTasks = overdueFirst(mineRaw.map(toDTO));
  const byMeTasks = overdueFirst(byMeRaw.map(toDTO));
  const teamTasks = overdueFirst(teamRaw.map(toDTO));

  const openCount = (rows: TaskDTO[]) => rows.filter((t) => t.status !== "done").length;
  const overdueCount = (rows: TaskDTO[]) => rows.filter(overdue).length;

  const myOpen = openCount(myTasks);
  const myOverdue = overdueCount(myTasks);
  const teamOpen = openCount(teamTasks);
  const teamOverdue = overdueCount(teamTasks);

  return (
    <>
      <PageHeader
        title="Tasks"
        sub={
          delegates
            ? `Assign work down the chain and track it — you can delegate to ${teamRoles
                .map(roleLabel)
                .join(", ")}`
            : "Work assigned to you"
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard
          label="My open tasks"
          value={formatNumber(myOpen)}
          sub="Assigned to you"
          tone="ink"
          icon={<Icon.Check size={16} />}
        />
        <StatCard
          label="My overdue"
          value={formatNumber(myOverdue)}
          sub={myOverdue > 0 ? "Past the due date" : "Nothing late"}
          tone={myOverdue > 0 ? "red" : "default"}
        />
        {delegates && (
          <>
            <StatCard
              label="Team open"
              value={formatNumber(teamOpen)}
              sub="Across everyone under you"
              tone="blue"
            />
            <StatCard
              label="Team overdue"
              value={formatNumber(teamOverdue)}
              sub={teamOverdue > 0 ? "Needs chasing" : "All on time"}
              tone={teamOverdue > 0 ? "red" : "default"}
            />
          </>
        )}
      </div>

      <TasksView
        canDelegate={delegates}
        users={assignable.map((u) => ({
          id: u.id,
          name: u.name,
          roleLabel: roleLabel(u.role),
        }))}
        myTasks={myTasks}
        byMeTasks={byMeTasks}
        teamTasks={teamTasks}
        onCreate={async (d) => {
          "use server";
          await createTask(d);
        }}
        onToggle={async (id, done) => {
          "use server";
          await setTaskStatus(id, done);
        }}
        onReassign={async (id, userId) => {
          "use server";
          await reassignTask(id, userId);
        }}
        onSetReason={async (id, reason) => {
          "use server";
          await setTaskStatusReason(id, reason);
        }}
        onDelete={async (id) => {
          "use server";
          await deleteTask(id);
        }}
      />
    </>
  );
}
