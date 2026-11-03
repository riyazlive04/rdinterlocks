# Outstanding balance and collections

Phase 7. Step 10 of the order-to-cash spine.

## Purpose

A part payment is recorded and approved, and then nothing tracks or chases the
remainder. There is no screen that answers "who owes us money, and how long
have they owed it".

**The defect found while designing this.** Two different balance formulas are
already live, and they disagree about the same client:

| Where | Formula | `paid` counts |
|---|---|---|
| `clients/page.tsx:92` | `ordered − paid` | order-linked payments only |
| `clients/[id]/page.tsx:64` | `ordered + addOns − refunded − paid` | every client payment |

So the list and the detail page show different dues for one client: the list
omits delivery add-ons and returns, and ignores advances paid with no order
attached. Neither is labelled as an approximation. Phase 7 therefore starts by
replacing both with one function, and the ageing view is built on that.

## Architecture

`src/lib/outstanding.ts` — the single definition of what a client owes.

```
billed  = Σ order items + Σ slab items + Σ delivery add-ons − Σ returns
paid    = Σ ClientPayment.amount for the client   (orders + advances)
balance = billed − paid
```

**`paid` is client-level on purpose.** An advance with no `orderId` is money
received; a formula that only counts order-linked payments reports a client as
owing money they have already handed over. This is what the list page got
wrong.

**Only approved money counts.** `ClientPayment` rows exist only where a
manager approved the claim (`approveQuotationPayment`) or the office recorded a
direct payment. `QuotationPayment` — the unverified claim — is never read here,
for the reason already recorded in MEMORY: a pending claim counted as cash
makes an unpaid client look settled.

**Ageing is FIFO over orders, not over payments.** There are no invoices, so an
order is the billable unit. Orders oldest-first; the client's payment pool is
drawn down against the oldest first; whatever remains unpaid on each order is
bucketed by that order's own age:

```
d0_30    order date within 30 days
d31_60   31–60 days
d60plus  over 60 days
```

The buckets always sum to `balance`, which is what makes the view checkable.

FIFO is the right allocation because it is what the office already does
informally — money that comes in settles the oldest bill — and because the
alternative (allocating to the order named on the payment) leaves advances
unallocatable and double-counts a client who overpaid one order and underpaid
another.

**Reads, one query set, no new tables.** `ClientPayment`, `Order`,
`OrderItem`, `OrderSlabItem`, `Delivery*` as they stand. No schema change —
so no `db push`, and none of the production-schema risk in MEMORY.

**Surfaces**
- `/collections` — the queue. Clients with `balance > 0`, oldest debt first,
  three ageing columns, a totals row. Gated `requireArea("revenue")`: owner and
  manager hold it via `isAdmin`, and the owner can grant it to anyone who
  should chase money. No new access area — `revenue` is already "may see money
  totals", which is exactly what this is.
- `clients/page.tsx` and `clients/[id]/page.tsx` — both switch to the shared
  function, which is the bug fix.
- Dashboard owner panel — one outstanding tile linking to the queue.

## Impact map

| Touches | What could break |
|---|---|
| `src/lib/outstanding.ts` (new) | Nothing yet depends on it. |
| `src/app/(app)/clients/page.tsx` | The per-client due pill changes value — by design, it was wrong. Add-ons and advances now count. |
| `src/app/(app)/clients/[id]/page.tsx` | Balance card now shares the list's formula. Figure should not move, since this page already had the fuller formula. |
| `src/app/(app)/collections/` (new) | New route — needs the Money nav entry from phase 6, hence the build order. |
| `src/app/(app)/dashboard/owner-panel.tsx` | One tile added. Already `revenue`-gated. |
| `ClientPayment` / `CashEntry` | **Read only.** No new money path, no writes. A reporting feature that wrote to the cashbook would be the thing to fear here; this one cannot. |
| `src/lib/reports.ts` | Not touched. Its revenue figures are period-based and answer a different question; making it share this would change report numbers. Deliberately left alone. |
| `quote-payment.ts` `paymentTotals()` | Not touched — per-quotation, not per-client. Both remain, with different jobs. |
| `/api/export` | Not extended. Its area check is the one the security review fixed; leaving it alone keeps that fix the only thing guarding it. |

## Edge cases and failure modes

- **Overpaid client** — `balance` negative. Excluded from the queue (it is not
  a debt), shown as a credit on the client page rather than clamped to zero.
  The existing detail page clamps with `Math.max(0, balance)`, which hides a
  genuine overpayment; the shared function returns the signed figure and lets
  the caller decide.
- **Cancelled order** — excluded from `billed`. A cancelled order is not a
  bill, and including it would invent debt.
- **Client with no orders but an advance paid** — negative balance, credit, not
  in the queue. No divide-by-zero or empty-array arithmetic.
- **Payment pool exceeding one order but not the next** — FIFO leaves a
  partial remainder on the second order; that remainder is bucketed by the
  second order's date, not the first's.
- **Order dated in the future** (mis-keyed date) — lands in `d0_30`; negative
  age is clamped to 0 rather than falling through every bucket and vanishing
  from the totals.
- **Concurrency** — read-only, so a payment landing mid-render shifts a figure
  but corrupts nothing. All queries for one client run in a single
  `Promise.all` so the page cannot mix pre- and post-payment reads of the same
  client.
- **Scale** — the queue aggregates in the database and paginates at 100. It
  does not load every order of every client into memory the way
  `clients/page.tsx` currently does for 50 clients.
- **Empty state** — "Nothing outstanding" is a real result, not an error.
- **Accessibility** — a real `<table>` with `<th scope>`, since this is
  tabular money; red is paired with text, never the only signal.

## Acceptance criteria

- **COLL-01** A client who part-paid an order appears with
  `balance = billed − paid`, exactly.
- **COLL-02** The three ageing buckets sum to `balance`, for every client.
- **COLL-03** Σ `paid` over all clients equals Σ `ClientPayment.amount`, which
  equals the cashbook's client-payment entries — the reconciliation the plan
  asked for.
- **COLL-04** A fully paid order leaves the queue (`balance = 0` → absent).
- **COLL-05** A cancelled order is not billed.
- **COLL-06** An advance with no `orderId` reduces the balance — the bug the
  clients list had.
- **COLL-07** An overpaid client is absent from the queue and reads as a
  credit.
- **COLL-08** Delivery add-ons raise the balance and returns lower it.
