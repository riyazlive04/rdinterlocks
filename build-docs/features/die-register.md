# Die register (moulds)

Phase 10. Resolves the `Die` / `DieUsage` open question: **keep the tables,
and give the manager and supervisor a screen to fill them.**

## Purpose

`Die` and `DieUsage` existed in the live database but were never committed to
`schema.prisma`, so the next `db push` would have dropped them. They were
restored and retained pending a decision (MEMORY). Both are empty, and
nothing in the app could write to them.

The owner's decision: keep them, and surface them as something the manager or
supervisor maintains.

**The domain.** A die is the steel mould a machine presses bricks with. It
wears out. A die has two usable faces, so it goes in on side 1, is flipped to
side 2 when the first face is worn, and is retired when the second goes.
Recording that interval is what makes "how many bricks did this mould give
us" — and therefore cost per brick — answerable.

## Architecture

**Ported, not written.** `origin/feature/register-dies-avm-tipper-pl` already
carries a working `/die` screen (`page.tsx`, `die-view.tsx`, `actions.ts`) and
`lib/expense-category.ts`. The domain logic there is sound and is taken
essentially verbatim; what it is missing is security, which is the real work
of this feature.

**`Die.code` is derived, not typed** — `Die N` from the row count, so a busy
day cannot produce gaps or duplicates.

**Side lifecycle**, the whole model:
- Create → side 1 opened automatically at the purchase date.
- Flip → side 1 closed and side 2 opened on the same date. No new purchase.
- Retire → every open side closed.
- Reopen → the undo for a mis-tap on the last closed side.

`@@unique([dieId, side])` means a die can never have two rows for one face.

**Bricks per face** = all `ProductionEntry.brickCount` between the face's
`startedAt` and `endedAt` (or now). A die tied to a brick size counts only
that size.

**A die purchase books money.** Cost > 0 creates a `CashEntry` + `Expense`
under "Mould (Die)", so the die cost reaches the books without a second
manual entry.

### Authorization — what the ported code was missing

**The branch being ported from has NO authorization on any of its four
actions.** `createDie`, `flipDie`, `retireDie` and `deleteDie` call neither
`requireArea` nor `requireSession`. On this branch that is not acceptable: the
security review (`1c10fb0`) found exactly this class of hole in
`/api/export`, and a server action is a public HTTP endpoint whether or not a
link points at it. So:

| Action | Gate | Why |
|---|---|---|
| View `/die` | area `die` | New grantable area. Supervisor holds it by default; owner/manager via `isAdmin`. |
| `createDie`, cost = 0 | area `die` | Registering a mould is a shop-floor fact. |
| `createDie`, cost > 0 | area `die` **and** `expense` | It writes a `CashEntry` and an `Expense`. A supervisor who may not touch the cashbook must not book money through a side door; they can register the die and leave the cost for a manager. |
| `flipDie`, `retireDie`, `reopenDieSide` | area `die` | Shop-floor facts; no money moves. |
| `deleteDie` | `isFullAccess` | It deletes an `Expense` **and** its `CashEntry`. Removing money from the books is an owner/manager act, and the same reasoning as the payment-approval gate. |

`die` is added to `ACCESS_AREAS` and to `DEFAULT_AREAS_BY_ROLE.supervisor`.
Nav entry under **Make**.

## Impact map

| Touches | What could break |
|---|---|
| `src/lib/access.ts` | `ACCESS_AREAS` gains `die`; supervisor defaults gain it. Adding an area cannot widen anyone's existing access, but `run-rbac.ts` RBAC-02 asserts supervisor defaults exactly, so it must be updated in step or it fails. |
| `src/components/nav-config.ts` | One entry in Make. `run-nav.ts` NAV-01/NAV-04 assert the Make group's contents exactly — updated with it. |
| `src/app/(app)/die/*` (new) | New route. |
| `src/lib/expense-category.ts` (new) | `categoryIdByName` creates the category if an admin renamed or deleted it, rather than failing the operation the user asked for. Shared with nothing else yet. |
| `CashEntry` / `Expense` | **Written** on a costed purchase and **deleted** with the die. The only money path in this feature, and the reason for the two stricter gates above. |
| `ExpenseCategory` | A "Mould (Die)" row may be created on first use. |
| `ProductionEntry` | Read only, for the bricks-per-face count. |
| `prisma/schema.prisma` | **No change.** Both models already declared. `migrate diff` must stay a no-op. |
| Cashbook / expense reports | A die purchase now appears in both. Intended — that is the point of booking it. |

## Edge cases and failure modes

- **Flipping a die already on side 2** — refused; `@@unique([dieId, side])`
  would reject it anyway, so the check turns a constraint error into a
  sentence.
- **Retiring a die with no open side** — closes nothing, throws nothing.
- **Deleting a die with no expense** — no money to unwind; the usages cascade.
- **Deleting a costed die** — the `Expense` and its `CashEntry` go too, so a
  mistaken purchase leaves no orphan money. This is the mistake the e2e
  cleanup once made against production (MEMORY), handled deliberately here.
- **A face still open** — `endedAt` null counts bricks up to now, so the
  figure moves with production instead of reading zero.
- **Cost 0** — legitimate: a die registered before anyone knows the invoice.
  No expense is booked, nothing to unwind later.
- **A die with no brick size** — counts all production in the interval. Less
  precise, not wrong; stated on screen rather than silently assumed.
- **Future purchase date** — allowed (an invoice dated ahead); the face simply
  counts nothing yet.
- **Accessibility** — side state is text ("Side 1, in service"), never colour
  alone; the destructive action confirms before firing.

## Acceptance criteria

- **DIE-01** A new die is `Die N` by purchase order, with side 1 open from the
  purchase date.
- **DIE-02** Codes never collide or skip, including across deletes.
- **DIE-03** Flipping closes side 1 and opens side 2 on the same date; a
  second flip is refused.
- **DIE-04** Retiring closes every open side.
- **DIE-05** Reopening clears `endedAt` on that face.
- **DIE-06** A costed purchase creates exactly one `CashEntry` + `Expense`
  under "Mould (Die)"; a zero-cost one creates neither.
- **DIE-07** Deleting a costed die removes the die, its usages, the expense
  **and** the cash entry — no orphan money.
- **DIE-08** Bricks per face counts only production inside the interval, and
  only the die's brick size when one is set.
- **DIE-09** A supervisor holds `die` by default; a telecaller does not.
- **DIE-10** A supervisor without `expense` cannot create a **costed** die,
  and no cash entry is written by the attempt.
- **DIE-11** Only `isFullAccess` may delete a die.
- **DIE-12** `prisma migrate diff` stays empty — no schema change.
