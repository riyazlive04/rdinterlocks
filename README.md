# RD Interlock Bricks — Factory OS

Full-stack factory operations system: production, sales, expenses, tipper logistics, mason wages, loading wages, employee salary, unified cashbook, and one-page reports with Excel + PDF export.

## Stack

- **Next.js 15** (App Router) + **TypeScript** + **Tailwind CSS**
- **Prisma + Supabase Postgres** (hosted, free tier)
- **Server Actions** for mutations, **JWT cookies** for auth
- **ExcelJS** for `.xlsx` exports, **pdfkit** for PDF letterheads
- **Mobile-first** with bottom nav + responsive sidebar on desktop

## Run locally

1. Copy `.env.example` to `.env` and fill in Supabase URLs (transaction-pooler + session-pooler).
2. Install deps and push schema:
   ```bash
   npm install
   npx prisma db push
   npm run db:seed
   npm run dev
   ```
3. Open http://localhost:3000 and sign in with **Admin / Admin@123**.

## Brand assets

The default `/public/logo.svg` is a placeholder. Drop your real PNG at `/public/logo.png` and it will be used on PDF letterhead automatically.

## Operational modules

| Module | What it tracks |
|---|---|
| **Daily Production** | Bricks made per day with operators, cement bags used, piece-rate split |
| **Expense** | Open category list (Cement, Diesel, EB, Mould, Interest, Debt, Tipper Due…) — admin extensible |
| **Tipper** | Own RD trucks (income from rent + EMI) and vendor (AVM) trucks (rent paid) |
| **AVM advance & rent** | Per vendor: rent charged by their trips, advance paid, balance settled, still due |
| **Dies (moulds)** | Every die, both its faces (side 1 → side 2), purchase cost and ₹ per 1000 bricks |
| **Mason** | Site-by-site brick laying with rates from the size × construction-type matrix |
| **Loading** | Piece-rate loading wages — several brick sizes on one trip, in one entry |
| **Sales register** | The paper book as one screen: one wide row per order |
| **Clients & Sales** | Client → Order → multi-Delivery → Payments + add-ons + returns + balance |
| **Employees** | Drivers/watchmen/staff — daily or monthly pay, attendance, advances, payouts |
| **Tasks** | Admin assigns work; the assignee marks it in progress, completed, or not completed (with a reason) |
| **Cashbook** | Unified ledger — auto-pulls from operations, plus manual entries |

### Sales register

`/clients/register` mirrors the office's notebook — date, number, name, location,
brick size, room/compound, rate, total bricks, total amount, advance, balance, note —
as a single wide table with a one-line entry form. Saving a row creates (or reuses)
the client, opens the order and books the advance in one go, so nothing has to be
entered twice. Orders sit in one of three states, filterable from the tabs and
changeable by tapping the chip:

- **Upcoming** — nothing delivered yet and the delivery date is still ahead
- **Active** — partly delivered, or due now / overdue
- **Completed** — everything ordered has gone out

### Transport accounting

A loading entry takes the shifting charge **once** and books the right entries itself:

- **Own RD tipper** — income on the tipper (real cash in) *and* the same amount as a
  transport expense against that tipper. The expense side is internal, so the cash book
  still shows only the payment that really happened.
- **Rented (AVM) tipper** — an expense only, recorded as a payable. Cash moves when the
  advance or the rent balance is entered on the AVM page, so no rupee is counted twice.

The **Tipper P&L** report puts rent earned against rent paid and running costs
(diesel, oil, spares, EMI) per truck. Those internal loading expenses are excluded
from the cost side — they carry a `loadGroupId`, which is how they're told apart.

## Reports (single page)

- Tabs: Summary · Production · Sales · Expense · Tipper · **Tipper P&L** · **AVM advance & rent** ·
  **Dies** · Mason · Loading · Salary (detail) · **Salary weekly / monthly** · Cashbook
- **Salary weekly / monthly** rolls every worker up per week or per month — earned,
  advance taken, salary paid, still due — which is the sheet wages are settled from
- Date range presets + custom from–to
- Filters by client / brick size / category / vendor / tipper as relevant
- One-click **Excel** (`.xlsx`) and **PDF** download with logo letterhead

## Settings (admin master data)

Everything that varies sits in Settings — admin can add or change any of:

- Factory profile (name, address, phone, GST, opening cash, cement-bag-per-1000-bricks recipe)
- Brick sizes (6", 6"H, 8" — extensible)
- Construction types (Room, Compound, Godown — extensible)
- Price matrix: sell price + mason rate + production cost per size × type
- Expense categories (extensible)
- Raw materials (cement, flyash, powder…)
- Operators / Masons / Loaders / Employees
- Vendors (e.g. AVM) and Tippers (own + vendor)
- Security (change password)

## Integration API — lead import

`POST /api/v1/leads/import` receives one structured lead extracted from a recorded
call by the Transcriber app.

**Auth.** Set `INTEGRATION_API_KEYS` in the environment (see `.env.example`), then send
either header:

```
Authorization: Bearer <key>
X-API-Key: <key>
```

Keys are a comma-separated `label:key` list; the label is written to the audit log so a
credential can be traced and revoked. Listing two keys is how you rotate without downtime.

**Request.**

```bash
curl -X POST https://<host>/api/v1/leads/import \
  -H "Authorization: Bearer $INTEGRATION_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "callId": "CALL-9001",
    "customerName": "Ravi Kumar",
    "place": "Salem",
    "typeOfBricks": "6\"",
    "numberOfBricks": 12000,
    "typeOfConstruction": "Compound wall",
    "costPerBrick": 32,
    "totalBudget": "3.84 lakh",
    "notes": "Wants delivery before Deepavali",
    "followUpDate": "05/08/2026",
    "quotationStage": "quote sent"
  }'
```

Field names are matched case- and separator-insensitively, so `customerName`,
`customer_name` and `Customer Name` are all the same field. Common aliases are accepted
too (`location` → place, `qty` → numberOfBricks, `rate` → costPerBrick). Values may be
messy: `"₹1,20,000"`, `"2 lakh"` and `12000` all parse, and `05/08/2026` is read
day-first.

**Responses.**

| Code | Meaning |
|---|---|
| `201` | New `callId` — lead created |
| `200` | Known `callId` — lead updated (idempotent re-send) |
| `400` | Body isn't valid JSON / isn't an object / has no `callId` |
| `401` | Missing or invalid API key |
| `409` | Lead already converted to a client — import refused, no overwrite |
| `413` | Body over 1 MB |
| `429` | Rate limit exceeded — see `Retry-After` |
| `500` | Server error; retry with the same `callId` |

```json
{
  "ok": true, "apiVersion": "v1", "requestId": "…", "outcome": "created",
  "lead": { "id": "…", "callId": "CALL-9001", "…": "…" },
  "missingFields": ["followUpDate"],
  "warnings": [],
  "extraFields": ["phone", "recordingUrl"]
}
```

**Behaviour worth knowing.**

- **Partial data is accepted.** Only `callId` is required — it is the idempotency key.
  Any other missing field is stored as `""` (text) or `null` (number/date) and listed
  back in `missingFields`. The request is never rejected for incompleteness.
- **Re-imports merge.** A field is overwritten only when the new payload has a non-empty
  value for it, so a later thinner extraction can't blank out good data. Add
  `?mode=replace` to overwrite unconditionally.
- **Unknown fields survive.** Anything not modelled yet is kept in the lead's `extra`
  JSON, so the Transcriber can start sending a new field before this app understands it.
  Adding a field is never a breaking change; anything that *would* break a caller ships
  as `/api/v2/…` instead.
- **Every request is audited.** The verbatim body, outcome, status code and key label go
  into `LeadImport` — including rejected and malformed ones. Throttled requests are the
  one exception: auditing them would let a flood fill the very table used to investigate it.
- **Rate limited.** Defaults: 60 requests/min per API key, 120/min per IP, and 10 failed
  auth attempts per IP per 15 min before that source is cut off. All three are tunable via
  env vars (see `.env.example`). Every response carries `X-RateLimit-*`; a 429 adds
  `Retry-After`. A valid key is never blocked by another caller's failed attempts.

  Counters are held per server instance, so on Vercel's serverless functions the effective
  ceiling is roughly `limit × live instances` — enough to stop a stuck retry loop, but not
  a hard distributed guarantee. For that, swap the two functions in `src/lib/rate-limit.ts`
  for a Redis/Upstash `INCR`; nothing else needs to change.

## Database commands

```bash
npm run db:push      # apply schema.prisma to Supabase
npm run db:upgrade   # idempotent catch-up on a LIVE db (see below)
npm run db:seed      # wipe + reseed sample data
npm run db:studio    # open Prisma Studio (browse/edit data)
```

### Upgrading a live database

`db:seed` wipes everything, so it is only for a fresh install. On a database with
real data, run `db:push` then **`db:upgrade`** — it adds any missing expense
category, moves old order statuses (`open`/`partial`/`complete`) onto
`upcoming`/`active`/`completed`, and moves old task statuses (`open`) onto `wip`.
It touches nothing else and is safe to run repeatedly.

## Project layout

- `prisma/schema.prisma` — full data model (30+ tables)
- `src/app/(app)/` — authenticated module pages
- `src/app/login/` + `src/app/logout/` — auth
- `src/app/api/export/` — Excel + PDF generation
- `src/components/` — shared UI (sidebar, bottom-nav, master-list, brand mark, icons)
- `src/lib/` — db client, auth, format helpers, report queries
- `_design-reference/` — original HTML/JSX prototype (kept for visual reference)

## Production deploy

The app is Vercel-ready. Add the same `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, and `DEFAULT_PASSWORD` env vars in your Vercel project settings; for Vercel/serverless lower `connection_limit` from `10` back to `1` in the runtime URL.
