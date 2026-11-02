# Master plan — RD Interlock Factory OS

**Status: retrospective.** The build workflow requiring this document arrived
after the features below were built and committed. This records what was built
and why, and is the forward plan from here. Phases 6+ are not started and are
the part that needs approval before code.

## Goal and scope

Factory management for RD Interlock Bricks (Salem, Tamil Nadu): an enquiry
travels from first contact to money in the cashbook, and each person sees only
their stretch of it.

**In scope:** lead capture and routing, telecaller duty presence, quotation
pricing from the owner's district rate chart, quotation review and dispatch,
payment approval, production and godown fulfilment, four-role RBAC.

**Out of scope:** accounting beyond the existing cashbook, a dialer or
telephony integration, call-recording storage, customer self-service, GST
filing, multi-factory.

## Project memory

See [MEMORY.md](MEMORY.md). The constraints that shaped every decision below:
the database is live and takes writes during development; `db push` is the
only migration path; the deployment target is local → VPS, not Vercel.

## Build order and state

Sequenced by dependency: nothing can be reviewed before it can be quoted,
nothing quoted before it is priced, nothing priced before leads arrive.

| # | Feature | Doc | State |
|---|---|---|---|
| 1 | Lead intake webhook | [features/lead-intake-webhook.md](features/lead-intake-webhook.md) | Built |
| 2 | Zone pricing | [features/zone-pricing.md](features/zone-pricing.md) | Built |
| 3 | Quotation review gate | [features/quotation-review-gate.md](features/quotation-review-gate.md) | Built |
| 4 | Role hierarchy + duty presence | [features/role-hierarchy.md](features/role-hierarchy.md) | Built |
| 5 | Payment approval → order | [features/payment-approval.md](features/payment-approval.md) | Built |
| 6 | Navigation regrouped by role | — | **Not started** |
| 7 | Outstanding balance + collections | — | **Not started** |
| 8 | Stock reservation against an order | — | **Not started** |
| 9 | Call recordings | — | Blocked on the provider |

## Phase 6 — navigation regrouped by role

**Problem.** 33 flat navigation entries, 79 routes, 21 settings pages. A new
telecaller meets all of it with no indication which three items are theirs.

**Proposal.** Five groups — Sell / Make / Move / Money / Admin — each
collapsing entirely for a role with no business in it. A telecaller sees seven
entries instead of thirty-three. Settings divides the same way: what we sell /
who works here / how the place runs.

**Acceptance:** a telecaller's menu shows only Sell; a supervisor's only Make
and Move; owner and manager see all five; no route becomes unreachable.

## Phase 7 — outstanding balance and collections

**Problem.** Step 10 of the order-to-cash spine does not exist. A part payment
is recorded and approved, but nothing tracks or chases the remainder.
`paymentTotals()` already computes a balance per quotation; nothing aggregates
it per client or ages it.

**Proposal.** Outstanding per client, an ageing view (0–30 / 30–60 / 60+), and
a collections queue for the manager. Reuses `ClientPayment` and the existing
cashbook; no new money path.

**Acceptance:** a client with a part payment appears with the correct balance;
the total reconciles against the cashbook; a fully paid order leaves the queue.

## Phase 8 — stock reservation

**Problem.** An approved order does not hold the bricks it needs, so two
orders can both be promised the same pallet. `StockBatch` has `remaining` and
a `ready` stage; nothing decrements against an order until dispatch.

**Risk to weigh before building:** reservation introduces a second source of
truth for availability. Needs a clear rule for release on cancellation and for
a partial dispatch.

## Known risks

- **Nobody is using it yet.** Two accounts exist. Every role screen is real
  and empty; the first week of real use will reshape more than further
  planning will.
- **Automation defaults to off** (auto-quote, auto-assign, expiry sweep). Turn
  on one at a time, after the manual path is trusted.
- **Managers can edit users.** They cannot grant owner rank or edit an owner,
  but they can change a supervisor's role. Follows from managers and owners
  sharing access; revisit once there is a real team.
