# Test strategy and results

## Strategy

Four layers, in cost order:

1. **`npm run typecheck`** (`tsc --noEmit`) — the only gate that existed
   before this branch.
2. **`npm run lint`** — ESLint was never actually installed; `npx eslint` was
   fetching a throwaway copy each time, which is why it always failed. Now
   installed with a flat config (ESLint 9 no longer reads `.eslintrc`).
3. **`npm run test:unit`** — suites needing no database at all. They run
   anywhere, including CI with no services.
4. **`npm run test:db`** — suites against a real Postgres, using the `tc` /
   `eq` / `ok` / `throws` / `run` harness.

`npm test` runs all four. `npm run test:pdf` is kept separate because it needs
a headless Chrome: a missing browser is an environment problem, not a code
regression.

### Running the database suites

Every suite in `scripts/e2e` **refuses to run unless `DATABASE_URL` is
local**, because they write and delete rows.

```
docker run -d --name rdi-test-pg \
  -e POSTGRES_USER=rditest -e POSTGRES_PASSWORD=rditest -e POSTGRES_DB=rditest \
  -p 55432:5432 postgres:16-alpine

export DATABASE_URL=postgres://rditest:rditest@127.0.0.1:55432/rditest
export DIRECT_URL=$DATABASE_URL     # BOTH — see the warning below

npm run test:seed    # schema + seed + zones + prices + quote settings + stages
npm test
```

`E2E_ALLOW_REMOTE_DB=yes` overrides the per-suite guard. Do not point it at
the hosted Supabase database — that is production and takes live writes.

> **`DIRECT_URL` must be set too, and `npm run test:seed` now enforces it.**
> The suite guards all check `DATABASE_URL`, but `prisma db push` and
> `prisma migrate` connect through **`directUrl`** — and `.env` supplies
> `DIRECT_URL` pointing at the live Supabase database. So overriding
> `DATABASE_URL` alone and running a push passed every existing guard and
> would have written the schema change to production, then run
> `prisma/seed.ts`, which truncates 34 tables. `scripts/guard-local-db.mjs`
> now refuses unless **both** urls are local; `ALLOW_REMOTE_DB_PUSH=yes`
> overrides it. Found while wiring CI, not by it.

## Results

All figures below are from a real run against a throwaway Postgres on
2026-11-03, and again from an empty database to confirm the CI path.

| Suite | Covers | Result |
|---|---|---|
| `run-nav.ts` | Navigation grouping (phase 6) | **50/50** |
| `run-offline.ts` | Lead normalisation, webhook signing, pure logic | **128/128** |
| `run-order-status.ts` | One order-status vocabulary after the `main` merge | **35/35** |
| `run-pricing.ts` | The rate chart, transcribed twice and compared | **226/226** |
| `run-rbac.ts` | RBAC, duty, payment gate, security fixes | **52/52** |
| `run-actions.ts` | Stage transitions, task delegation, priority & progress, password rule | **229/229** |
| `run-task-extensions.ts` | Categories, checklists, notes, files, recurrence | **164/164** |
| `run-collections.ts` | Outstanding balance and ageing (phase 7) | **73/73** |
| `run-allocation.ts` | Godown stock allocation (phase 8) | **51/51** |
| `run-die.ts` | Die register: lifecycle, money unwind, three gates | **46/46** |
| `run-permissions.ts` | Area grouping, grant writes, who may administer whom | **79/79** |
| `run-db.ts` | Quotation pricing/numbering, the real order-to-cash spine, WhatsApp gates, Meta ingestion | **121/121** |
| `run-pdf.ts` | PDF render, pagination, XSS escaping, Tamil shaping | **18/18** |
| `probe-routes.mjs` | All 60 routes, authenticated as owner (now incl. `/avm`, `/clients/register`) | all 200 |
| `npm run build` | Production build | clean |

**1,254 assertions, 0 failures** (`npm test` exit 0). Typecheck clean.
Lint: 0 errors, 17 warnings, all pre-existing unused imports.

### After merging `main` (2026-11-03)

The merge of `origin/main` conflicted in 23 files. Re-verified afterwards:

- `npm test` — **1,254/1,254**, exit 0.
- `prisma db push` against the throwaway database — the merged schema
  applies cleanly; `prisma validate` passes.
- `probe-routes.mjs` — all 60 routes return 200 as the owner, including
  the two routes `main` added.

**The merge's one real bug was invisible to the suites.** Both branches
defined `Order.status` differently and every assertion still passed,
because each suite seeds its own vocabulary and never meets the other's.
The owner's "Pending orders" panel rendered empty with no error. Found by
diffing the merged schema against each side and reading what the literals
actually matched — not by a test. `run-order-status.ts` exists so the next
one fails loudly; see `features/order-status.md`.

Two test expectations were updated rather than the code, both because a
route legitimately joined a group the test enumerated:
`NAV-04` now expects `register` under Sell and `avm` under Move, which is
what the rule recorded in that very test requires — a supervisor holds
`sales` and `tipper`, so hiding those links would leave pages they can
open with no way to reach them.

### Notable cases

| Case | Why it matters |
|---|---|
| `NAV-01` | Grouped output is set-equal to `visibleNav` for all six roles. If grouping ever drops an item a role silently loses a route, and on mobile `/menu` is the only way to it. |
| `COLL-02` | The three ageing buckets always sum to the balance, across five shapes of input including a return that exceeds its order. This is what makes the collections view checkable. |
| `COLL-03` | Σ reported paid = Σ `ClientPayment` = the cashbook entries behind them. If these disagree the queue is reporting money the cashbook does not have. |
| `ALLOC-10` | Carries a **verbatim copy of the original `fulfilment/page.tsx` logic** and compared 591 order allocations across 200 generated scenarios: zero disagreement. A refactor checked against the behaviour it claimed to preserve, not against itself. |
| `ALLOC-05` | A dispatched order neither claims stock nor reports a shortfall — the special case most likely to be lost in the extraction. |
| `STAGE-02` | The full 4×4 transition matrix for supervisor and owner. A supervisor has exactly 7 legal moves; an owner has all 16. |
| `TASK-05` | The assignee may complete a task but **not** delete it. Same actor, same task, opposite answers — asserted side by side. |
| `TC-DBQ-06` | Now drives the real spine: sent → payment recorded → manager approves → order. |
| `PW-01` | The password minimum follows `isFullAccess` for every role, and the owner/manager refusal explains itself rather than reading as arbitrary. |
| `DIE-07` | Deleting a costed die strands no `CashEntry` — the production incident recorded in MEMORY, now a permanent assertion. |
| `PERM-01` | Every access area is in exactly one group, and no group names an area that does not exist. An ungrouped area would silently not render and look exactly like a revoked grant. |
| `PERM-12` | A revoked grant binds on the next read, which is only true because the security review made sessions revocable. Pinned on the screen that makes the promise. |
| `RATE-01` | The rate chart is written out **twice** — once as the app's data, once in the suite, read off the PDF independently — and the two are compared cell by cell. One copy proves nothing; a mistyped digit does not fail anything on its own, it just quotes the wrong price. |
| `RATE-03` | Dindigul is in the 160-300 km band, pinned by name because that is the error the new sheet caught: it had been transcribed into 110-160, a ₹3/brick under-quote. |
| `RATE-08` | Every one of the 9 bands is priced **through `resolveQuotationItems`**, not just checked as data — the path a telecaller actually takes. |
| `TASK-11` | A legacy `wip` row counts as active. Written as "not done" rather than "is open", which is exactly the mistake that hid those rows from all three dashboards. |
| `TASK-15` | Runs the **old** `status: "open"` filter alongside the new one and asserts the old one saw fewer tasks — the bug is demonstrated, not just fixed. |
| `TASK-08` | A deliberate duplicate of TASK-01's core, as a regression pin that priority and progress did not widen who may assign to whom. |
| `ATT-02` | Filenames cannot escape a `Content-Disposition` header — path traversal both ways, CRLF injection, quotes and semicolons. The name reaches a header, so it is sanitised on the way in **and** again on the way out. |
| `REC-04` | Reopening and re-completing a repeating task makes no second successor. Without the conditional claim the reopen button is a task duplicator. |
| `REC-06` | An uncompleted daily routine still has exactly one row after six months — the argument for completion-driven recurrence, asserted rather than asserted-about. |

### Fixed on this branch

- **`run-rbac.ts` had never actually been executed.** It was type-checked
  only. Now run end to end against a throwaway Postgres: 50/50.
- **`run-db.ts` exercised the pre-payment-gate story.** `TC-DBQ-06` called
  `convertQuotationToOrder` directly — a route no user can take since the
  payment gate landed, so a regression in the gate itself would not have
  shown up. Rewritten to drive record → approve → order, keeping every
  original assertion (frozen price copied, client origin recorded, lead moved
  to won with history, double-approval refused) and adding the ones the gate
  is for: a claim banks no money and creates no order, approval writes exactly
  one cashbook entry, a second approval double-counts nothing.
- **Stage transitions and task delegation were untested.** Next.js server
  actions cannot be driven over HTTP from a script — the client posts an
  encrypted action id minted at build time, and `requireSession()` needs a
  request context. Rather than leave the rules untested or fake a request, the
  **decisions** were lifted into pure functions (`decideStageChange` in
  `fulfilment/stage.ts`; `canCreateTaskFor` / `canUpdateTaskStatus` /
  `canReassignTask` / `canDeleteTask` in `lib/roles.ts`) and the actions now
  call them. The security boundary did not move: every role passed in is still
  read from the database inside the action, never taken from the request.
- **No CI.** `.github/workflows/ci.yml` runs typecheck, lint, both suite
  groups and the build on every push and PR, against a disposable Postgres
  service container. CI holds no secrets — the suites would refuse a remote
  database anyway.

### Verified live, before being made permanent

Run against the live database with temporary scripts, which were then deleted
and rewritten as the suites above.

| What | Result |
|---|---|
| Full order-to-cash spine, 24 assertions | 24/24 |
| Login creation and sign-in for each role, 17 assertions | 17/17 |
| Security fixes after the review, 9 assertions | 9/9 |
| All 79 routes, authenticated as Admin | all 200 |
| 19 routes × 4 roles | 0 server errors; access matrix correct |
| Webhook: signed, idempotent, forged, stale, no-phone | 201 / 200 same ref / 401 / 408 / 400 |
| Cron endpoints with no key and a bad key | 401 on all four |
| PDF render → freeze → serve frozen | 453 KB, valid header, SHA matched |

**One mistake worth recording.** A temporary cleanup script matched
`CashEntry.note` when the field is `notes`, inside a `.catch()`, so it failed
silently and left an orphan ₹98,000 entry in the production cashbook. Found,
confirmed unlinked, deleted. Every permanent suite now deletes the `CashEntry`
explicitly by id and says why.

## Remaining gaps

- **No test drives a server action through HTTP.** The decisions are covered
  (above); the thin authenticate-and-write shells around them are not. Closing
  this properly needs a browser driver, which would be the first such
  dependency in the repo.
- **`ALLOC-09`** (owner/manager overriding a refused dispatch) is covered as a
  decision, not through `createDelivery` itself, for the same reason.
- **No test asserts rendered output.** `probe-routes.mjs` proves 61 routes
  return 200 and the nav suite proves what the sidebar is given, but nothing
  checks what a page actually looks like.
- **The PDF suite is `continue-on-error` in CI**, so a genuine PDF regression
  there would be visible but not fail the run.
- **Concurrency is tested only where it is claimed.** Double approval and
  overlapping cron ticks are covered; stock allocation is explicitly advisory
  and not a lock, so no test pretends otherwise.
