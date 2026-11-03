# One vocabulary for what an order's status means

Not a planned feature. This is the repair the `main` merge forced, written up
because the bug it fixed was invisible to a green test run and would have
reached the owner's first screen.

## Purpose

`Order.status` had **two vocabularies at the same time**:

| Side | Values | Column default |
|---|---|---|
| `feat/lead-intake-quote-review` | `open` · `partial` · `complete` · `cancelled` | `open` |
| `main` (from `5306e06`, "3-state statuses") | `upcoming` · `active` · `completed` · `cancelled` | `active` |

Merging put both sets of string literals in one codebase. Git merged the
column default cleanly to `active` — correctly, because all of `main`'s code
queries `["upcoming", "active"]` — and that is exactly what made this branch's
eleven screens wrong.

**Every suite still passed.** Each one seeds its own orders with its own
vocabulary, so neither ever met the other's rows. That is the lesson worth
keeping: 1,219 green assertions did not notice that the owner's first screen
had stopped working.

## The failures it caused

| Site | Query | What the user saw |
|---|---|---|
| `dashboard/owner-panel.tsx` | `status: { in: ["open", "partial"] }` | **"Pending orders" empty.** A new order defaults to `active`, which that list never matches. No error anywhere. |
| `lib/outstanding.ts` | `status !== "complete"` | A finished order counted as open, inflating the open-order count beside "Due from clients" — `recomputeOrderStatus` writes `completed`. |
| `fulfilment/page.tsx` | `o.status === "partial"` | The "Part delivered" pill never appeared; nothing writes `partial` any more. |
| `fulfilment/stage.ts` | `=== "complete"` | A completed order's stage was no longer fixed, so it could be dragged back through the queue. |

The `notIn: ["complete", "cancelled"]` queries kept *working* by accident —
`active` is not in that list — which is why only some screens broke. That
inconsistency is the reason this is one shared definition now rather than
eleven corrected literals.

## Architecture

`src/lib/order-status.ts` is the single source. It already held `ORDER_STATUSES`
(the three chips the UI offers) and `deriveOrderStatus()`; it now also holds:

```ts
export const OPEN_ORDER_STATUSES   = ["upcoming", "active", "open", "partial"] as const;
export const CLOSED_ORDER_STATUSES = ["completed", "cancelled", "complete"] as const;
export function isOrderOpen(status: string): boolean;
```

Two decisions inside that:

**Both lists carry the legacy spellings.** The merge changes code, not rows.
Orders written before it are still in the database with `open`, `partial` or
`complete`, and nothing migrates them. A read-side list that knew only the
canonical values would hide exactly the historical orders the office is most
likely to be chasing.

**Writes stay canonical.** `deriveOrderStatus()` emits only
`upcoming | active | completed | cancelled`, and `ORDER_STATUSES` offers only
the three chips, so the legacy spellings can never grow. `OS-05` asserts this
— without it, "be tolerant on read" quietly becomes "write either".

**Legacy `complete` is CLOSED, not open.** The guess has a direction, and the
two errors are not equally bad: a finished order read as open comes *back*
into the fulfilment queue and the pending panel, where it looks like work
somebody still owes. A genuinely open order read as closed merely goes quiet.
The loud, misleading failure is the one to avoid.

`fulfilment/page.tsx` stopped asking about status at all for its pill — the
query already excludes completed orders, so any order on that page with a
delivery against it *is* part-delivered. Deriving it from `o.deliveries`
is both correct and immune to the next vocabulary change.

## Impact map

| Touches | What could break |
|---|---|
| `src/lib/order-status.ts` | The definition. A wrong entry here is wrong everywhere at once — which is the point. |
| `dashboard/owner-panel.tsx` (×3) | `Lead.status` is **also** `"open"` in this file and means something unrelated; each replacement was anchored exactly, never globally. |
| `dashboard/supervisor-panel.tsx` (×2), `clients/actions.ts`, `fulfilment/page.tsx` (×2), `fulfilment/stage.ts`, `lib/outstanding.ts` | All now read the shared lists. |
| `prisma/schema.prisma` | Default is `active` (from `main`). Not changed back — the merged code depends on it. |
| Existing rows | **Not migrated.** Read compatibility is the whole mechanism. |
| `vehicles/page.tsx` | Has its own `"partial"` for EMI payments. Unrelated, deliberately untouched. |

## Edge cases and failure modes

- **A row holding the column default** — open. `OS-01`, the original bug.
- **A row holding a legacy spelling** — understood both ways. `OS-02`.
- **A legacy `complete`** — stays finished. `OS-03`.
- **A status in both lists** — impossible; `OS-04` asserts they are disjoint.
- **New code writing a legacy value** — `OS-05` fails if `deriveOrderStatus`
  or the UI chips ever emit one.
- **An unrecognised value** — `orderStatusLabel` falls back rather than
  throwing, so one bad row cannot blank a page. `OS-07`.

## Acceptance criteria

- **OS-01** An order holding the schema default reads as open and is matched
  by the query list.
- **OS-02** Every canonical and legacy spelling classifies the same way
  through both the lists and `isOrderOpen`.
- **OS-03** Legacy `complete` and canonical `completed` are both closed.
- **OS-04** The open and closed lists share no value.
- **OS-05** Neither `deriveOrderStatus` nor `ORDER_STATUSES` emits a legacy
  spelling.
- **OS-06** `deriveOrderStatus` follows its documented contract, including
  that `cancelled` is never re-derived.
- **OS-07** An unknown status renders instead of crashing.

Suite: `scripts/e2e/run-order-status.ts` — 35 assertions, no database, wired
into `npm run test:unit`.
