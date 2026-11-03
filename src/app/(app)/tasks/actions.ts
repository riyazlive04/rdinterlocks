"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import {
  canContributeToTask,
  canCreateTaskFor,
  canDeleteTask,
  canDeleteTaskNote,
  canReassignTask,
  canUpdateTaskStatus,
  decideTaskStatusChange,
} from "@/lib/roles";
import {
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  normalizePriority,
} from "./task-meta";
import { spawnNextOccurrence } from "@/lib/task-recurrence";
import {
  attachmentProblem,
  safeFileName,
} from "@/lib/task-attachments";

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
  // Defaulted rather than required: the form offers it, but a task raised in
  // a hurry should not be blocked on choosing one.
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  category: z.enum(TASK_CATEGORIES).optional(),
  recurrence: z.enum(TASK_RECURRENCES).optional(),
  /** Steps, in order. Blank lines are dropped rather than stored empty. */
  checklist: z.array(z.string().max(300)).default([]),
});

/**
 * Hand a task to someone below you.
 *
 * Two gates, in order: canDelegate() asks whether this role hands out work
 * at all (a telecaller never does), then canAssignTo() asks whether it may
 * hand it to THIS person — checked against the role loaded from the DB a few
 * lines down, which is the security boundary for the whole feature.
 */
export async function createTask(input: z.input<typeof createSchema>) {
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

  const steps = p.checklist.map((t) => t.trim()).filter(Boolean);

  await prisma.task.create({
    data: {
      title: p.title.trim(),
      details: p.details?.trim() || null,
      assignedToId: assignee.id,
      createdById: session.userId,
      dueDate: p.dueDate ? new Date(p.dueDate) : null,
      priority: p.priority,
      category: p.category ?? null,
      recurrence: p.recurrence ?? null,
      ...(steps.length
        ? { checklist: { create: steps.map((text, order) => ({ text, order })) } }
        : {}),
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
export async function setTaskStatus(id: string, status: string) {
  const session = await requireSession();
  const task = await loadTaskWithAssignee(id);

  // The rule — who may move it, and what that does to startedAt /
  // completedAt / statusReason — lives in lib/roles.ts so it can be tested
  // without a request context. This function authenticates and writes.
  const decision = decideTaskStatusChange(
    session,
    {
      assignedToId: task.assignedToId,
      createdById: task.createdById,
      assigneeRole: task.assignedTo.role,
      status: task.status,
      startedAt: task.startedAt,
    },
    status
  );
  if (!decision.allowed) throw new Error(decision.reason);
  // A double-tap. Skipping the write keeps startedAt and completedAt honest.
  if (decision.noop) return;

  // Completion and the successor it creates happen in ONE transaction. A
  // daily safety check marked done whose next occurrence was never created is
  // the failure that matters here, so there must be no state in between.
  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id },
      data: {
        status,
        ...(decision.startedAt !== undefined ? { startedAt: decision.startedAt } : {}),
        ...(decision.completedAt !== undefined ? { completedAt: decision.completedAt } : {}),
        ...(decision.clearStatusReason ? { statusReason: null } : {}),
      },
    });

    if (status === "done" && task.recurrence) {
      await spawnNextOccurrence(
        tx,
        {
          id: task.id,
          title: task.title,
          details: task.details,
          assignedToId: task.assignedToId,
          createdById: task.createdById,
          dueDate: task.dueDate,
          priority: task.priority,
          category: task.category,
          recurrence: task.recurrence,
          recurrenceSpawnedAt: task.recurrenceSpawnedAt,
        },
        decision.completedAt ?? new Date()
      );
    }
  });

  revalidatePath("/tasks");
  revalidatePath("/");
}

/**
 * Change how urgent a task is.
 *
 * Same permission as the status: the assignee or someone above them. The
 * assignee is usually the person who finds out that something is urgent, and
 * a senior can always correct it — so locking this to whoever delegated the
 * task would cost more than it protects.
 */
export async function setTaskPriority(id: string, priority: string) {
  const session = await requireSession();
  const task = await loadTaskWithAssignee(id);

  const decision = canUpdateTaskStatus(session, {
    assignedToId: task.assignedToId,
    createdById: task.createdById,
    assigneeRole: task.assignedTo.role,
  });
  if (!decision.allowed) throw new Error(decision.reason);

  // Parsed, not trusted: an unrecognised value would sort as `normal`
  // everywhere but still read as a real setting on the row.
  const next = z.enum(TASK_PRIORITIES).parse(priority);
  if (normalizePriority(task.priority) === next) return;

  await prisma.task.update({ where: { id }, data: { priority: next } });
  revalidatePath("/tasks");
  revalidatePath("/");
}

/** Change what kind of work a task is, or clear it. */
export async function setTaskCategory(id: string, category: string | null) {
  const session = await requireSession();
  const task = await loadTaskWithAssignee(id);

  const decision = canUpdateTaskStatus(session, {
    assignedToId: task.assignedToId,
    createdById: task.createdById,
    assigneeRole: task.assignedTo.role,
  });
  if (!decision.allowed) throw new Error(decision.reason);

  const next = category ? z.enum(TASK_CATEGORIES).parse(category) : null;
  await prisma.task.update({ where: { id }, data: { category: next } });
  revalidatePath("/tasks");
}

/**
 * Make a task repeat, or stop it repeating.
 *
 * Turning it off does NOT touch occurrences already created — those are real
 * tasks somebody may be part-way through. It only stops the series going
 * further.
 */
export async function setTaskRecurrence(id: string, recurrence: string | null) {
  const session = await requireSession();
  const task = await loadTaskWithAssignee(id);

  // Setting up a standing instruction is a delegation act, so it needs the
  // same standing as handing the task out — not merely the right to tick it
  // off. An assignee could otherwise commit themselves, or a colleague, to a
  // daily job forever.
  const decision = canDeleteTask(session, {
    assignedToId: task.assignedToId,
    createdById: task.createdById,
    assigneeRole: task.assignedTo.role,
  });
  if (!decision.allowed) {
    throw new Error("Only whoever assigned this task — or their senior — can make it repeat.");
  }

  const next = recurrence ? z.enum(TASK_RECURRENCES).parse(recurrence) : null;
  await prisma.task.update({ where: { id }, data: { recurrence: next } });
  revalidatePath("/tasks");
}

// ─── Checklist ────────────────────────────────────────────────────────

/**
 * Add a step.
 *
 * `order` is derived from the current maximum rather than the row count, so
 * deleting a middle step does not make the next one collide with an existing
 * position.
 */
export async function addChecklistItem(taskId: string, text: string) {
  const session = await requireSession();
  const task = await loadTaskWithAssignee(taskId);
  const subject = {
    assignedToId: task.assignedToId,
    createdById: task.createdById,
    assigneeRole: task.assignedTo.role,
  };
  const decision = canContributeToTask(session, subject);
  if (!decision.allowed) throw new Error(decision.reason);

  const body = z.string().min(1).max(300).parse(text.trim());
  const last = await prisma.taskChecklistItem.findFirst({
    where: { taskId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  await prisma.taskChecklistItem.create({
    data: { taskId, text: body, order: (last?.order ?? -1) + 1 },
  });
  revalidatePath("/tasks");
}

/** Tick or untick a step, recording who did it. */
export async function setChecklistItemDone(itemId: string, done: boolean) {
  const session = await requireSession();
  const item = await prisma.taskChecklistItem.findUnique({
    where: { id: itemId },
    include: { task: { include: { assignedTo: { select: { role: true } } } } },
  });
  if (!item) throw new Error("That step no longer exists.");

  const decision = canContributeToTask(session, {
    assignedToId: item.task.assignedToId,
    createdById: item.task.createdById,
    assigneeRole: item.task.assignedTo.role,
  });
  if (!decision.allowed) throw new Error(decision.reason);

  await prisma.taskChecklistItem.update({
    where: { id: itemId },
    data: {
      done,
      doneAt: done ? new Date() : null,
      doneById: done ? session.userId : null,
    },
  });
  revalidatePath("/tasks");
}

export async function deleteChecklistItem(itemId: string) {
  const session = await requireSession();
  const item = await prisma.taskChecklistItem.findUnique({
    where: { id: itemId },
    include: { task: { include: { assignedTo: { select: { role: true } } } } },
  });
  if (!item) return;

  // A step is part of the instruction, so removing one is the delegator's
  // call or a senior's — not the assignee's, who would otherwise be able to
  // delete the part of the job they do not want to do.
  const decision = canDeleteTask(session, {
    assignedToId: item.task.assignedToId,
    createdById: item.task.createdById,
    assigneeRole: item.task.assignedTo.role,
  });
  if (!decision.allowed) {
    throw new Error("Only whoever assigned this task — or their senior — can remove a step.");
  }

  await prisma.taskChecklistItem.delete({ where: { id: itemId } });
  revalidatePath("/tasks");
}

// ─── Comments ─────────────────────────────────────────────────────────

/**
 * Add a note to the thread.
 *
 * The author's name is SNAPSHOTTED alongside the id: the relation is
 * `SetNull`, so a comment written by someone who has since left would
 * otherwise read as "someone" on a record that may matter later.
 */
export async function addTaskComment(taskId: string, body: string) {
  const session = await requireSession();
  const task = await loadTaskWithAssignee(taskId);

  const decision = canContributeToTask(session, {
    assignedToId: task.assignedToId,
    createdById: task.createdById,
    assigneeRole: task.assignedTo.role,
  });
  if (!decision.allowed) throw new Error(decision.reason);

  const text = z.string().min(1).max(2000).parse(body.trim());
  await prisma.taskComment.create({
    data: { taskId, userId: session.userId, authorName: session.name, body: text },
  });
  revalidatePath("/tasks");
}

export async function deleteTaskComment(commentId: string) {
  const session = await requireSession();
  const comment = await prisma.taskComment.findUnique({
    where: { id: commentId },
    include: { task: { include: { assignedTo: { select: { role: true } } } } },
  });
  if (!comment) return;

  const decision = canDeleteTaskNote(
    session,
    {
      assignedToId: comment.task.assignedToId,
      createdById: comment.task.createdById,
      assigneeRole: comment.task.assignedTo.role,
    },
    comment.userId
  );
  if (!decision.allowed) throw new Error(decision.reason);

  await prisma.taskComment.delete({ where: { id: commentId } });
  revalidatePath("/tasks");
}

// ─── Attachments ──────────────────────────────────────────────────────

/**
 * Attach a file.
 *
 * Takes FormData rather than a serialised payload, because a 5 MB photo
 * base64'd into a server-action argument is a third bigger and has to be held
 * in memory as a string on both sides.
 *
 * Every check runs on the SERVER against the real bytes: the declared size is
 * not trusted (the actual buffer length decides), the type is checked against
 * an allow-list, and the name is sanitised because it reaches a
 * Content-Disposition header.
 */
export async function addTaskAttachment(formData: FormData) {
  const session = await requireSession();
  const taskId = z.string().min(1).parse(formData.get("taskId"));
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Pick a file to attach.");

  const task = await loadTaskWithAssignee(taskId);
  const decision = canContributeToTask(session, {
    assignedToId: task.assignedToId,
    createdById: task.createdById,
    assigneeRole: task.assignedTo.role,
  });
  if (!decision.allowed) throw new Error(decision.reason);

  const existing = await prisma.taskAttachment.count({ where: { taskId } });
  const problem = attachmentProblem(
    { name: file.name, type: file.type, size: file.size },
    existing
  );
  if (problem) throw new Error(problem);

  // The real bytes, not the browser's claim about them.
  const bytes = Buffer.from(await file.arrayBuffer());
  const recheck = attachmentProblem(
    { name: file.name, type: file.type, size: bytes.byteLength },
    existing
  );
  if (recheck) throw new Error(recheck);

  const name = safeFileName(file.name);
  await prisma.taskAttachment.create({
    data: {
      taskId,
      name,
      mimeType: file.type,
      byteSize: bytes.byteLength,
      data: bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      uploadedById: session.userId,
      uploaderName: session.name,
    },
  });
  revalidatePath("/tasks");
}

export async function deleteTaskAttachment(attachmentId: string) {
  const session = await requireSession();
  const file = await prisma.taskAttachment.findUnique({
    where: { id: attachmentId },
    // Never select `data` — this only needs to decide and delete.
    select: {
      id: true,
      uploadedById: true,
      task: {
        select: {
          assignedToId: true,
          createdById: true,
          assignedTo: { select: { role: true } },
        },
      },
    },
  });
  if (!file) return;

  const decision = canDeleteTaskNote(
    session,
    {
      assignedToId: file.task.assignedToId,
      createdById: file.task.createdById,
      assigneeRole: file.task.assignedTo.role,
    },
    file.uploadedById
  );
  if (!decision.allowed) throw new Error(decision.reason);

  await prisma.taskAttachment.delete({ where: { id: attachmentId } });
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
