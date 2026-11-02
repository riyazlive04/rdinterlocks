# Feature 5 — Payment approval creates the order

## Purpose

Work reached the factory floor before anyone checked the money arrived.
Accepting a quotation called `convertQuotationToOrder` immediately; payments
were recorded afterwards against an order that already existed, with no
approval step and no handoff to the supervisor.

The owner's flow: telecaller records what the customer paid → a manager
verifies it against the bank or the cash box → **that approval is what creates
the Order**, which lands in the supervisor's production queue.

## Architecture

**New model `QuotationPayment`** — a claim, not money. Fields: `amount`,
`method`, `reference` (UTR / cheque no, so the manager can find it in the
statement), `paidAt`, `status` (`pending | approved | rejected`), recorder and
reviewer with timestamps, `reviewNote`.

Deliberately **not** `ClientPayment`: that model books against an existing
Order and feeds the cashbook, which is exactly what must not happen until a
human confirms the money landed. A cashbook reading `QuotationPayment` would
count unverified and rejected claims as cash in hand.

**`Order` gains** `approvedByUserId`, `approvedAt`, `fulfilmentStage`
(`queued | in_production | ready | dispatched`), `stageChangedAt`.
`fulfilmentStage` is separate from `Order.status` because that one is driven
by delivery progress and is not the supervisor's to move.

**Flow.** `recordQuotationPayment` (area `quotations`) → row is `pending` →
`approveQuotationPayment` (requires `isFullAccess`) in one transaction:

1. Re-read the payment on `tx`; refuse if no longer `pending`.
2. Claim it with a conditional write.
3. `convertQuotationToOrderTx(tx, id)` creates the Order.
4. Stamp `approvedBy`/`approvedAt`/`fulfilmentStage: "queued"`.
5. Copy the amount into one `ClientPayment` + `CashEntry`.

`convertQuotationToOrder` kept its public signature; its body moved into
`convertQuotationToOrderTx(tx, id)` so the approval can be atomic. Prisma has
no nested transactions, so this was the only way.

## Impact map

| Touches | What could break |
|---|---|
| `src/lib/quote.ts` | `convertQuotationToOrder` is called by `scripts/e2e/run-db.ts` (7 sites). Signature and return unchanged. Two guards changed meaning: `status === "accepted"` no longer means "already converted" (it is now the state the function is normally called in) — the test is `quotation.orderId`, backed by a `@unique`. The claim predicate moved to `orderId: null`; the old one would have silently stopped guarding. |
| `acceptQuotation` | No longer creates an order or redirects. Anything assuming an order exists after acceptance is wrong. |
| Cashbook / reports / client balance | Read `ClientPayment` + `CashEntry`. One approved payment must produce exactly one pair, or the cashbook double-counts. |
| `Quotation.status` | Gained `accepted` as a resting state before an order exists. |
| Supervisor fulfilment queue | Lists orders with `approvedAt` set. |
| Lead stage sync | Moved to acceptance, not approval — otherwise a customer who already agreed keeps getting nurture messages while a manager checks the bank. |

## Edge cases and failure modes

- **Two managers approve at once.** Under READ COMMITTED both can read
  `pending` before either writes, so the re-read alone is not enough. The
  guard is `updateMany({ where: { id, status: "pending" } })` — check and
  state change in one statement. The loser's whole transaction rolls back:
  order, `ClientPayment` and `CashEntry` with it.
- **Reject racing an approve** uses the same claim, so a reject cannot land
  after the order exists.
- **Part payment.** `paymentTotals()` returns approved / pending / balance, so
  a part payment is visible rather than looking like settlement.
- **Reject with no reason** is refused; the note is required.
- **Expiry.** Only bites on `sent`. A customer who accepted inside the window
  must not lose the sale because the date rolled over while a manager checked.
- **No undo.** An approval cannot be reversed in the app — the order and
  cashbook entry stand. Deliberate for now; a reversal path is a gap.

## Acceptance criteria

1. Recording a payment leaves the quotation with no order. ✅ `PAY-01`
2. Approval creates exactly one Order, stamped with approver and time. ✅
3. The order lands at `fulfilmentStage: "queued"`. ✅
4. Approval writes exactly one cashbook entry for the full amount. ✅
5. `paymentTotals` reports a zero balance once settled. ✅
6. A second approval is refused and creates no second order. ✅
7. Approval requires `isFullAccess`; no granted area substitutes. ✅ role probe

Tests: `scripts/e2e/run-rbac.ts` case `PAY-01`.
