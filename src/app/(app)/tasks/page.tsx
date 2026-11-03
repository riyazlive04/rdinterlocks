import { prisma } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { requireSession } from "@/lib/auth";
import {
  assignableRoles,
  canDelegate,
  canManageTaskOf,
  canDeleteTaskNote,
  roleLabel,
} from "@/lib/roles";
import { formatISODate, formatNumber } from "@/lib/format";
import { TasksView, type TaskDTO } from "./tasks-view";
import {
  addChecklistItem,
  addTaskAttachment,
  addTaskComment,
  createTask,
  deleteChecklistItem,
  deleteTask,
  deleteTaskAttachment,
  deleteTaskComment,
  reassignTask,
  setChecklistItemDone,
  setTaskCategory,
  setTaskPriority,
  setTaskRecurrence,
  setTaskStatus,
  setTaskStatusReason,
} from "./actions";
import { compareTasks, isTaskActive, isOverdue, normalizePriority } from "./task-meta";

export default async function TasksPage() {
  const session = await requireSession();

  // Who this user may hand work to, by role. Driven entirely by
  // lib/roles.ts, so an owner sees managers in the list while a manager does
  // not — and a telecaller gets an empty list, no create form, and still a
  // useful screen made of their own tasks.
  const delegates = canDelegate(session.role);
  const teamRoles = assignableRoles(session.role);

  // A stable base order from the database; compareTasks() below decides the
  // order actually rendered (overdue, then priority, then due date), because
  // priority rank is not alphabetical and cannot be expressed in SQL here.
  const order = [{ dueDate: "asc" as const }, { createdAt: "desc" as const }];
  // The children come with the task rather than on demand: these lists are a
  // handful of rows each, and a round trip per task just to show a count
  // would be slower than fetching them.
  const include = {
    assignedTo: true,
    createdBy: true,
    checklist: {
      orderBy: [{ order: "asc" as const }, { createdAt: "asc" as const }],
      include: { doneBy: { select: { name: true } } },
    },
    comments: { orderBy: { createdAt: "asc" as const } },
    // Never `data` — the bytes must not be loaded to render a filename.
    attachments: {
      orderBy: { createdAt: "asc" as const },
      select: {
        id: true,
        name: true,
        mimeType: true,
        byteSize: true,
        uploaderName: true,
        uploadedById: true,
      },
    },
  };

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
    priority: string;
    startedAt: Date | null;
    category: string | null;
    recurrence: string | null;
    assignedToId: string;
    createdById: string | null;
    assignedTo?: { name: string; role: string } | null;
    createdBy?: { name: string } | null;
    checklist?: Array<{
      id: string;
      text: string;
      done: boolean;
      doneBy?: { name: string } | null;
    }>;
    comments?: Array<{
      id: string;
      body: string;
      authorName: string;
      userId: string | null;
      createdAt: Date;
    }>;
    attachments?: Array<{
      id: string;
      name: string;
      mimeType: string;
      byteSize: number;
      uploaderName: string;
      uploadedById: string | null;
    }>;
  }): TaskDTO => {
    const assigneeRole = t.assignedTo?.role ?? "staff";
    const isMine = t.assignedToId === session.userId;
    const outranks = canManageTaskOf(session.role, assigneeRole);
    const isCreator = t.createdById === session.userId;

    // The same subject the actions build, so these booleans and the server's
    // refusals cannot disagree.
    const subject = {
      assignedToId: t.assignedToId,
      createdById: t.createdById,
      assigneeRole,
    };
    // Contributing (ticking a step, commenting, attaching) is open to anyone
    // who may see the task: assignee, creator, or a senior.
    const canContribute = isMine || isCreator || outranks;
    // Changing the INSTRUCTION — adding/removing steps, setting recurrence —
    // is the delegator's or a senior's, never the assignee's on their own.
    const canInstruct = isCreator || outranks;
    const mayRemoveNote = (authorId: string | null) =>
      canDeleteTaskNote({ userId: session.userId, role: session.role }, subject, authorId).allowed;
    return {
      id: t.id,
      title: t.title,
      details: t.details,
      status: t.status,
      statusReason: t.statusReason,
      dueDate: t.dueDate ? formatISODate(t.dueDate) : null,
      priority: normalizePriority(t.priority),
      startedAt: t.startedAt ? formatISODate(t.startedAt) : null,
      detail: {
        category: t.category,
        recurrence: t.recurrence,
        canContribute,
        canInstruct,
        checklist: (t.checklist ?? []).map((c) => ({
          id: c.id,
          text: c.text,
          done: c.done,
          doneByName: c.doneBy?.name ?? null,
        })),
        comments: (t.comments ?? []).map((c) => ({
          id: c.id,
          body: c.body,
          // Falls back to the live relation only if the snapshot is empty,
          // which is how rows written before authorName existed still read.
          authorName: c.authorName || "Unknown",
          createdAt: c.createdAt.toISOString(),
          canRemove: mayRemoveNote(c.userId),
        })),
        attachments: (t.attachments ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          mimeType: a.mimeType,
          byteSize: a.byteSize,
          uploaderName: a.uploaderName || "Unknown",
          canRemove: mayRemoveNote(a.uploadedById),
        })),
      },
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

  // Overdue, then priority, then due date — see task-meta.ts for why overdue
  // outranks urgent.
  const sorted = (rows: TaskDTO[]) => [...rows].sort((a, b) => compareTasks(a, b, today));
  const overdue = (t: TaskDTO) => isOverdue(t, today);

  const myTasks = sorted(mineRaw.map(toDTO));
  const byMeTasks = sorted(byMeRaw.map(toDTO));
  const teamTasks = sorted(teamRaw.map(toDTO));

  // "Not done", never "is open" — the live database defaults this column to
  // `wip`, so counting only "open" is what hid those rows from every
  // dashboard.
  const openCount = (rows: TaskDTO[]) => rows.filter((t) => isTaskActive(t.status)).length;
  const overdueCount = (rows: TaskDTO[]) => rows.filter(overdue).length;
  const urgentCount = (rows: TaskDTO[]) =>
    rows.filter((t) => isTaskActive(t.status) && t.priority === "urgent").length;

  const myOpen = openCount(myTasks);
  const myOverdue = overdueCount(myTasks);
  const myUrgent = urgentCount(myTasks);
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
          sub={
            myUrgent > 0
              ? `${formatNumber(myUrgent)} urgent waiting`
              : myOverdue > 0
                ? "Past the due date"
                : "Nothing late"
          }
          tone={myOverdue > 0 || myUrgent > 0 ? "red" : "default"}
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
        onSetStatus={async (id, status) => {
          "use server";
          await setTaskStatus(id, status);
        }}
        onSetPriority={async (id, priority) => {
          "use server";
          await setTaskPriority(id, priority);
        }}
        onSetCategory={async (id, category) => {
          "use server";
          await setTaskCategory(id, category);
        }}
        onSetRecurrence={async (id, recurrence) => {
          "use server";
          await setTaskRecurrence(id, recurrence);
        }}
        onAddStep={async (id, text) => {
          "use server";
          await addChecklistItem(id, text);
        }}
        onToggleStep={async (itemId, done) => {
          "use server";
          await setChecklistItemDone(itemId, done);
        }}
        onDeleteStep={async (itemId) => {
          "use server";
          await deleteChecklistItem(itemId);
        }}
        onAddComment={async (id, body) => {
          "use server";
          await addTaskComment(id, body);
        }}
        onDeleteComment={async (commentId) => {
          "use server";
          await deleteTaskComment(commentId);
        }}
        onUpload={async (formData) => {
          "use server";
          await addTaskAttachment(formData);
        }}
        onDeleteAttachment={async (attachmentId) => {
          "use server";
          await deleteTaskAttachment(attachmentId);
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
