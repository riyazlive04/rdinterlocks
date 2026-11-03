// The task vocabulary — how urgent, and how far along.
//
// Lives beside the task screens rather than in src/lib for the same reason
// fulfilment/stage.ts does: the tasks page and the three dashboard panels are
// its only readers, and the dashboards already import across to that file.

export const TASK_PRIORITIES = ["urgent", "high", "normal", "low"] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

/** What each level is actually for, so the dropdown is not four bare words. */
export const PRIORITY_HINT: Record<TaskPriority, string> = {
  urgent: "Drop everything — production is stopped or a customer is waiting",
  high: "Today, before the routine work",
  normal: "The ordinary queue",
  low: "When there is a gap",
};

export const PRIORITY_TONE: Record<TaskPriority, "red" | "warning" | "slate" | "blue"> = {
  urgent: "red",
  high: "warning",
  normal: "slate",
  low: "blue",
};

/**
 * Unknown values read as `normal` rather than vanishing.
 *
 * Same reasoning as normalizeStage: a task nobody can see is a task nobody
 * does. The column is a String (like every other enum-ish column in this
 * schema), so anything can end up in it.
 */
export function normalizePriority(value: string | null | undefined): TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value ?? "")
    ? (value as TaskPriority)
    : "normal";
}

/** Sort key — 0 is most urgent. */
export function priorityRank(value: string | null | undefined): number {
  return TASK_PRIORITIES.indexOf(normalizePriority(value));
}

// ─── Progress ─────────────────────────────────────────────────────────
//
// `wip` is NOT a new invention. The live database still defaults
// Task.status to "wip" — a value predating this schema (see the note on the
// model) — so rows carrying it already exist. The tasks page treated them as
// "not done" and showed them, while every dashboard filtered `status: "open"`
// exactly and hid them. Making it a first-class value is reconciliation, and
// it fixes that split.

export const TASK_STATUSES = ["open", "wip", "done"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Not started",
  wip: "In progress",
  done: "Done",
};

export const STATUS_TONE: Record<TaskStatus, "slate" | "warning" | "success"> = {
  open: "slate",
  wip: "warning",
  done: "success",
};

/**
 * Anything that is not `done` is active.
 *
 * Written as "not done" rather than "is open" on purpose: that is the single
 * assumption every count in the app can safely make about this column, and
 * writing it the other way round is what hid `wip` rows from the dashboards.
 */
export function isTaskDone(status: string | null | undefined): boolean {
  return status === "done";
}

export function isTaskActive(status: string | null | undefined): boolean {
  return !isTaskDone(status);
}

/** Unknown, not-done values read as `open` for display purposes. */
export function normalizeTaskStatus(value: string | null | undefined): TaskStatus {
  if (value === "done" || value === "wip" || value === "open") return value;
  return "open";
}

/** The one-tap control offered on a row: what the next sensible state is. */
export function nextTaskStatus(status: string): TaskStatus {
  switch (normalizeTaskStatus(status)) {
    case "open":
      return "wip";
    case "wip":
      return "done";
    default:
      return "open"; // reopen
  }
}

/**
 * Overdue first, then priority, then due date.
 *
 * Overdue outranks urgent deliberately: a missed deadline is already a
 * failure, while an urgent task due next week is not yet one. `today` is an
 * argument so the ordering is testable without a clock.
 */
export type SortableTask = {
  status: string;
  priority: string;
  /** ISO date (yyyy-mm-dd) or null. */
  dueDate: string | null;
};

export function isOverdue(task: SortableTask, today: string): boolean {
  return isTaskActive(task.status) && !!task.dueDate && task.dueDate < today;
}

export function compareTasks(a: SortableTask, b: SortableTask, today: string): number {
  const overdue = Number(isOverdue(b, today)) - Number(isOverdue(a, today));
  if (overdue !== 0) return overdue;

  const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
  if (byPriority !== 0) return byPriority;

  // An undated task is not more urgent than a dated one, so nulls trail.
  if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return 0;
}
