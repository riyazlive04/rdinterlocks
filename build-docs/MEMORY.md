# Project memory

Decisions made and why, constraints, conventions, open questions. Read at the
start of every session. Update whenever a decision is made.

## Constraints

- **The database is live production and takes writes during development.** A
  real Transcriber lead arrived mid-session on 2026-11-02. Treat every schema
  change as a production deploy.
- **`prisma db push` is the only migration path.** There is no migrations
  directory. Always run `prisma migrate diff --from-schema-datasource
  --to-schema-datamodel --script` first and read the SQL; a push that would
  `DROP` anything needs explicit confirmation.
- **Deployment target is local now, a VPS later — not Vercel**, despite
  `vercel.json` existing. Scheduled work therefore cannot rely on Vercel Cron:
  jobs are HTTP endpoints plus a thin invoker script under `scripts/`, wired
  to an npm script (`cron:tick`, `cron:sweep`) and driven by Task Scheduler or
  a VPS crontab.
- **`DIRECT_URL` is the dangerous one.** The e2e suites all guard on
  `DATABASE_URL`, but `prisma db push` / `migrate` connect through
  `directUrl`, and `.env` points `DIRECT_URL` at live Supabase. Overriding
  `DATABASE_URL` alone passed every guard and would have pushed to
  production. `scripts/guard-local-db.mjs` now requires BOTH to be local and
  fronts `npm run test:seed`.
- **`prisma/seed.ts` wipes 34 tables.** It now refuses to run against a
  database holding data unless `--force-reset` is passed. For a live database
  use the targeted seeds instead; each dry-runs by default.

## Decisions

| Decision | Why |
|---|---|
| Manager has the **same access** as Owner (`isAdmin` includes manager) | The factory runs with both seeing the same system; a manager who could not price a quotation could not cover for the owner. They remain distinct role strings because the task hierarchy must tell them apart. |
| Only an Owner may **confer owner rank** or edit an owner | Access and rank are different. The role field is the chain of command itself; a manager who could set it could promote themselves out of the hierarchy. Costs managers nothing else. |
| Telecaller rotation is **presence, not a call counter** | The original brief said "rotate every 15 calls". The owner corrected it: the number is not fixed (20, 30, whatever). What matters is seeing who is speaking, since when, and from where, so leads reach the right person. An open `DutySession` is what makes a telecaller routable. |
| **Manager approval of a payment creates the Order** | Accepting a quotation used to create one immediately, so work could reach the factory floor before anyone checked the money arrived. |
| `QuotationPayment` is **not** the money record | It is an unverified claim in a `pending` state. A cashbook reading it would count unverified and rejected claims as cash in hand. On approval it is copied into one authoritative `ClientPayment` + `CashEntry`. |
| Delivery zones are **never inferred** from free-text `place` | The bands' area lists genuinely overlap ("Ammapettai" and "Thoppur" each appear in two). A wrong guess is a ₹4–6/brick error on a priced document. `Lead.zoneId` is set explicitly by whoever established it on the call. |
| The quotation PDF is **frozen at submission** | The PDF route composes from current Settings, so a quotation approved in November re-rendered with January's terms. The reviewed bytes must be the sent bytes. |
| Locking begins at **`approved`**, not `sent` | Once a PDF is frozen and approved, editing the quotation underneath invalidates the approval. |
| `Die` / `DieUsage` kept, and given a screen | They existed in the live database but were never committed here, so the next push would have dropped them. Both empty. **Owner's ruling (2026-11-03): keep them and let the manager or supervisor maintain them.** Built as `/die`, ported from `origin/feature/register-dies-avm-tipper-pl` — whose four server actions had NO authorization at all; adding the gates was the work. |
| A costed die needs **cashbook** access, not just `die` | Registering and flipping a mould is a shop-floor fact. Recording what it COST writes a `CashEntry` + `Expense`, so a supervisor without `expense` saves it at zero and a manager adds the amount — which is the normal order anyway, since the die arrives before the invoice. |
| Deleting a die is **owner/manager only** | It removes the `Expense` *and* its `CashEntry`. Money leaving the books is not a shop-floor act — same reasoning as the payment-approval gate. |
| Navigation grouping **grants nothing** | Phase 6 is presentation only: `groupedNav` calls `visibleNav` and partitions the result, so access rules keep sole authority. NAV-01 asserts set equality for every role — if grouping dropped an item a role would silently lose a route, and on mobile `/menu` is the only path to it. |
| A supervisor's menu **keeps Clients & Sales** | The plan's acceptance said "only Make and Move". Wrong: `sales` is in `DEFAULT_AREAS_BY_ROLE.supervisor`, so hiding it would be an access change and would leave a page they can open with no link to it. |
| Settings keeps its **existing 9 groups** | The plan proposed re-dividing Settings three ways. It is already grouped and only owner/manager see it, so collapsing 9 labelled groups into 3 larger ones loses information for no gain. Not done; deliberate. |
| **One** definition of what a client owes (`lib/outstanding.ts`) | Three were live and disagreed: the clients list omitted add-ons, returns and advances; the detail page had the fuller formula; the owner dashboard summed only `take: 5` orders, so the headline receivables figure understated the total with nothing on screen to say so. |
| Receivables age **FIFO over orders** | There are no invoices, so an order is the billable unit, and money settles the oldest bill — which is what the office already does informally. Allocating each payment to the order named on it leaves advances unallocatable. The buckets always sum to the balance; that invariant is what makes the view checkable. |
| An overpayment reads as a **credit**, not zero | `Math.max(0, balance)` hid a genuine overpayment from the only people who could refund it. |
| Stock allocation is **derived, never stored** | Phase 8 was planned as a reservation table. Rejected: a stored reservation needs keeping in step with order creation, cancellation, partial dispatch, stage reversal and manual corrections — six writers to one derived number. Recomputing on read holds nothing and cannot drift, and "release on cancellation" and "partial dispatch" stop being rules anyone implements. |
| Allocation is **advisory, not a lock** | Two people dispatching in the same second can both pass. Accepted for one supervisor and one godown, with bricks physically counted onto the lorry and `remaining` reconcilable afterwards. Revisit if a second godown opens. |
| Server-action **decisions** live in pure functions | Next.js server actions cannot be driven over HTTP from a script (encrypted action ids, no request context), so the rules were lifted into `decideStageChange` and the `can*Task*` family and the actions now call them. The boundary did not move: roles are still read from the DB inside the action. |
| Password minimum **8 for full access**, 4 for the rest | A password is the only factor left since the bypass closed, and owner/manager can read the cashbook and payroll and mint logins. Floor-staff codes stay short on purpose. |
| Settings keeps **9 groups**, not 3 | See the navigation row above — already grouped, owner/manager only, so re-dividing loses information. |
| Access areas carry a **group**, the same five as the nav | 22 flat checkboxes in declaration order is the wall phase 6 removed from the sidebar, and the permission screen is the one place a mis-click hands somebody the payroll. PERM-01 asserts every area is in exactly one group — an ungrouped area would not render and would look identical to a revoked grant. |
| `setUserArea` is **one area at a time**, not a reuse of `updateUser` | `updateUser` takes name, role, permissions and active together, so driving one checkbox through it means the browser sends the whole user back: a stale tab could revert a rename or re-enable a disabled login. One-area writes also mean two owners toggling different areas cannot clobber each other. |
| Per-area grants are **not stored** for full-access roles | `isAdmin` short-circuits `can()`, so writing a grant for an owner or manager would be a lie the UI then has to explain. The matrix shows "everything" and points at the role instead. |
| Zone renames happen **in place** (`ZoneDef.renameFrom`) | The seeder upserts on `name`, so renaming a zone would create a second row and orphan the first — still holding its ZonePrices and still offered in the dropdown. Two plausible zones for one place is worse on a priced document than a stale name. RATE-07 asserts no rename target collides with a live name. |
| The rate chart is transcribed **twice** | Once as `prisma/delivery-zone-defs.ts`, once in `scripts/e2e/run-pricing.ts`, read off the PDF independently, and compared cell by cell. A mistyped digit fails nothing on its own — it quotes a plausible wrong price that is only found after the customer has the document. One copy proves nothing. |
| **Karnataka = customer's own transport** (assumption) | The 2026-11-03 sheet adds "Karnataka (Transport own)" at ₹44/₹54. Read as the customer arranging their own lorry, because ₹44/₹54 sits just under the 0-20 km band and far below 300 km+ (₹61/₹78) — only possible if no delivery is being paid for. **If it means RD sends its own vehicle, the row is wrong and the price is far too low.** Flagged to the owner, not silently assumed. |
| Task progress is `open | wip | done`, and `wip` is **reconciliation** | The live database still defaults `Task.status` to `"wip"`, a value predating the schema. The tasks page treated it as not-done and showed it; **all three dashboards filtered `status: "open"` exactly and hid it.** Making it first-class fixed that split. Every count now asks "not done", never "is open". |
| Task status has **no one-step rule**, unlike fulfilment stages | The stage rule exists because an order marked `dispatched` that was never made reads as sent and is only found when the customer rings. A task marked done that is not done is visible to whoever assigned it, so the ceremony would buy nothing and would block the common case of a five-minute job that never "starts". |
| **The assignee may change priority**, not just the delegator | They are usually the person who discovers something is urgent, and a senior can always correct it. Same permission as changing status (`canUpdateTaskStatus`). |
| Overdue outranks **urgent** in the task sort | A missed deadline is already a failure; an urgent task due next week is not yet one. |
| Recurrence is **completion-driven**, never clock-driven | Two reasons: this factory runs no scheduler, and — the one that matters — a clock-driven routine nobody completes stacks up. "Sweep the yard" unchecked for six weeks becomes forty-two rows and ruins the one screen meant to say what needs doing. One open occurrence at a time is correct, not a limitation. **Cost:** a missed week is not recorded as missed; read the completion history for that. |
| Attachments are **bytes in the row**, on an allow-list | Same decision as `QuotationDocument`: no object storage, no persistent disk, so a file on disk is what a redeploy loses. The type is an allow-list, never a block-list, because the file is served to a browser and HTML/SVG/XML can execute in this origin. Only images and PDF go inline; text and CSV are forced as downloads. |
| The attachment route returns **404, not 403** | For both "no such file" and "not yours", so responses cannot be used to enumerate which attachment ids exist. A cuid is unguessable but it is not a permission — the security review found that exact mistake twice. |
| **Creator** can always read a task back | The one way `canViewTask` is broader than `canUpdateTaskStatus`. Whoever asked for the work must see the photo of why it could not be done, even after a reorganisation leaves them outranking nobody. |
| Changing the **instruction** ≠ doing the work | Adding/removing a checklist step and setting recurrence need creator-or-senior standing; ticking a step needs only contributor. Otherwise an assignee could delete the part of the job they did not fancy, or commit a colleague to a daily task forever. |
| Nobody outranks an **owner**, including for reading | So an owner's task is readable only by its assignee or creator, not by another owner. The phase 4 no-peers rule applied consistently to reading. Pinned by VIS-03. |
| Base price matrix = the **0–20 km band** | The owner's rate chart prices by distance and has no factory-gate column. Stated as an assumption; change in Settings → Price matrix if collection differs. |

## Conventions

- Areas (`src/lib/access.ts`) answer "may this user open this screen".
  `src/lib/roles.ts` answers "where do they sit in the chain of command".
  Keep the two separate.
- Every authorization decision re-reads the subject's role from the database.
  Never trust a role or id that arrived with the request.
- New behaviour ships **off by default** behind a Settings flag, so the desk's
  current workflow is never changed by a deploy.
- Refusals name the reason and a route out ("500 ordered, 1000 minimum —
  raise the quantity, pick a nearer zone, or type an agreed price").

## Open questions

- **`main`'s `not_done` task status was dropped by the merge (2026-11-03).**
  `main` modelled a task as `wip | done | not_done`, where `not_done` is a
  closed state that must carry a reason. This branch models the same
  situation as a task that stays `open`/`wip` with a `statusReason`, and its
  status set is `open | wip | done`. Keeping this branch's tasks screen (far
  larger: priority, categories, steps, notes, files, recurrence) means
  `not_done` no longer exists anywhere in the code.
  - Nothing hard-parses a status on READ, so a production row still holding
    `not_done` renders as "not done" rather than crashing.
  - **Unverified:** whether any live row actually holds it. Production reads
    were blocked by the sandbox, so this was never checked. Query:
    `SELECT status, count(*) FROM "Task" GROUP BY status;`
  - Decide: re-add `not_done` as a fourth status, or leave it as
    "open with a reason".


- ~~**Above 160 km conflicts.**~~ **Resolved by the 2026-11-03 sheet**, which
  lists both rows explicitly as separate bands: *above (160-300)* at ₹58/₹73
  and *300 kms & above* at ₹61/₹78. It was never a conflict — both were right.
  The 160-300 band also turned out to contain **Dindigul**, which had been
  transcribed into 110-160 (₹3-6/brick under-quote on every Dindigul job).
- **`masonRate` is 0** on all four price rows — the rate chart is sell-side
  only, and **the 2026-11-03 sheet still is**, so this is not something a new
  chart will fix. Mason payouts compute as zero until filled in. **Now visible
  rather than silent:** Settings → Price matrix counts the gaps, names the
  combinations and says what each one breaks. Still needs the figures from the
  owner.
- **Godown is unpriced.** It is a ConstructionType but absent from the chart —
  **still absent from the 2026-11-03 sheet**, which has only C (Compound) and
  R (Room) columns. Quoting it is refused, with a message naming the fix
  (TC-DBQ-03). Needs a Godown rate from the owner, or the type retiring.
- **Call recordings** are deferred. The Transcriber sends only a `callId`; the
  cheapest fix is a `recordingUrl` sent alongside the lead, which needs a
  change on the provider's side and so has a lead time.
- ~~**Lead intake direction.**~~ **Resolved 2026-11-03: the provider PUSHES to
  us**, on channel `metarelay`. Configured in `.env`
  (`LEAD_WEBHOOK_CHANNELS`), verified end to end against the local server: a
  signed delivery returns 201 and creates the lead; a forged signature, a
  missing signature and an unknown channel all return 401. **The secret lives
  only in `.env`, which is gitignored — it is not in any commit.**
  `lib/facebook-feed.ts` (the pull relay) is therefore not needed for this.
  **Open:** the endpoint given is
  `https://sirah-crm-tfvi.vercel.app/api/v1/leads/webhook/metarelay` — a
  **Vercel** URL whose path is this app's own route, which contradicts the
  recorded "not Vercel" deployment decision. Either this app is deployed
  there after all, or `sirah-crm` is a separate relay that forwards to it.
  Needs confirming before the channel is treated as live.
- ~~**Password minimum is 4.**~~ **Resolved:** 8 for owner/admin/manager, 4
  kept for supervisor/telecaller/staff (a short code tapped into a tablet by
  the machine is not the account worth hardening, and raising it pushes the
  code onto a wall). `minPasswordLength` / `passwordProblem` in `lib/roles.ts`
  drive both the form and the server action. **Login is unchanged**, so
  existing short passwords keep working — the rule bites on the next change.
  **Owner's ruling (2026-11-03): no forced reset — the requirement will be
  shown to the manager as a popup when the system moves to production.** That
  popup is NOT built: it needs a "we are live now" signal that does not exist
  yet.

## Known issues

- 16 ESLint warnings, all pre-existing unused imports.
- **The live schema push is PREPARED AND REVIEWED but NOT APPLIED.** The
  exact SQL is committed at
  `prisma/pending/2026-11-03-task-extensions-and-stock-flag.sql`: entirely
  additive, 0 DROP/TRUNCATE/DELETE. A before-snapshot of the live database
  was taken (`scripts/db-snapshot.ts`) — 65 tables, 590 columns, 864 leads,
  121 cash entries, 46 client payments. `npx prisma db push` was **blocked by
  the sandbox's production-deploy guard**, not by a problem with the change.
  It needs the user to run it or to grant the permission.
- **Production zones are still the OLD rate chart.** The 2026-11-03 seed is
  idempotent and non-destructive: 6 updates, 2 renames, 1 new Karnataka band.
  Until it runs, Dindigul quotes at the 110-160 km rate (₹3-6/brick under).
- **The task extension schema is on the throwaway test database only** —
  `TaskChecklistItem`, `TaskComment`, `TaskAttachment`, plus `Task.category`,
  `recurrence`, `recurrenceSpawnedAt`, `recurrenceParentId`. All additive
  (`migrate diff`: 0 DROP statements). `/tasks` will error on production
  until pushed.
- **`Task.priority` and `Task.startedAt` are on the throwaway test database
  only** (two additive columns + one index; `migrate diff` showed no `DROP`).
  Production lacks them, so `/tasks` will error there until pushed.
- **The 2026-11-03 rate chart has been applied to the throwaway test database
  only.** Production still has the old zones, so Dindigul still quotes at the
  110-160 km rate there and Karnataka is unquotable. Run
  `npx tsx prisma/seed-delivery-zones.ts` (dry run first — it prints the two
  renames and the one new band) when the owner says to go live.
- `Settings.stockAllocationEnforced` has been pushed to the **throwaway test
  database only**. Production still lacks the column, so the automation page
  will error there until it is pushed. One additive `ADD COLUMN`, no `DROP`
  (`migrate diff` checked). **Owner's instruction (2026-11-03): do not move to
  production for now** — so it stays unpushed and the app is local-only until
  they say otherwise.
- **The production-time manager popup for the new password minimum is not
  built.** Decided, not implemented: there is no signal for "we are in
  production now". It needs a trigger (a Settings flag, or first run against
  the live database) before it can exist.
- The branch is **pushed to GitHub** (`origin/feat/lead-intake-quote-review`)
  and `main` has been fast-forwarded onto it. See "Merging main" below.
- ~~`changePassword` changed the wrong user's password.~~ **Fixed:** it
  loaded `findFirst({ role: "admin" })`, so a manager changing "their"
  password edited the owner's row (not an escalation — they still needed the
  owner's current password — but their own password never changed and nothing
  said so), and it threw "No admin user found" outright if the sole owner's
  role string was `owner`. Now operates on the session user, re-read from the
  database.

## Merging `main` into this branch (2026-11-03)

This branch was cut from a base 21 commits behind `origin/main` and never
rebased, so `main` meanwhile gained the loading-billing work, the sales
register, AVM vendor money and "3-state statuses". Merging conflicted in 23
files. The decisions worth keeping:

- **`Order.status` had TWO vocabularies.** This branch used
  `open | partial | complete | cancelled`; `main` used
  `upcoming | active | completed | cancelled` and changed the column DEFAULT
  to `active`. Both sets of literals ended up in one codebase and **every
  test still passed**, because each suite seeded its own vocabulary and never
  met the other's. The live failure was silent: the owner's "Pending orders"
  panel queried `in: ["open", "partial"]`, which matches nothing once a row
  defaults to `active`, so it rendered empty with no error.
  **Resolved** by making `lib/order-status.ts` the single source:
  `OPEN_ORDER_STATUSES` / `CLOSED_ORDER_STATUSES` / `isOrderOpen()`, each
  carrying the LEGACY spellings as well as the canonical ones, because rows
  written before the merge are still in the database and the merge does not
  rewrite them. Only canonical values are ever written (`deriveOrderStatus`).
  Legacy `complete` counts as CLOSED, deliberately: a finished order wrongly
  read as open reappears in the fulfilment queue and the pending panel, which
  is the louder error. Covered by `scripts/e2e/run-order-status.ts` (35
  assertions).
- **Dies existed on both sides.** `main` added the same screen via `5306e06`
  with **no authorization on any of its four server actions**; this branch's
  port added the gates. Kept this branch's version — field-for-field the same
  model, strictly more checks. `main` never touched those files again.
- **Loading went the other way.** `main` is far ahead there (lintel slabs,
  order-linked deliveries, pay-at-the-lorry), and this branch had
  accidentally reverted the lintel feature. Took `main`'s loading screens and
  server actions, then **re-applied this branch's `requireArea("loading")`
  gates**, which `main` still lacks entirely.
- **Tasks**: kept this branch's version wholesale. `main`'s `not_done` status
  is **the one feature dropped by the merge** — see Open questions.
- `lib/delivery-sync.ts` (from `main`) is byte-identical logic to the stock
  helpers this branch had inlined in `clients/actions.ts`; the inline copies
  were deleted in favour of the shared module.
- `Vendor.payments` was renamed `vendorPayments` by this branch. No code
  reads that relation field by name, and typecheck is clean.

### Consequence to be aware of

`isAdmin()` on this branch includes `manager`; on `main` it did not. The
merge keeps this branch's rule, so **a manager now has full access to
`main`'s newer screens too** (sales register, loading money, AVM). That
follows the role decision already recorded above, but it had never applied
to those screens before.

