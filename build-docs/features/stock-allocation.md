# Stock allocation against orders

Phase 8. **Built differently from the plan's proposal — read "Why not
reservations" first.**

## Purpose

The plan's problem statement: "an approved order does not hold the bricks it
needs, so two orders can both be promised the same pallet."

That turned out to be half true, and the half that is false changes the whole
design.

**What already exists.** `fulfilment/page.tsx:80–145` already allocates the
ready-stock pool down the queue oldest-first: each order is judged against what
is left after the orders ahead of it have taken theirs, so the supervisor's
screen does *not* tell three orders they are all dispatchable when there are
bricks for one. That allocation is correct, and it is already the thing the
plan asked for.

**What is actually missing — three real gaps.**

1. **The allocation is page-local.** 65 lines inside a React component. The
   supervisor dashboard (`supervisor-panel.tsx:57`) shows total ready stock
   with no allocation at all, so the same stock reads as free there and
   committed on `/fulfilment`. Two screens, two answers.
2. **Nothing guards dispatch.** `adjustReadyStock` (`clients/actions.ts:355`)
   draws batches down FIFO and deliberately drives the last batch negative so
   totals reconcile. So a delivery that takes bricks an earlier order was
   counting on succeeds silently, and the earlier order's shortfall only
   appears on the next page load — after the lorry has gone.
3. **Nothing names the loser.** When stock is short, the supervisor sees a
   shortfall number but not which order upstream consumed it.

## Why not reservations

The plan proposed holding stock per order, and flagged the risk itself:
*"reservation introduces a second source of truth for availability. Needs a
clear rule for release on cancellation and for a partial dispatch."*

That risk is not worth taking, because a stored reservation would have to be
kept in step with orders, cancellations, partial dispatches, stage reversals
and manual stock corrections — six writers to one derived number, and the
first bug in any of them makes availability lie in a way nobody can see. The
existing page already proves the alternative works: **allocation derived on
read, from orders and batches, holds nothing and therefore cannot drift.**

So phase 8 ships as an extraction and an enforcement, not a new table:

- No `StockReservation` model. No `reserved` column.
- **Release on cancellation** stops being a rule to implement: a cancelled
  order leaves the queue and its claim evaporates on the next read.
- **Partial dispatch** stops being a rule to implement: allocation already
  works from ordered-minus-delivered.
- Nothing is added to `approveQuotationPayment`, so the money path is
  untouched and an approval can never fail because the godown is short.

**The cost of this choice, stated plainly:** allocation is advisory, not a
lock. Two supervisors dispatching in the same second can both pass the check.
That is acceptable here — there is one supervisor and one godown, the bricks
are physically counted onto the lorry, and `remaining` is reconcilable after
the fact. A lock would be the wrong trade for this factory, and is the thing
to revisit if a second godown ever opens.

## Architecture

`src/lib/allocation.ts` — the extracted allocator, used by every surface.

```
allocateReadyStock(orders, readyBySize) -> Map<orderId, OrderAllocation>

OrderAllocation = {
  needs:      { brickSizeId, label, need, have, taken, short }[]
  pendingTotal, shortTotal
  blockedBy:  orderId[]     // orders ahead that took what this one needs
}
```

Pure function, no Prisma import, no `await` — the same reason
`lib/stock.ts:stageForAge` is pure: it makes the allocation testable without a
database, and the ordering rule (oldest `stageChangedAt` first) becomes an
argument instead of an incidental property of a page query.

`blockedBy` is the third gap: while drawing the pool down, the allocator
records which earlier order emptied it.

**Enforcement at dispatch.** `recordDelivery` gains a check before
`adjustReadyStock`: if the delivery would take bricks allocated to an order
ahead of this one, it is **refused with the blocking order named** — not
warned, refused, because a warning in a server action is a message nobody
reads. `isFullAccess` (owner/manager) may override with an explicit flag, for
the real case where the customer is standing in the yard and the office
decides who waits. Consistent with `setOrderFulfilmentStage`, where the
supervisor walks one stage at a time and a manager may correct freely.

**Settings flag.** `stockAllocationEnforced`, default **off**, per the
convention in MEMORY that new behaviour never changes the desk's workflow on
deploy. Off = today's behaviour plus the named shortfall; on = dispatch is
refused. The allocator and the warnings run either way.

## Impact map

| Touches | What could break |
|---|---|
| `src/lib/allocation.ts` (new) | Pure; no callers until wired. |
| `src/app/(app)/fulfilment/page.tsx` | **Highest risk in this feature.** 65 lines of working logic replaced by a call. The extraction must preserve the dispatched-order special case (a dispatched order reports its need as met, never a shortfall) or the queue starts showing phantom shortfalls on finished work. ALLOC-05 pins it. |
| `src/app/(app)/dashboard/supervisor-panel.tsx` | Ready-stock tile becomes "ready, of which committed". Figure drops — by design; it was overstating what was free. |
| `src/app/(app)/clients/actions.ts` `recordDelivery` | A delivery can now be **refused**, which it never could before. If the check is wrong, dispatch stops — the worst failure in this feature. Gated behind a default-off flag for exactly that reason, and the override exists so nobody is ever stuck. |
| `adjustReadyStock` | Not modified. Its negative-remaining behaviour is deliberate (totals reconcile) and is the audit trail for an override. |
| `prisma/schema.prisma` `Settings` | One `Boolean @default(false)`. Additive — `migrate diff` must show no `DROP`. |
| Phase 7 | None. Different tables, no shared code. |
| Deliveries / production / tipper stock writes | Read the same batches; unchanged. |

## Edge cases and failure modes

- **Dispatched order** — reports need as met, never a shortfall. Its bricks
  have left; competing for the pool would be wrong. (ALLOC-05.)
- **Part-delivered order** — allocates against ordered-minus-delivered only.
- **Over-delivered order** — pending goes negative; clamped to 0, not fed back
  into the pool as if the surplus returned to the godown.
- **No batch of that size exists at all** — `have = 0`, `short = need`. The
  order is listed as blocked, not skipped; a size with no stock is the clearest
  shortfall there is.
- **Negative `remaining`** from a past override — treated as 0 in the pool, so
  one old overdraw cannot grant phantom availability to the next order.
- **Order with no items** — contributes nothing, takes nothing.
- **Two orders with identical `stageChangedAt`** — tie broken by `id` so the
  allocation is deterministic across page loads. Without it the same two orders
  can swap blame between refreshes.
- **Flag off** — dispatch never refused; shortfall still named.
- **Override** — recorded in the delivery notes, so an overdrawn godown has a
  reason attached rather than looking like a counting error.
- **Empty queue** — allocator returns an empty map.
- **Accessibility** — shortfalls carry text ("3,000 short, held by ORD-14"),
  never colour alone.

## Acceptance criteria

- **ALLOC-01** Two orders needing the same stock: the first is met, the second
  reports the shortfall and names the first in `blockedBy`.
- **ALLOC-02** Enough stock for both: neither is short, `blockedBy` empty.
- **ALLOC-03** A part-delivered order allocates only the undelivered
  remainder.
- **ALLOC-04** Allocation is oldest-first and deterministic on a
  `stageChangedAt` tie.
- **ALLOC-05** A dispatched order reports no shortfall and takes nothing from
  the pool. *(Regression pin for the extraction.)*
- **ALLOC-06** Negative `remaining` contributes 0, never negative availability.
- **ALLOC-07** With the flag on, a delivery taking another order's allocated
  stock is refused and the refusal names the blocking order.
- **ALLOC-08** With the flag off, the same delivery succeeds.
- **ALLOC-09** Owner/manager may override with the flag on; the override is
  recorded.
- **ALLOC-10** The extracted allocator produces, for the current queue, the
  same `needs`/`shortTotal` the page produced before extraction.
