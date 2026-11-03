# Changelog

Branch `feat/lead-intake-quote-review`, 2026-11-02.

Commits predate the `feat(<name>):` convention, which applies from here on.
They are grouped by feature rather than renamed — rewriting verified history
to fix commit titles is not worth the risk.

## Built

### Lead intake webhook — `554eb21`
Provider-agnostic HMAC-signed endpoint at `/api/v1/leads/webhook/[channel]`,
configured entirely through `LEAD_WEBHOOK_CHANNELS`. `LeadWebhookDelivery`
stores every delivery before interpretation, which makes replay possible —
previously a lead lost to a transient Graph error was lost for good.
Leads → Intake shows the log, channel config and per-row replay. Provider
contract written to `docs/lead-webhook-contract.md`.

### Zone pricing — `554eb21`
8 zones, 32 zone prices, 16 minimum-order rules and a base matrix seeded from
the owner's district rate chart. The seeder had never run because it looked up
BrickSize `6"` while the database stores `6`. Added `Lead.zoneId` and a picker.

### Quotation review gate — `554eb21`
`draft → in_review → changes_requested → approved → sent`, off by default.
The PDF is frozen into `QuotationDocument` at submission, so the approved
document is provably the sent one. New `quoteReview` / `quoteSend` areas.

### Role hierarchy, duty presence, payment gate — `e0873ab`
Four roles with strictly downward task delegation. Duty presence replaced the
"rotate every 15 calls" idea after the owner clarified the requirement.
Manager approval of a payment now creates the Order. Per-role dashboards and
the supervisor fulfilment queue.

### Migration and verification — `de3954c`
Schema pushed; spine verified end to end (24/24) and every route exercised as
every role. Telecallers were being redirected from the review queue they were
built to staff — `quoteReview` added to their defaults.

## Fixed

### Found while building
- `resolveQuotationItems` ignored `ZoneBrickRule.minBricks` entirely, so a
  500-brick order to a 60–90 km site quoted at the full delivered rate.
- `convertQuotationToOrder` could accept an expired quotation at stale
  prices: `isQuotationExpired` returns false once the status is no longer
  `sent`, so the guard stopped firing exactly when the row was marked stale.
- The expiry sweep and the printed `validUntil` disagreed; `validUntil` now
  wins, so the system never contradicts the customer's own document.
- A UPI id without an `@handle` rendered an unscannable QR on every
  quotation. Validated on input, refused at render.
- Vercel Cron issues GET; the WhatsApp tick exported only POST.
- `.gitignore` covered `.env` but not `.env.*`, so a backup would have been
  committed with the database password.
- `prisma/seed.ts` wipes 34 tables and the README listed it as a setup step;
  it now refuses to run against a database holding data.
- The role enum in settings named four roles while the form offered six, so
  saving a supervisor threw — the whole new role was unusable.
- The last-owner guard compared against the literal `"admin"` while the count
  covered admin and owner.

### Login names must be unique — `fc775fd`
The name IS the login. Nothing stopped two accounts called "Raj", and
resolution came down to table order — at worst one user lands in the other's
account with nothing on screen to show it.

### Security review — `1c10fb0`
A review of the branch found six issues; all fixed and verified 9/9.
- **Login worked without a username.** An empty name made it a password-only
  match against every active user, owner included.
- **`/api/export` had no area check** — a telecaller could download the whole
  cashbook or the payroll from the URL.
- **Signature-rejected deliveries could be replayed**, laundering a forged
  lead into the system as a genuine provider submission.
- **Sessions could not be revoked** — role and permissions lived in a 30-day
  JWT, so demoting or deactivating someone did nothing to an open tab.
- **A telecaller could take any colleague's lead**, which also defeated
  review routing.
- **The quotation PDF** opened any quotation to any `quoteReview`/`quoteSend`
  holder, unscoped.

Clean on the review: HMAC verification, JWT handling, XSS (every DB-derived
string escaped in the PDF template), SQL/command/path injection, manager →
owner escalation, secret logging, and the task hierarchy.

## Tooling

- ESLint installed for the first time with a flat config — `npx eslint` had
  been fetching a throwaway copy, which is why it never worked.
- npm scripts: `cron:tick`, `cron:sweep`, `webhook:test`, `db:zones`,
  `db:prices`, `db:quote-settings`.
- `scripts/post-lead-webhook.mjs` (reference signer), `run-tick.mjs`,
  `run-sweep.mjs` (scheduler-agnostic invokers for VPS/Task Scheduler).

### Navigation grouped by role — phase 6
33 flat entries over 79 routes, with nothing to tell a new telecaller which
three were theirs. The sidebar and the mobile "More" sheet now group into
Sell / Make / Move / Money / Admin, and a group a role has no business in is
absent entirely — heading and all.

- `groupedNav` is a VIEW over `visibleNav`, never a second filter, so grouping
  cannot grant or withhold a route. `run-nav.ts` NAV-01 asserts set equality
  between flat and grouped output for all six roles, which is what makes the
  change safe.
- A telecaller's sidebar: 6 entries under one heading, down from 29.
- The plan's acceptance said a supervisor sees "only Make and Move". That was
  wrong — `sales` is in their default areas, so hiding it would have been an
  access change and left a page they can open with no link to it. Recorded in
  the feature doc and pinned by NAV-04.
- An item filed under no group falls to the footer rather than vanishing;
  NAV-07 asserts nothing is actually unfiled.

### Outstanding balance and collections — phase 7
Step 10 of the order-to-cash spine: a part payment was recorded and approved,
and then nothing tracked or chased the remainder.

`/collections` lists who owes money, longest overdue first, aged 0-30 /
31-60 / 60+ by order date with a reconciling totals row. Gated on `revenue`,
no new access area.

**Three inconsistent balance formulas were already live and disagreed about
the same client.** Finding them was the real work; the queue is built on the
one definition that replaced them (`src/lib/outstanding.ts`).

- `clients/page.tsx` used `ordered − paid` counting only order-linked
  payments, so it omitted delivery add-ons and returns and reported a client
  as owing money they had already paid as an advance.
- `clients/[id]/page.tsx` used the fuller formula, so list and detail showed
  different dues for one customer. Neither was labelled an approximation.
- **`dashboard/owner-panel.tsx` was the worst:** it summed the due over
  `pendingOrders`, which is `take: 5`. The owner's headline "Due from clients"
  was the balance on the five most recent open orders, not the total, and
  understated receivables with nothing on screen to say so.

Also: ageing is FIFO over orders (money settles the oldest bill), the buckets
always sum to the balance, and an overpayment is now shown as a credit instead
of being hidden behind `Math.max(0, balance)`. The clients list no longer
loads every order, item, delivery and payment of 50 clients to add up two
numbers — six aggregates serve any number of clients. One behaviour change
worth naming: the "N orders" pill no longer counts cancelled orders.

Tests: scripts/e2e/run-collections.ts, 73/73.

### Stock allocation against orders — phase 8
Built **differently from the plan**, which proposed holding stock per order in
a reservation table. Two findings changed the design:

1. The allocation already existed, sixty lines inline in `fulfilment/page.tsx`
   — ready stock was already handed down the queue oldest-first, so the
   plan's "two orders can both be promised the same pallet" was already
   half-solved on that one screen.
2. A stored reservation would need keeping in step with order creation,
   cancellation, partial dispatch, stage reversal and manual stock
   corrections — six writers to one derived number, which is the risk the
   plan itself flagged.

So allocation is **derived on read** (`src/lib/allocation.ts`), holds nothing,
and cannot drift. "Release on cancellation" and "partial dispatch" stop being
rules anyone has to implement. Nothing was added to the payment-approval
transaction, so an approval can still never fail because the godown is short.

What the extraction fixed:
- **The dashboard and the queue disagreed.** `supervisor-panel.tsx` showed the
  whole ready total as available while `/fulfilment` showed most of it already
  committed. Both now read the allocator; the tile reads "N free · N
  committed".
- **A shortfall now names who is holding the stock** (`blockedBy`), instead of
  a bare number that meant reading the whole queue to explain.
- **Dispatch can be refused** when a delivery would take an earlier order's
  bricks — behind `Settings.stockAllocationEnforced`, **off by default**,
  because the failure mode of a wrong check is that dispatch stops.
  Owner/manager can override; the override is written onto the delivery.
  `updateDelivery` checks only the *increase*, since the existing quantities
  are already drawn down.

Not a lock, and the feature doc says so: two people dispatching in the same
second can both pass. Accepted for one supervisor and one godown.

Schema: one additive `Settings.stockAllocationEnforced Boolean @default(false)`.
`migrate diff` showed a single ADD COLUMN, no DROP. **Applied to the throwaway
database only — not pushed to production.**

Tests: scripts/e2e/run-allocation.ts, 51/51. ALLOC-10 carries a verbatim copy
of the original page logic and compared 591 order allocations across 200
generated scenarios with zero disagreement — the refactor is checked against
the behaviour it claimed to preserve, not just against itself.

### Testing gaps closed, and CI
Every gap recorded in TESTING.md is now closed. **626 assertions, 0 failures**,
run against a throwaway Postgres and again from an empty database.

- **`run-rbac.ts` had never been executed** — it was type-checked only. Run
  end to end: 50/50.
- **`run-db.ts` tested a retired code path.** `TC-DBQ-06` called
  `convertQuotationToOrder` directly, which no user can reach since the
  payment gate landed, so a regression in the gate would not have shown up.
  Rewritten to drive sent → payment recorded → manager approves → order,
  keeping every original assertion and adding the gate's own: a claim banks
  no money and creates no order, approval writes exactly one cashbook entry,
  a second approval double-counts nothing. 105 → 121 assertions.
- **Stage transitions and task delegation were untested.** Server actions
  cannot be driven over HTTP from a script, so the *decisions* were extracted
  into pure functions — `decideStageChange`, and `canCreateTaskFor` /
  `canUpdateTaskStatus` / `canReassignTask` / `canDeleteTask` — and the
  actions now call them. `run-actions.ts`: 135/135, including the full 4×4
  stage matrix and the assignee-may-complete-but-not-delete pair.
- **CI** (`.github/workflows/ci.yml`): typecheck, lint, both suite groups and
  the build, on every push and PR, against a disposable Postgres service
  container. CI holds no secrets.
- npm scripts: `typecheck`, `test:unit`, `test:db`, `test:pdf`, `test`,
  `test:seed`.

**A real footgun found while wiring CI.** Every suite guards on
`DATABASE_URL`, but `prisma db push` and `prisma migrate` connect through
**`directUrl`**, and `.env` points `DIRECT_URL` at live Supabase. Overriding
`DATABASE_URL` alone passed every existing guard and would have pushed the
schema to production and then run `prisma/seed.ts`, which truncates 34 tables.
`scripts/guard-local-db.mjs` now requires both urls to be local and fronts
`npm run test:seed`.

### Open questions resolved, and one bug found on the way
Three of the items waiting on a decision could be settled without one.

- **`changePassword` changed the wrong user's password.** It loaded
  `findFirst({ where: { role: "admin" } })` and edited that row. So a manager
  changing "their" password was editing the owner's account — not an
  escalation, since they still had to know the owner's current password, but
  their own password never changed and nothing on screen said so. And if the
  sole owner's role string was `owner` rather than `admin`, the lookup matched
  nobody and the page threw "No admin user found". Now operates on the session
  user, re-read from the database. Found while raising the minimum, not
  reported by anyone.
- **Password minimum raised to 8 for owner/admin/manager**, kept at 4 for
  supervisor/telecaller/staff. A password is the only factor left since the
  username bypass closed, and a full-access account can read the cashbook and
  payroll and create logins — but a supervisor tapping a short code into a
  tablet beside the machine is not the account worth hardening, and forcing 8
  there puts it on a wall. `minPasswordLength` / `passwordProblem` in
  `lib/roles.ts` drive the forms and the server actions from one rule, checked
  against the role being *granted*, so promoting a supervisor to manager
  cannot carry a 4-character password onto a full-access account.
  **Login is unchanged** — existing short passwords keep working and the rule
  bites on the next change. Whether to force a reset is still open.
- **`masonRate` = 0 is now visible instead of silent.** Settings → Price
  matrix counts the priced combinations missing a mason rate or production
  cost, names them, and says what each gap breaks (zero payouts; margin
  reading as the full sell price). The figures themselves still have to come
  from the owner.

Tests: `PW-01` in run-actions.ts. 154/154.
