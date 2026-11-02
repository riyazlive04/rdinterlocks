# Architecture — RD Interlock Bricks Factory OS

A full-stack factory operations system built as a single Next.js application: production,
sales, expenses, tipper logistics, mason/loading/employee wages, a unified cashbook, and
Excel/PDF reporting — plus a machine-to-machine API that ingests leads from an external
call-transcription app.

## 1. Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router), React 18, TypeScript |
| Styling | Tailwind CSS |
| Database | PostgreSQL (Supabase, hosted) via Prisma ORM |
| Mutations | Server Actions (`"use server"`), no separate REST layer for the UI |
| Human auth | JWT session cookie (`jose`), password hashed with `bcryptjs` |
| Machine auth | Static API keys for `/api/v1/*` (separate from human sessions) |
| Validation | Zod schemas at every Server Action / route boundary |
| Exports | `exceljs` (.xlsx) and `pdfkit` (PDF letterhead) |
| Deploy target | Vercel (serverless) + Supabase Postgres |

No client-side state library, no GraphQL, no separate backend service — the Next.js server
*is* the backend. Pages are React Server Components that query Prisma directly; interactivity
is layered on with small client components (`"use client"`) plus Server Actions for writes.

## 2. Request flow

```
Browser
  │
  ├─ GET page ─────────────► Server Component ──► prisma.* ──► Postgres (Supabase)
  │                             (reads session via cookie, renders HTML)
  │
  ├─ form submit ──────────► Server Action ("use server")
  │                             validate (zod) → prisma write(s) → revalidatePath → redirect
  │
  ├─ GET /api/export ──────► Route Handler ──► lib/reports.ts ──► exceljs / pdfkit stream
  │                             (session cookie auth)
  │
  └─ POST /api/v1/leads/import ─► Route Handler
                                    (API-key auth, rate limit, zod-free tolerant parsing)
                                    ──► lib/leads-import.ts ──► prisma upsert + audit row
```

Two independent auth boundaries exist side by side:

- **Human sessions** — `rd_session` JWT cookie, checked by [`src/middleware.ts`](src/middleware.ts)
  on every non-API page request (edge runtime) and again by [`src/lib/auth.ts`](src/lib/auth.ts)
  `requireSession()` / `requireArea()` / `requireAdmin()` inside pages and Server Actions.
- **API keys** — `/api/v1/*` routes use [`src/lib/api-auth.ts`](src/lib/api-auth.ts), which
  reads `INTEGRATION_API_KEYS` from the environment and compares presented credentials with
  constant-time hashing. Deliberately fails **closed** if no keys are configured (unlike the
  page middleware, which fails open to avoid locking the owner out of the UI).

## 3. Directory layout

```
prisma/schema.prisma          full data model (30+ tables), see §5
prisma/seed.ts                wipes + reseeds sample data (npm run db:seed)

src/middleware.ts              edge auth gate for all app pages

src/app/
  layout.tsx                   root layout
  login/, logout/               unauthenticated auth pages
  (app)/                       route group — everything behind the session gate
    layout.tsx                  sidebar + bottom-nav + top-bar shell, reads session once
    page.tsx                    dashboard
    production/, day/, leads/, clients/, deliveries/, tipper/,
    mason/, loading/, expense/, employees/, leave/, payroll/,
    cash/, reports/, vehicles/, tasks/, settings/, guide/
                                one folder per operational module — each has
                                page.tsx (list/read), actions.ts (Server Actions),
                                new/ and [id]/edit/ subfolders for forms
  api/
    export/route.ts             Excel/PDF report generation (session-cookie auth)
    login/route.ts               sets the session cookie on successful login
    v1/leads/route.ts            read-only lead listing (integration API)
    v1/leads/import/route.ts     lead ingestion (integration API, see §7)

src/components/                shared UI: sidebar, bottom-nav, top-bar, master-list
                                 (generic CRUD table), ledger (report table), icons,
                                 nav-config.ts (drives both sidebar and bottom nav)

src/lib/
  db.ts                         Prisma client singleton
  auth.ts                       session sign/verify/require, login
  access.ts                     ACCESS_AREAS + can()/isAdmin() — permission model
  api-auth.ts                   API-key auth for /api/v1
  rate-limit.ts                 in-memory fixed-window limiter for /api/v1
  leads-import.ts / leads.ts / lead-convert.ts
                                 lead ingestion, display helpers, lead→client conversion
  reports.ts                    report-query engine behind /reports and /api/export
  stock.ts                      brick curing-stage derivation
  distribute.ts                 exact-sum integer splitting (wages, brick counts)
  format.ts                     date/currency formatting helpers

_design-reference/             static HTML/JSX prototype, kept for visual reference only
```

Every operational module under `src/app/(app)/` follows the same shape: a Server Component
`page.tsx` for the list/detail view, an `actions.ts` with `"use server"` mutations, and
`new/`/`[id]/edit/` routes for forms. This repetition is intentional — each module owns its
data and its own auth check rather than sharing a generic CRUD abstraction.

## 4. Auth & access control

- **Session**: `SignJWT`/`jwtVerify` (HS256) with a 30-day cookie. `SESSION_SECRET_OLD` is
  accepted alongside `SESSION_SECRET` so secrets can be rotated without invalidating live
  sessions. The edge `middleware.ts` never deletes the cookie on a failed check — a redirect
  to `/login` only — to avoid a background RSC prefetch wiping a still-valid session.
- **Roles**: `admin`/`owner` (full access) vs. everyone else, gated per-area by a
  `permissions: string[]` on `User` ([`src/lib/access.ts`](src/lib/access.ts)). Areas map
  1:1 to nav items (`production`, `sales`, `payroll`, `cash`, …), plus a special `revenue`
  area that gates money totals independent of page access.
- **Navigation is permission-driven**: [`nav-config.ts`](src/components/nav-config.ts)
  defines the full nav list once; `visibleNav()` filters it per-request against the current
  session so the sidebar, bottom nav, and route access always agree.

## 5. Data model (`prisma/schema.prisma`)

Organized into six domains, all foreign-keyed off a small set of master-data tables an
admin manages in Settings (`BrickSize`, `ConstructionType`, `BrickPrice` matrix, `Material`,
`ExpenseCategory`, `Machine`).

| Domain | Key models |
|---|---|
| Auth | `User`, `Task` |
| Master data | `Settings` (factory-wide config/thresholds), `BrickSize`, `ConstructionType`, `BrickPrice`, `Material`, `MaterialRecipe`, `MaterialStock`, `ExpenseCategory`, `Machine`, `SlabSize` |
| People | `Operator`, `Mason`, `Loader`, `Employee`, `Vendor`, `Tipper`, `Client` |
| Operations | `ProductionEntry` + `ProductionShare`, `StockBatch`, `Expense`, `TipperLoad`, `MasonWork`, `LoadingWork` + `LoadingCharge` |
| Sales | `Order` → `OrderItem`/`OrderSlabItem` → `Delivery` → `DeliveryItem`/`DeliveryAddOn`/`DeliveryReturn`, `ClientPayment` |
| Payroll | `EmployeeAttendance`, `EmployeePayout`, `WorkerPayout` (generic, any worker type), `Leave`, `Advance` |
| Leads | `Lead`, `LeadImport` (append-only audit) |
| Cashbook | `CashEntry` |

Notable design patterns baked into the schema:

- **Auto-computed, frozen totals.** `ProductionEntry.totalWage`, `MasonWork.totalAmount`,
  etc. are calculated at write time and stored, not derived on read — so historical rows
  don't drift if a price matrix later changes.
- **Exact-sum splitting.** When a production entry or wage is shared across N people,
  [`distribute.ts`](src/lib/distribute.ts) (`distributeInt`) splits the total so shares sum
  exactly to the original (floor/ceil distribution), never losing or inventing a rupee/brick
  to rounding.
- **Age-derived curing pipeline.** A `StockBatch` doesn't need a background job to advance
  its stage — [`stock.ts`](src/lib/stock.ts) `stageForAge()` derives
  `produced → drying → curing → ready` purely from `producedAt` and the admin-configured
  `dryingDays`/`curingDays` thresholds in `Settings`.
- **Unified cashbook via optional back-references.** `CashEntry` is the single ledger.
  Domain rows that move cash (`Expense`, `TipperLoad`, `Advance`, `ClientPayment`,
  `EmployeePayout`, `WorkerPayout`, `LoadingCharge`) each hold an optional
  `cashEntryId @unique`, so every auto-posted cash movement traces back to the operational
  record that caused it, while manual entries can still be added directly.
  `WorkerPayout` deliberately generalizes `EmployeePayout` to cover operators/masons/loaders
  too, so Payroll can settle anyone from one screen.
- **Material stock auto-reconciliation.** `MaterialRecipe` defines qty-per-basis (e.g. per
  1000 bricks) for each brick size; production entries decrement `MaterialStock` by recipe ×
  (brickCount / basis), and edits/deletes reverse the old consumption before applying the new
  one (see `production/actions.ts`).
- **Grouped multi-row transactions.** `LoadingWork`/`TipperLoad`/`LoadingCharge` share a
  `loadGroupId` so one physical delivery trip — which can span multiple workers, a tipper
  leg, and add-on charges — is edited/deleted as a unit.

## 6. Leads pipeline (external integration)

An outside call-transcription app ("the Transcriber") posts extracted leads to
`POST /api/v1/leads/import`. This is the one place the system accepts writes from outside
its own UI, so it's built defensively:

- **Idempotency key is `contactKey`, not `callId`.** One phone contact calling multiple
  times becomes one `Lead` row with an incrementing `callSequence`, not duplicate leads.
  Re-posting the same `callId` updates without bumping the sequence (retry-safe); a new
  `callId` under the same contact counts as a genuine follow-up (`isFollowUp: true`).
- **Tolerant parsing.** Field names are matched case/separator-insensitively with common
  aliases; money strings (`"₹1,20,000"`, `"2 lakh"`) and day-first dates parse leniently.
  Only `contactKey` is required — everything else missing is stored as `""`/`null` and
  echoed back in `missingFields` rather than rejecting the request.
- **Forward-compatible.** Unmodeled fields are kept in `Lead.extra` (JSON) instead of being
  dropped, so the Transcriber can ship a new field before this app has a column for it.
- **Merge, not overwrite, on re-import**, unless `?mode=replace` is passed — a later thinner
  extraction can't blank out previously-captured data.
- **Locked after conversion.** Once [`lead-convert.ts`](src/lib/lead-convert.ts)
  `convertLeadCore()` turns a lead into a real `Client` (+ optionally its first `Order`, all
  in one transaction with an optimistic `updateMany` guard against a concurrent double
  conversion), further imports for that lead are refused with `409` instead of silently
  overwriting office-actioned data.
- **Full audit trail.** Every request — including rejected/malformed ones — is written to
  `LeadImport` with the verbatim payload, outcome, status code, and which API-key label was
  used, so any accepted or refused write can be traced or replayed.

Protected by [`rate-limit.ts`](src/lib/rate-limit.ts): per-key, per-IP, and a brute-force
cutoff on repeated auth failures. The limiter is explicitly documented as per-server-instance
(not distributed) — adequate for stopping a stuck retry loop on Vercel, with a drop-in swap
to Redis/Upstash `INCR` noted for a hard distributed guarantee.

## 7. Reports & export

[`lib/reports.ts`](src/lib/reports.ts) is a single query engine (`getReportData`) shared by
both the in-app `/reports` page and `GET /api/export`. It returns a uniform `LedgerData`
shape (title, columns, date-grouped sections with subtotals, optional nested child rows) for
each of eight report kinds (production, sales, expense, tipper, mason, loading, wages,
cashbook). The UI renders that shape as an on-screen ledger
([`components/ledger.tsx`](src/components/ledger.tsx)); the export route
([`api/export/route.ts`](src/app/api/export/route.ts)) flattens the same shape into an
`.xlsx` workbook (ExcelJS, with the factory logo) or a PDF letterhead (pdfkit) — one query,
two renderers, so the on-screen report and the downloaded file can never disagree.

## 8. Deployment

Vercel-hosted, Supabase-hosted Postgres. Two connection strings are required:
`DATABASE_URL` (transaction pooler, `pgbouncer=true`, used at runtime) and `DIRECT_URL`
(direct connection, used by `prisma db push` / seeding). Schema changes are applied with
`prisma db push` — **there are no migration files**; every push should be treated as a
direct, irreversible change against the live database (see project memory: treat this as a
production database that requires per-instance confirmation before any schema push that
could drop data).

No ORM migrations, no queue, no background workers, no separate API service — the entire
system is one Next.js deployment plus one Postgres instance.
