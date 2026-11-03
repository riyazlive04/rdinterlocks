"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import {
  canCreateTaskFor,
  canDeleteTask,
  canReassignTask,
  canUpdateTaskStatus,
} from "@/lib/roles";

// ─── The one rule every action below shares ────────────────────────────
//
// Each action re-reads the ASSIGNEE'S ROLE FROM THE DATABASE and decides on
// that. Never on a role the request carried, and never on the actor's
// session alone.
//
// The reason is the shape of the form: the client picks a user id out of a
// <Select>, and an id is the only thing it can be trusted to send. The
// dropdown is already filtered to assignableRoles(), but that filter is
// cosmetic — a supervisor who hand-crafts the POST with a manager's id would
// sail straight through it. So the role the hierarchy is applied to is the
// one stored against that id server-side, read fresh on every call. A user
// whose role was raised a minute ago is judged by the new role, never by a
// stale copy in a session cookie.
//
// isAdmin() is deliberately NOT used for delegation any more: it now returns
// true for manager as well as owner/admin, which is the right answer for
// "may this user open this screen" and the wrong answer for "may this user
// hand work to a manager".

// Loads a task plus the assignee's current role — the pair every permission
// decision here needs. Throws rather than returning null, so the callers
// below read as a plain list of checks.
async function loadTaskWithAssignee(id: string) {
  const task = await prisma.task.findUnique({
    where: { id },
    include: { assignedTo: { select: { id: true, name: true, role: true } } },
  });
  if (!task) throw new Error("Task not found");
  return task;
}

// The refusal an actor sees when they reach sideways or upward. Names both
// roles, because a bare "not allowed" reads like a bug to the user.
const createSchema = z.object({
  title: z.string().min(1),
  details: z.string().optional(),
  assignedToId: z.string().min(1),
  dueDate: z.string().optional(),
});

/**
 * Hand a task to someone below you.
 *
 * Two gates, in order: canDelegate() asks whether this role hands out work
 * at all (a telecaller never does), then canAssignTo() asks whether it may
 * hand it to THIS person — checked against the role loaded from the DB a few
 * lines down, which is the security boundary for the whole feature.
 */
export async function createTask(input: z.infer<typeof createSchema>) {
  const session = await requireSession();
  const p = createSchema.parse(input);

  // The loaded role decides — not where p.assignedToId came from.
  const assignee = await prisma.user.findUnique({
    where: { id: p.assignedToId },
    select: { id: true, role: true, active: true },
  });
  if (!assignee) throw new Error("Pick who to assign the task to");
  const decision = canCreateTaskFor(session.role, assignee);
  if (!decision.allowed) throw new Error(decision.reason);

  await prisma.task.create({
    data: {
      title: p.title.trim(),
      details: p.details?.trim() || null,
      assignedToId: assignee.id,
      createdById: session.userId,
      dueDate: p.dueDate ? new Date(p.dueDate) : null,
    },
  });
  revalidatePath("/tasks");
}

/**
 * Flip a task done / open.
 *
 * Completing your own work is yours by right, so the assignee passes on id.
 * Anyone else has to outrank them: canManageTaskOf() against the assignee's
 * stored role. A telecaller therefore completes their own task and nothing
 * else — not even another telecaller's, since the chain never runs sideways.
 */
export async function setTaskStatus(id: string, done: boolean) {
  const session = await requireSession();
  const task = await loadTaskWithAssignee(id);

  const decision = canUpdateTaskStatus(session, {
    assignedToId: task.assignedToId,
    createdById: task.createdById,
    assigneeRole: task.assignedTo.role,
  });
  if (!decision.allowed) throw new Error(decision.reason);

  await prisma.task.update({
    where: { id },
    data: {
      status: done ? "done" : "open",
      completedAt: done ? new Date() : null,
      // Reopening drops the old explanation. A stale "waiting for cement" on
      // a task that is moving again is worse than no note at all.
      statusReason: done ? task.statusReason : null,
    },
  });
  revalidatePath("/tasks");
}

const reasonSchema = z.string().max(300);

/**
 * Note WHY a task sits where it does — parked on a material shortage, held
 * for a customer callback, whatever is actually blocking it. This writes the
 * `statusReason` column, which has existed in the production database since
 * before it was declared in the schema and has never been used until now.
 *
 * The assignee is the person who knows the reason, so they may set it; a
 * senior may too, for the days they are chasing the task themselves. An
 * empty string clears the note rather than storing "".
 */
export async function setTaskStatusReason(taskId: string, reason: string) {
  const session = await requireSession();
  const task = await loadTaskWithAssignee(taskId);

  const reasonDecision = canUpdateTaskStatus(session, {
    assignedToId: task.assignedToId,
    createdById: task.createdById,
    assigneeRole: task.assignedTo.role,
  });
  if (!reasonDecision.allowed) {
    throw new Error("You can only park your own tasks, or your team's.");
  }

  const text = reasonSchema.parse(reason).trim();
  await prisma.task.update({
    where: { id: taskId },
    data: { statusReason: text || null },
  });
  revalidatePath("/tasks");
}

/**
 * Move a task to a different pair of hands.
 *
 * Needs both halves of the hierarchy, because a reassignment touches two
 * people: the actor must already be entitled to act on the task (they
 * created it, or they outrank the current assignee), and must be entitled to
 * assign to the new one. Both roles come out of the DB — being handed the
 * new assignee's id is no evidence of their rank.
 */
export async function reassignTask(taskId: string, newAssigneeId: string) {
  const session = await requireSession();
  const task = await loadTaskWithAssignee(taskId);

  const next = await prisma.user.findUnique({
    where: { id: newAssigneeId },
    select: { id: true, role: true, active: true },
  });
  if (!next) throw new Error("Pick who to reassign the task to");
  if (next.id === task.assignedToId) return; // nothing to do

  const decision = canReassignTask(
    session,
    {
      assignedToId: task.assignedToId,
      createdById: task.createdById,
      assigneeRole: task.assignedTo.role,
    },
    next
  );
  if (!decision.allowed) throw new Error(decision.reason);

  await prisma.task.update({
    where: { id: taskId },
    data: { assignedToId: next.id },
  });
  revalidatePath("/tasks");
}

/**
 * Remove a task altogether.
 *
 * The creator (it was their instruction to withdraw) or someone who
 * outranks the assignee. Pointedly NOT the assignee on their own strength:
 * finishing the work is theirs, deciding it never needed doing is not.
 */
export async function deleteTask(id: string) {
  const session = await requireSession();
  const task = await loadTaskWithAssignee(id);

  const decision = canDeleteTask(session, {
    assignedToId: task.assignedToId,
    createdById: task.createdById,
    assigneeRole: task.assignedTo.role,
  });
  if (!decision.allowed) throw new Error(decision.reason);

  await prisma.task.delete({ where: { id } });
  revalidatePath("/tasks");
}
