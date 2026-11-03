# Task extensions: categories, steps, notes, files, recurrence

Phase 13. Five additions to one model, shipped together and documented
together — they share one impact map, one permission model and one test
suite, and splitting the doc would triple the duplication without adding a
fact.

## Purpose

Phase 12 gave a task urgency and progress. These five answer the rest of what
a shop-floor task list has to carry:

| Addition | The question it answers |
|---|---|
| Category | "What is outstanding on deliveries?" |
| Checklist | "How far through the service are we?" |
| Notes | "What did the supplier actually say?" |
| Files | "Show me the cracked mould." |
| Recurrence | "Did anyone do the daily meter reading?" |

## Permission model — shared by all five

Three rules, in `lib/roles.ts` as pure functions.

| Rule | Who | Used for |
|---|---|---|
| `canViewTask` | assignee, **creator**, or anyone outranking the assignee | reading steps, notes, files; the download route |
| `canContributeToTask` | same as viewing | ticking a step, posting a note, attaching a file |
| `canDeleteTaskNote` | the author, or anyone outranking the assignee | removing a note or a file |

**The creator carve-out is the one place viewing is broader than
`canUpdateTaskStatus`.** The person who handed out the work must be able to
read what came back on it even after a reorganisation leaves them no longer
outranking the assignee — otherwise whoever asked for the job cannot see the
photo of why it could not be done.

**Reading does not run sideways.** A telecaller cannot read another
telecaller's thread, and VIS-03 asserts this for every role. One consequence
worth stating: nobody outranks an owner, so an owner's task is readable only
by its assignee or creator — not by another owner. That is the phase 4
no-peers rule applied consistently to reading.

**Instruction vs doing.** Adding or removing a *step*, and setting
*recurrence*, are delegation acts gated on `canDeleteTask` (creator or
senior) — otherwise an assignee could delete the part of the job they did not
want to do, or commit a colleague to a daily task forever. Ticking a step is
the doing, and is open to any contributor.

## Category

A **fixed list** — production, delivery, maintenance, customer, money, admin —
not free text. A typed tag becomes "Production", "production" and
"Prodcution" within a week and then answers nothing, which defeats the only
reason to file a task. `null` stays legal: a task raised in a hurry must not
be blocked on choosing one. CAT-01 asserts a typo is *not* silently accepted.

## Checklist

Separate rows, not a text blob: progress is countable without parsing, and
ticking one line is a single small write rather than a read-modify-write of
the whole list that two people could clobber. `order` is derived from the
current **maximum**, not the row count, so deleting a middle step cannot make
the next insert collide. Ticking records who and when; unticking clears both
rather than leaving a stale name.

## Notes

Append-only in spirit. `statusReason` answers "why is this stuck right now"
and is overwritten; this is the running conversation and must overwrite
nothing. The author's name is **snapshotted** beside the id, because the
relation is `SetNull` — a note from someone who has since left would
otherwise read as "someone" on a record that may matter later. Rendered as a
text node, never `dangerouslySetInnerHTML`.

## Files

**Bytes in the row**, the same decision as `QuotationDocument` and for the
same reason: this app has no object storage and no persistent disk, so a file
on disk is the one thing a redeploy loses.

Security, which is most of this feature:

- **An allow-list, never a block-list.** The file is served back to a browser,
  so its type decides what the browser does with it. Anything that can execute
  in this origin — HTML, SVG (which carries `<script>`), XML — is refused
  outright. A block-list would have to anticipate every such type; an
  allow-list only has to name the ones the factory needs.
- **Only images and PDF are served inline.** `text/plain` and CSV render in
  the page, so they are forced as downloads — a file whose bytes contain
  markup cannot execute even if its declared type was wrong.
- **The filename is sanitised on the way in and again on the way out**,
  because it reaches a `Content-Disposition` header. Path separators (both
  kinds), control characters, CRLF, quotes and semicolons are stripped.
  Re-sanitised at serve time because a row written before the sanitiser
  existed would otherwise ride straight into the header.
- **The real bytes decide the size**, never the browser's claim: the buffer is
  measured after reading and re-checked.
- **The download route authorises.** A cuid is unguessable but it is not a
  permission — the security review on this branch found exactly that mistake
  twice (`/api/export` with no area check; the quotation PDF unscoped). The
  route runs `canViewTask` and returns **404, not 403**, for both "no such
  file" and "not yours", so responses cannot be used to discover which ids
  exist.
- Caps: 5 MB per file (a phone photo is 2-4 MB), 10 per task.

## Recurrence

**The next occurrence is created when the current one is completed, never by
a clock.** Two reasons, and the second is the one that matters:

1. This factory runs no scheduler, so a calendar-driven recurrence would be
   dead on arrival like the sweep-driven settings already are.
2. **A clock-driven routine nobody completes stacks up.** "Sweep the yard"
   unchecked for six weeks becomes forty-two identical rows, and the one
   screen meant to say what needs doing becomes the least usable thing in the
   app. One open occurrence at a time is correct behaviour, not a limitation.
   REC-06 asserts it.

**The cost, stated plainly:** a missed week is not recorded as missed — the
series simply waits. For "did the weekly service happen", read the completion
history, not the task list.

Details:

- The next due date advances from the **previous due date**, not from
  completion, so a weekly job finished three days late stays on its weekday
  instead of drifting later every cycle. With no due date, completion is the
  only available anchor.
- `monthly` **clamps**: the 31st of a 30-day month lands on the 30th, not the
  3rd of the month after, which is what naive `setMonth(+1)` produces.
  REC-02 covers leap years.
- Spawning runs **in the same transaction** as the completion, so there is no
  state where a daily safety check is done but its successor was never made.
- Idempotent via `recurrenceSpawnedAt`, claimed with a conditional write (the
  payment-gate pattern). Without it the reopen button is a task duplicator.
- The successor copies the **instruction** — title, details, assignee,
  priority, category, recurrence, and the checklist *unticked*. It copies
  nothing about the doing: no ticks, no notes, no files, no `startedAt`.
- `recurrenceParentId` is **SetNull**, so tidying up last month's completed
  routine does not delete next week's. REC-05 pins it.

## Impact map

| Touches | What could break |
|---|---|
| `prisma/schema.prisma` | 3 new tables, 4 new Task columns, 6 indexes, 6 FKs. All additive — `migrate diff` showed **0 DROP statements**. |
| `src/lib/roles.ts` | 3 pure predicates added; nothing existing modified. |
| `src/lib/task-attachments.ts` (new) | Pure. The allow-list is the security boundary. |
| `src/lib/task-recurrence.ts` (new) | Takes a transaction client, so it can be exercised directly. |
| `src/app/(app)/tasks/task-meta.ts` | Categories + recurrence maths appended. |
| `src/app/(app)/tasks/actions.ts` | 9 new actions. `setTaskStatus` now runs in a transaction and may spawn. |
| `src/app/(app)/tasks/task-detail.tsx` (new) | Collapsed by default. |
| `src/app/(app)/tasks/page.tsx` | Loads children with the task — **never `data`**, so rendering a filename cannot pull a 5 MB blob. |
| `src/app/api/tasks/attachments/[id]/route.ts` (new) | The only path that returns file bytes. |
| Phase 4 delegation / phase 12 priority | Not modified. `run-actions.ts` must stay green as the proof. |
| Cashbook, quotations, stock | Untouched. |

## Edge cases and failure modes

- **A deleted author** — note and file survive with `userId` null and the
  snapshotted name; nobody can claim them as "their own" to delete.
- **Deleting a task** — steps, notes and files cascade, so no orphan blobs.
- **Deleting a recurrence parent** — successor survives with a null link.
- **Reopen after complete on a repeating task** — no second successor.
- **Two people completing at once** — the conditional claim means one
  successor.
- **A series months behind** — the next date is walked forward past the
  completion date so a new occurrence is never born already overdue; capped
  at 400 iterations so a task untouched for years cannot spin.
- **Over-cap upload** — refused with the limit named; the per-task cap is
  checked before the bytes are read.
- **A file with a lying MIME type** — allowed only if the declared type is on
  the list, and served `nosniff` with a restrictive CSP; non-image/PDF types
  are never inline.
- **Empty note or step** — refused; whitespace is trimmed first.
- **Accessibility** — every checkbox has an `aria-label` naming the step, the
  panel toggle carries `aria-expanded`, errors are `role="alert"`, and
  category/recurrence pills are text.

## Acceptance criteria

- **CAT-01** The category list is fixed; a typo or wrong case is not accepted;
  null reads as "Uncategorised".
- **VIS-01** Assignee, creator and seniors may read; a peer may not.
- **VIS-02** Your own note always; someone else's only with rank.
- **VIS-03** Every role is covered by the read rule, including that no one
  outranks an owner.
- **ATT-01** Size cap, per-task cap and the type allow-list all hold; only
  images and PDF are inline-safe.
- **ATT-02** Filenames cannot escape the header (traversal, CRLF, quotes).
- **ATT-03** A file round-trips byte-for-byte; listings never select `data`;
  files cascade with the task.
- **CHK-01** Steps keep their order, record who ticked them, and `order` stays
  unique after a middle delete.
- **CMT-01** Notes keep order and survive their author's deletion.
- **REC-01** The next due date advances from the due date, not completion.
- **REC-02** Monthly clamps, including leap years.
- **REC-03** Completion makes exactly one successor, copying the instruction
  and not the ticks.
- **REC-04** Reopen-and-recomplete makes no second successor.
- **REC-05** Deleting a past occurrence spares its successor.
- **REC-06** An uncompleted routine does not stack up.
