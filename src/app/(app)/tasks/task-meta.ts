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

// ─── Category ─────────────────────────────────────────────────────────
//
// A FIXED list, not free text. A typed tag field becomes "Production",
// "production" and "Prodcution" within a week and then answers nothing, and
// the whole point of filing a task is to be able to ask "what is outstanding
// on deliveries". Null stays legal: a task raised in a hurry must not be
// blocked on choosing one.

export const TASK_CATEGORIES = [
  "production",
  "delivery",
  "maintenance",
  "customer",
  "money",
  "admin",
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<TaskCategory, string> = {
  production: "Production",
  delivery: "Delivery",
  maintenance: "Maintenance",
  customer: "Customer",
  money: "Money",
  admin: "Admin",
};

/** Null/unknown reads as "uncategorised" rather than being coerced. */
export function normalizeCategory(value: string | null | undefined): TaskCategory | null {
  return (TASK_CATEGORIES as readonly string[]).includes(value ?? "")
    ? (value as TaskCategory)
    : null;
}

export function categoryLabel(value: string | null | undefined): string {
  const key = normalizeCategory(value);
  return key ? CATEGORY_LABEL[key] : "Uncategorised";
}

// ─── Recurrence ───────────────────────────────────────────────────────
//
// The next occurrence is created WHEN THE CURRENT ONE IS COMPLETED, never by
// a clock. Two reasons, and the second is the important one:
//
//  1. This factory runs no scheduler. A calendar-driven recurrence would be
//     dead on arrival, like the sweep-driven settings already are.
//  2. A clock-driven routine that nobody completes STACKS UP. "Sweep the
//     yard" unchecked for six weeks becomes forty-two identical rows, and the
//     task list — the one screen meant to tell you what needs doing — becomes
//     the least usable thing in the app. One open occurrence at a time is the
//     correct behaviour, not a limitation.
//
// The cost, stated plainly: a missed week is not recorded as missed. The
// series simply waits. For "did the weekly service happen" you need the
// completion history, not the task list.

export const TASK_RECURRENCES = ["daily", "weekly", "fortnightly", "monthly"] as const;

export type TaskRecurrence = (typeof TASK_RECURRENCES)[number];

export const RECURRENCE_LABEL: Record<TaskRecurrence, string> = {
  daily: "Every day",
  weekly: "Every week",
  fortnightly: "Every two weeks",
  monthly: "Every month",
};

export function normalizeRecurrence(value: string | null | undefined): TaskRecurrence | null {
  return (TASK_RECURRENCES as readonly string[]).includes(value ?? "")
    ? (value as TaskRecurrence)
    : null;
}

/**
 * The next due date in a series.
 *
 * Advanced from the PREVIOUS DUE DATE, not from the completion date, so a
 * weekly task finished three days late is still due on its original weekday
 * rather than drifting three days every cycle. When there was no due date at
 * all, the interval runs from completion instead — there is nothing else to
 * anchor to.
 *
 * `monthly` clamps: the 31st of a 30-day month lands on the 30th, not the
 * 1st of the month after, which is what naive date arithmetic does.
 */
export function nextDueDate(
  recurrence: TaskRecurrence,
  previousDue: Date | null,
  completedAt: Date
): Date {
  const from = previousDue ?? completedAt;
  const next = new Date(from.getTime());

  switch (recurrence) {
    case "daily":
      next.setDate(next.getDate() + 1);
      break;
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "fortnightly":
      next.setDate(next.getDate() + 14);
      break;
    case "monthly": {
      const day = next.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
      // Last day of the target month, so the 31st never rolls into the next.
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, lastDay));
      break;
    }
  }

  // A series that fell badly behind must not generate an occurrence already
  // overdue on creation — walk it forward to the first date in the future.
  // Capped so a task untouched for years cannot spin here.
  let guard = 0;
  while (next.getTime() <= completedAt.getTime() && guard < 400) {
    switch (recurrence) {
      case "daily":
        next.setDate(next.getDate() + 1);
        break;
      case "weekly":
        next.setDate(next.getDate() + 7);
        break;
      case "fortnightly":
        next.setDate(next.getDate() + 14);
        break;
      case "monthly":
        next.setMonth(next.getMonth() + 1);
        break;
    }
    guard++;
  }

  return next;
}
