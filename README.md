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

## Eight operational modules

| Module | What it tracks |
|---|---|
| **Daily Production** | Bricks made per day with operators, cement bags used, piece-rate split |
| **Expense** | Open category list (Cement, Diesel, EB, Mould, etc.) — admin extensible |
| **Tipper** | Own RD trucks (income from rent + EMI) and vendor (AVM) trucks (rent paid) |
| **Mason** | Site-by-site brick laying with rates from the size × construction-type matrix |
| **Loading** | Piece-rate truck loading wages |
| **Clients & Sales** | Client → Order → multi-Delivery → Payments + add-ons + returns + balance |
| **Employees** | Drivers/watchmen/staff — daily or monthly pay, attendance, advances, payouts |
| **Cashbook** | Unified ledger — auto-pulls from operations, plus manual entries |

## Reports (single page)

- 8 tabs: Production · Sales · Expense · Tipper · Mason · Loading · Wages · Cashbook
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

## Database commands

```bash
npm run db:push      # apply schema.prisma to Supabase
npm run db:seed      # wipe + reseed sample data
npm run db:studio    # open Prisma Studio (browse/edit data)
```

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
