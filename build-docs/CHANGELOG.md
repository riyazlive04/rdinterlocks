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

### Die register — phase 10
Resolves the `Die` / `DieUsage` open question. The owner's ruling: keep the
tables and let the manager or supervisor maintain them.

`/die` lists every die, both its faces, bricks pressed per face and cost per
1000. A die goes in on side 1, is flipped to side 2 when the first face wears,
and is retired when the second goes. A costed purchase books a `CashEntry` +
`Expense` under "Mould (Die)".

**Ported from `origin/feature/register-dies-avm-tipper-pl`** rather than
written — that branch already had a working screen and the domain logic is
sound. **What it did not have was any authorization: none of its four server
actions called `requireArea` or `requireSession`.** A server action is a
public HTTP endpoint whether or not a link points at it, and the security
review on this branch found exactly that hole in `/api/export`. The gates
added on the way in:

| Action | Gate |
|---|---|
| View, register at no cost, flip, retire, reopen | area `die` (new; supervisor default) |
| Register **with a cost** | `die` **and** `expense` — it books money |
| Delete | `isFullAccess` — it removes the expense *and* its cash entry |

Also wires `reopenDieSide`, which existed in the source branch's actions but
was never passed to the view, and hides the delete control from a supervisor
rather than showing it and refusing.

No schema change — both models were already declared. `migrate diff` is empty.

Tests: scripts/e2e/run-die.ts, 46/46, including the money unwind (DIE-07
asserts no stranded `CashEntry`, the production incident in MEMORY) and the
three authorization gates. Verified over HTTP: manager sees the page with the
delete control, supervisor sees it without, telecaller is redirected.

### Permission center — phase 11
One screen showing every login against every area, with each cell a toggle.

**What already existed and was NOT rebuilt:** Settings → Users & access
already created logins, set roles, disabled accounts and granted areas one
checkbox at a time. Both owner and manager can use it; only an owner can
grant owner rank or edit an owner. That editor is unchanged in behaviour.

**What was missing:** it edits one user at a time, so the question people
actually ask — *who can see the cashbook?* — meant opening every login in turn
and remembering. Now it is one column.

- `/settings/permissions` — users down the side, 22 areas across the top,
  grouped Sell / Make / Move / Money / Admin so the columns read in the same
  order as the menu the grant controls. Optimistic toggles that roll back and
  show the reason if the server refuses.
- **Areas now carry a group.** `PERM-01` asserts every area is in exactly one
  group and that no group names a non-existent area — an ungrouped area would
  simply not render and would look identical to a revoked grant.
- **The per-user editor is grouped too**, with an all/none shortcut per group,
  since "this person does the money side" was four separate clicks.
- `setUserArea` is one narrow action rather than a reuse of `updateUser`.
  `updateUser` takes name, role, permissions and active together, so driving a
  single checkbox through it means the browser sends the whole user back — a
  stale tab could revert a rename or re-enable a login somebody just disabled.
- Refusals: not a real area key, a subject who is an owner when you are not,
  a full-access subject (no per-area grants are stored for them), and
  yourself. The rules moved to `lib/roles.ts` as pure predicates
  (`canAdministerUser`, `canConferRole`, `canSetUserAreas`); the existing
  asserts in `settings/actions.ts` now delegate to them, so the screen and the
  action cannot drift. Rows the signed-in user may not change render disabled
  with the reason, rather than being offered and then refused.

Tests: scripts/e2e/run-permissions.ts, 79/79. Verified over HTTP with real
sessions: owner and manager get the grid, a manager sees the owner's row
locked, a telecaller is redirected, the manager row shows "everything" rather
than 22 checkboxes, and all five group headers render.

**npm test: 754 assertions, 0 failures, exit 0.**

### Rate chart updated from the 2026-11-03 sheet
Source: `AREA RATE RD BRICKS.pdf- Google Sheets.pdf`.

**Every price is unchanged.** All nine bands match what was already seeded, so
no quotation had been priced wrongly by a *rate*. What the new sheet corrected
was which band a place sits in — and that is where the money was:

- **Dindigul moved from 110-160 km to 160-300 km.** 6" Room ₹55 → ₹58, 8" Room
  ₹67 → ₹73. The old transcription under-quoted every Dindigul job by
  ₹3-6/brick; on 5,000 bricks that is ₹15,000-30,000.
- **New band: Karnataka (customer's own transport), ₹44/₹54** — previously
  unquotable. *Assumption flagged:* "Transport own" is read as the customer
  arranging their own lorry, because ₹44/₹54 sits just under the 0-20 km band
  and far below 300 km+ (₹61/₹78), which only works if no delivery is being
  paid for. If it means RD sends its own vehicle, the row is wrong.
- **The 160 km+ "conflict" was never a conflict.** MEMORY recorded that the
  v2.0 chart said one flat ₹58/₹73 while the data also had a 300 km+ band at
  ₹61/₹78, and asked for a ruling. The new sheet lists both rows explicitly as
  separate bands. Both were right.
- The two far bands now **name their districts** instead of reading "Other
  districts", and six area names the sheet carried were missing: Poonachi and
  Chennampatti (0-40), Chinnappampatti (40-60), Kannakurichi (60-90),
  Salem Puthuchathiram / Thingalur / Pasur / Vellakovil (90-110),
  Uthangarai (110-160).

**Renames are done in place.** The seeder upserts on `name`, so a renamed zone
would be created fresh and the old row left orphaned — still holding its
ZonePrices and still offered in the zone dropdown. `ZoneDef.renameFrom` makes
it rename the existing row, keeping its id and any quotation history. Verified
9 zones before and 9 after, with a dry run that reports renames rather than
implying a duplicate.

**The chart is now transcribed twice** — once as the app's data, once in
`scripts/e2e/run-pricing.ts` read off the PDF independently — and compared cell
by cell. A mistyped digit fails nothing on its own; it produces a plausible
wrong price found only after the customer has the document. RATE-08 also prices
all nine bands through `resolveQuotationItems`, the path a telecaller takes.

Still not on the sheet, so still unresolved: **Godown** (only C and R columns,
so it stays unquotable), **6"H** (falls back to the flat matrix), and
**masonRate / productionCost** — the sheet is sell-side only, so a new chart
will not fix those.

**Applied to the throwaway test database only — production untouched**, per the
instruction not to move to production yet.

Tests: scripts/e2e/run-pricing.ts, 226/226. npm test: 980 assertions, 0
failures, exit 0.

### Task priority and progress — phase 12
**Tasks were already assignable, and that was verified before anything
changed.** Work travels strictly down the chain with reassignment, completion,
a parked reason, deletion and three views. Confirmed live over HTTP as each
role: an owner is offered managers, a manager is not offered an owner, a
telecaller is offered nobody and gets no create form.

What a task could not say was how urgent it is, or whether anyone had started.

- **Priority** — urgent / high / normal / low, default normal, with the
  consequence spelled out in the dropdown ("Drop everything — production is
  stopped"). Settable by the assignee **or** a senior: the assignee is usually
  the person who discovers something is urgent, and a senior can correct it.
- **Progress** — `open → wip → done`, with `startedAt`, so "nobody has picked
  this up" is finally distinguishable from "in progress". One tap walks a row
  forward; a half-filled box means started.
- **Sort** — overdue, then priority, then due date. Overdue outranks urgent
  deliberately: a missed deadline is already a failure.
- **Filter** — Everything / Urgent only / Overdue / Not started.

**A live bug fixed on the way.** `wip` is not a new invention — the production
database still defaults `Task.status` to it, a value predating the schema. The
tasks page treated those rows as not-done and listed them, while **all three
dashboards filtered `status: "open"` exactly and hid them**. So an in-progress
task was invisible on every dashboard. All four queries now ask
`status: { not: "done" }`, which raises the open and overdue counts on the
owner, supervisor and telecaller panels. TASK-15 runs the old filter beside the
new one and asserts the old one saw fewer, so the bug is demonstrated rather
than just corrected.

Deliberately **no one-step-at-a-time rule** here, unlike the fulfilment stages:
that rule exists because an order marked dispatched that was never made reads
as sent to the office, whereas a task marked done is visible to whoever
assigned it. A five-minute job can go straight to done.

Schema: `priority` and `startedAt` plus one index — additive, `migrate diff`
showed no `DROP`. **Applied to the throwaway test database only.**

Tests: run-actions.ts 154 → **229/229**. npm test: 1,055 assertions, 0
failures, exit 0. Caught one real defect during the live check: a non-function
export (`TASK_STATUS_VALUES`) in a `"use server"` file 500'd the whole page —
found by rendering the real screen, not by the unit suites.
