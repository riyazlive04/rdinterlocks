// Making the next occurrence of a repeating task.
//
// Driven by COMPLETION, not by a clock — see the long note in
// app/(app)/tasks/task-meta.ts for why. The short version: this factory runs
// no scheduler, and a clock-driven routine nobody completes stacks up forty
// copies of itself and ruins the one screen meant to say what needs doing.

import type { Prisma } from "@prisma/client";
import { nextDueDate, normalizeRecurrence } from "@/app/(app)/tasks/task-meta";

/** What a completed task needs to carry for its successor to be built. */
export type RecurringTask = {
  id: string;
  title: string;
  details: string | null;
  assignedToId: string;
  createdById: string | null;
  dueDate: Date | null;
  priority: string;
  category: string | null;
  recurrence: string | null;
  recurrenceSpawnedAt: Date | null;
};

export type SpawnResult =
  | { spawned: false; reason: string }
  | { spawned: true; taskId: string; dueDate: Date };

/**
 * Create the next occurrence of a repeating task, inside the caller's
 * transaction.
 *
 * Runs in the SAME transaction as the completion that triggered it, so there
 * is no state in which a task is marked done but its successor was never
 * created — which for a daily safety check is the failure that matters.
 *
 * Idempotent through `recurrenceSpawnedAt`: completing, reopening and
 * completing again does not produce a second successor. That is the whole
 * reason the column exists, because without it the reopen button quietly
 * becomes a task duplicator.
 *
 * The successor copies the INSTRUCTION (title, details, assignee, priority,
 * category, recurrence) and nothing about the doing of it — no checklist
 * ticks, no comments, no files, no startedAt. A checklist IS copied, unticked,
 * because the steps are part of the instruction; its ticks are not.
 */
export async function spawnNextOccurrence(
  tx: Prisma.TransactionClient,
  task: RecurringTask,
  completedAt: Date
): Promise<SpawnResult> {
  const recurrence = normalizeRecurrence(task.recurrence);
  if (!recurrence) return { spawned: false, reason: "not a repeating task" };
  if (task.recurrenceSpawnedAt) {
    return { spawned: false, reason: "this occurrence already produced its successor" };
  }

  // Claim it first, conditionally. Two people completing the same task in the
  // same second would otherwise both pass the check above and create two
  // successors — the same claim pattern as the payment approval gate, and
  // needed for the same reason: READ COMMITTED lets both reads see null.
  const claimed = await tx.task.updateMany({
    where: { id: task.id, recurrenceSpawnedAt: null },
    data: { recurrenceSpawnedAt: completedAt },
  });
  if (claimed.count === 0) {
    return { spawned: false, reason: "another completion produced the successor a moment ago" };
  }

  const due = nextDueDate(recurrence, task.dueDate, completedAt);

  // The checklist travels, unticked: the steps are the instruction, the ticks
  // are the record of one occurrence doing them.
  const steps = await tx.taskChecklistItem.findMany({
    where: { taskId: task.id },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { text: true, order: true },
  });

  const next = await tx.task.create({
    data: {
      title: task.title,
      details: task.details,
      assignedToId: task.assignedToId,
      // Attributed to whoever set the series up, not to whoever happened to
      // complete this one — it is still their standing instruction.
      createdById: task.createdById,
      dueDate: due,
      priority: task.priority,
      category: task.category,
      recurrence: task.recurrence,
      recurrenceParentId: task.id,
      status: "open",
      ...(steps.length
        ? { checklist: { create: steps.map((s) => ({ text: s.text, order: s.order })) } }
        : {}),
    },
    select: { id: true },
  });

  return { spawned: true, taskId: next.id, dueDate: due };
}
