# Task priority and progress

Phase 12. Extends the task delegation built in phase 4.

## Purpose

**Tasks are already assignable, and that was verified before anything was
changed.** Work travels strictly down the chain — owner → manager →
supervisor → telecaller/staff — with reassignment, completion, a reason for
why a task is parked, deletion, and three views (mine / assigned by me /
my team). Confirmed live over HTTP as each role: an owner is offered managers,
a manager is not offered an owner, a telecaller is offered nobody and gets no
create form.

What a task cannot say is **how urgent it is** or **whether anyone has
started**. A list of twenty open tasks sorted by due date treats "the mixer is
broken" and "reorder stationery" identically, and a delegator cannot tell the
difference between work that has not been picked up and work in progress.

## Architecture

`src/app/(app)/tasks/task-meta.ts` — the shared vocabulary, beside the feature
rather than in `src/lib`, the same way `fulfilment/stage.ts` sits beside its
queue. The dashboards import it across, as they already do for stages.

### Priority

`urgent | high | normal | low`, default `normal`, stored as a String to match
every other enum-ish column in this schema.

- `normalizePriority()` maps an unknown value to `normal`, so a row written by
  anything else still renders. Same reasoning as `normalizeStage`: a task
  nobody can see is a task nobody does.
- `priorityRank()` gives the sort order. Ordering is **overdue first, then
  priority, then due date** — overdue outranks urgent because a missed
  deadline is already a failure, whereas an urgent task due next week is not.

**Who may change it:** anyone who may already update the task's status — the
assignee or someone above them (`canUpdateTaskStatus`). The assignee is
usually the person who *discovers* that something is urgent, and a senior can
always correct it. Deliberately not restricted to the delegator.

### Progress

`status` becomes `open | wip | done` where it was `open | done`.

**`wip` is not invented — it is reconciliation.** The live database still
defaults this column to `"wip"`, a value predating the schema (already noted
in `schema.prisma`). So rows carrying it exist, and the app treated them as
"not done" on the tasks page while **every dashboard filtered `status:
"open"` exactly** — meaning a `wip` task was invisible on all three dashboards
while showing on the tasks page. That is a live bug this feature fixes, not a
risk it introduces.

`startedAt` records when work began, so "sitting untouched for 3 days" is
answerable.

Transitions, enforced in `decideTaskStatusChange`:

| From | To | Who |
|---|---|---|
| open | wip | assignee or senior |
| wip | done | assignee or senior |
| open | done | assignee or senior (skipping `wip` is fine — short jobs) |
| done | open | assignee or senior (reopen; clears `statusReason`) |
| any | same | no-op, not an error |

Unlike the fulfilment stages there is **no one-step-at-a-time rule**: the
failure that rule prevents (an order marked dispatched that was never made)
has no analogue here. A task marked done that was not done is visible to the
person who assigned it.

`completedAt` is set on `done` and cleared on reopen. `startedAt` is set on
first `wip` and **preserved** on reopen, so the original start is not lost.

## Impact map

| Touches | What could break |
|---|---|
| `prisma/schema.prisma` | Two additive columns (`priority`, `startedAt`) and one index. `migrate diff` must show no `DROP`. |
| `src/app/(app)/tasks/task-meta.ts` (new) | Pure; no callers until wired. |
| `src/lib/roles.ts` | Adds `decideTaskStatusChange`. The existing `canUpdateTaskStatus` is unchanged and still the authority on *who*. |
| `src/app/(app)/tasks/actions.ts` | `setTaskStatus(id, done: boolean)` becomes `setTaskStatus(id, status: string)` — a **signature change**. Only `tasks/page.tsx` calls it, so the blast radius is one file, but a missed caller would silently stop completing tasks. |
| `src/app/(app)/tasks/page.tsx` | Passes priority through, computes the new sort. |
| `src/app/(app)/tasks/tasks-view.tsx` | Priority control, progress control, filter. |
| **`dashboard/owner-panel.tsx`, `supervisor-panel.tsx`, `telecaller-panel.tsx`** | All four `status: "open"` filters become `status: { not: "done" }`. **This changes the numbers on three dashboards** — upward, because `wip` tasks were being hidden. Intended; it was a bug. |
| `settings/actions.ts:928` | Counts tasks per user for the delete guard. Status-agnostic, so unaffected. |
| Phase 4 delegation rules | Not modified. Priority and progress say nothing about who may assign to whom. |
| `run-actions.ts` | Asserts the task rules exactly; extended, and must stay green as the regression check that delegation is untouched. |

## Edge cases and failure modes

- **An unknown priority** → `normal`, rendered, not dropped.
- **An unknown status** that is not `done` → treated as active, so a legacy
  `wip` row (or anything else) still appears and can still be completed.
- **Reopening a completed task** → `completedAt` cleared, `statusReason`
  cleared (a stale "waiting for cement" on moving work is worse than none),
  `startedAt` kept.
- **Marking done from `open`** → allowed; `completedAt` set, `startedAt` left
  null. A five-minute job never "starts".
- **Setting the status it already has** → no-op, so the timestamps are not
  churned by a double-tap.
- **An overdue low-priority task vs an urgent one due next month** → overdue
  sorts first. Stated because it is a judgement, not an obvious default.
- **A task with no due date** → never overdue; sorts after dated ones within
  its priority.
- **Priority on a done task** → settable but not shown in the sort; closed
  rows are listed separately.
- **Accessibility** — priority is a text pill ("Urgent"), never colour alone;
  the progress control is a labelled button, not an icon.

## Acceptance criteria

- **TASK-08** Tasks remain assignable strictly downward, and the phase 4 rules
  are unchanged. *(Regression pin.)*
- **TASK-09** An unknown priority normalizes to `normal`; all four known
  values round-trip.
- **TASK-10** Sort order is overdue → priority → due date.
- **TASK-11** An unknown, non-`done` status counts as active, so a legacy
  `wip` row is visible and completable.
- **TASK-12** `open → wip` sets `startedAt`; `→ done` sets `completedAt`;
  reopening clears `completedAt` and `statusReason` but keeps `startedAt`.
- **TASK-13** Setting the current status is a no-op that does not churn
  timestamps.
- **TASK-14** Only the assignee or a senior may change status or priority; a
  peer may not.
- **TASK-15** The dashboards count `wip` tasks as open — the bug this fixes.
