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
| `Die` / `DieUsage` kept in the schema | They existed in the live database but were never committed here, so the next push would have dropped them. Both turned out to be empty; retained pending a deliberate decision. |
| Navigation grouping **grants nothing** | Phase 6 is presentation only: `groupedNav` calls `visibleNav` and partitions the result, so access rules keep sole authority. NAV-01 asserts set equality for every role — if grouping dropped an item a role would silently lose a route, and on mobile `/menu` is the only path to it. |
| A supervisor's menu **keeps Clients & Sales** | The plan's acceptance said "only Make and Move". Wrong: `sales` is in `DEFAULT_AREAS_BY_ROLE.supervisor`, so hiding it would be an access change and would leave a page they can open with no link to it. |
| Settings keeps its **existing 9 groups** | The plan proposed re-dividing Settings three ways. It is already grouped and only owner/manager see it, so collapsing 9 labelled groups into 3 larger ones loses information for no gain. Not done; deliberate. |
| **One** definition of what a client owes (`lib/outstanding.ts`) | Three were live and disagreed: the clients list omitted add-ons, returns and advances; the detail page had the fuller formula; the owner dashboard summed only `take: 5` orders, so the headline receivables figure understated the total with nothing on screen to say so. |
| Receivables age **FIFO over orders** | There are no invoices, so an order is the billable unit, and money settles the oldest bill — which is what the office already does informally. Allocating each payment to the order named on it leaves advances unallocatable. The buckets always sum to the balance; that invariant is what makes the view checkable. |
| An overpayment reads as a **credit**, not zero | `Math.max(0, balance)` hid a genuine overpayment from the only people who could refund it. |
| Stock allocation is **derived, never stored** | Phase 8 was planned as a reservation table. Rejected: a stored reservation needs keeping in step with order creation, cancellation, partial dispatch, stage reversal and manual corrections — six writers to one derived number. Recomputing on read holds nothing and cannot drift, and "release on cancellation" and "partial dispatch" stop being rules anyone implements. |
| Allocation is **advisory, not a lock** | Two people dispatching in the same second can both pass. Accepted for one supervisor and one godown, with bricks physically counted onto the lorry and `remaining` reconcilable afterwards. Revisit if a second godown opens. |
| Server-action **decisions** live in pure functions | Next.js server actions cannot be driven over HTTP from a script (encrypted action ids, no request context), so the rules were lifted into `decideStageChange` and the `can*Task*` family and the actions now call them. The boundary did not move: roles are still read from the DB inside the action. |
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

- **Above 160 km conflicts.** The owner's v2.0 chart says one flat rate
  (₹58 / ₹73). The seeded data also has a *300 km & above* band at ₹61 / ₹78
  from the older sheet. Both are live; needs a ruling.
- **`masonRate` is 0** on all four price rows — the rate chart is sell-side
  only. Mason payouts compute as zero until filled in.
- **Godown is unpriced.** It is a ConstructionType but absent from the chart,
  so quoting it is refused.
- **Call recordings** are deferred. The Transcriber sends only a `callId`; the
  cheapest fix is a `recordingUrl` sent alongside the lead, which needs a
  change on the provider's side and so has a lead time.
- **Lead intake direction.** The webhook contract assumes the provider pushes
  to us. `FACEBOOK_FEED_URL` is a pull relay. If the provider hands over a URL
  for us to call, that is `lib/facebook-feed.ts` plus a scheduled poll instead.
- **Password minimum is 4** (`pinHash`, with a PIN login path), so short PINs
  look intentional. With the username bypass closed it is the only factor
  left; worth raising at least for owner and manager.

## Known issues

- 16 ESLint warnings, all pre-existing unused imports.
- `Settings.stockAllocationEnforced` has been pushed to the **throwaway test
  database only**. Production still lacks the column, so the automation page
  will error there until it is pushed. One additive `ADD COLUMN`, no `DROP`
  (`migrate diff` checked). **Needs explicit confirmation before pushing.**
- The branch is **7+ commits ahead of `main` with no upstream** — none of
  this is on GitHub yet.
- `changePassword` in `settings/actions.ts` changes **the first `role: "admin"`
  user's** password, not the signed-in user's. A manager changing "their"
  password edits the owner's row (they must still know the old one, so it is
  not an escalation), and it throws outright if the owner's role string is
  `owner` rather than `admin`. Found during this work; **not fixed** —
  flagged for a decision.
