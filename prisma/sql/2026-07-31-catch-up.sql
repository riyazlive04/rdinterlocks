-- Catch the live database up to prisma/schema.prisma — ADDITIVELY.
--
-- Why this exists instead of `prisma db push`:
--
--   The live Lead table carries five columns this repo does not model yet
--   (phoneNumber, phoneMasked, contactKey, callSequence, isFollowUp) with 153
--   rows of data behind them, written by the Transcriber side. A push would
--   drop all five. This file therefore contains no DROP of any kind — only
--   CREATE TABLE, ADD COLUMN, CREATE INDEX and ADD CONSTRAINT, every one of
--   them guarded so the script can be re-run safely.
--
--   The live database was also behind the repo by two releases, so this covers
--   the loading-charge work and the tasks work as well as the new dies / AVM
--   tables.
--
-- Run: npx prisma db execute --schema prisma/schema.prisma --file prisma/sql/2026-07-31-catch-up.sql
-- Then: npm run db:upgrade

-- ── Tasks ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Task" (
    "id"           TEXT NOT NULL,
    "title"        TEXT NOT NULL,
    "details"      TEXT,
    "assignedToId" TEXT NOT NULL,
    "createdById"  TEXT,
    "dueDate"      TIMESTAMP(3),
    "status"       TEXT NOT NULL DEFAULT 'wip',
    "statusReason" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"  TIMESTAMP(3),
    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Task_assignedToId_idx" ON "Task"("assignedToId");
CREATE INDEX IF NOT EXISTS "Task_status_idx" ON "Task"("status");

-- ── Loading: lintel loads, tipper link, load grouping ─────────────────
ALTER TABLE "LoadingWork" ADD COLUMN IF NOT EXISTS "loadType"    TEXT NOT NULL DEFAULT 'brick';
ALTER TABLE "LoadingWork" ADD COLUMN IF NOT EXISTS "loadGroupId" TEXT;
ALTER TABLE "LoadingWork" ADD COLUMN IF NOT EXISTS "tipperId"    TEXT;
CREATE INDEX IF NOT EXISTS "LoadingWork_loadGroupId_idx" ON "LoadingWork"("loadGroupId");

ALTER TABLE "TipperLoad" ADD COLUMN IF NOT EXISTS "loadGroupId" TEXT;

CREATE TABLE IF NOT EXISTS "LoadingCharge" (
    "id"          TEXT NOT NULL,
    "loadGroupId" TEXT NOT NULL,
    "date"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId"    TEXT,
    "name"        TEXT NOT NULL,
    "direction"   TEXT NOT NULL DEFAULT 'in',
    "quantity"    DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit"        TEXT NOT NULL DEFAULT 'unit',
    "amount"      DOUBLE PRECISION NOT NULL,
    "vendorId"    TEXT,
    "cashEntryId" TEXT,
    CONSTRAINT "LoadingCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LoadingCharge_cashEntryId_key" ON "LoadingCharge"("cashEntryId");
CREATE INDEX IF NOT EXISTS "LoadingCharge_loadGroupId_idx" ON "LoadingCharge"("loadGroupId");

-- ── Materials: recipe basis ───────────────────────────────────────────
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "materialBasis" INTEGER NOT NULL DEFAULT 1000;

-- ── Die (mould) tracking ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Die" (
    "id"          TEXT NOT NULL,
    "code"        TEXT NOT NULL,
    "brickSizeId" TEXT,
    "cost"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendorId"    TEXT,
    "notes"       TEXT,
    "expenseId"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Die_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Die_code_key" ON "Die"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "Die_expenseId_key" ON "Die"("expenseId");
CREATE INDEX IF NOT EXISTS "Die_purchasedAt_idx" ON "Die"("purchasedAt");

CREATE TABLE IF NOT EXISTS "DieUsage" (
    "id"        TEXT NOT NULL,
    "dieId"     TEXT NOT NULL,
    "side"      INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt"   TIMESTAMP(3),
    "notes"     TEXT,
    CONSTRAINT "DieUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DieUsage_dieId_side_key" ON "DieUsage"("dieId", "side");
CREATE INDEX IF NOT EXISTS "DieUsage_startedAt_idx" ON "DieUsage"("startedAt");

-- ── Vendor money: AVM advance + rent balance ──────────────────────────
CREATE TABLE IF NOT EXISTS "VendorPayment" (
    "id"          TEXT NOT NULL,
    "date"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendorId"    TEXT NOT NULL,
    "tipperId"    TEXT,
    "kind"        TEXT NOT NULL DEFAULT 'advance',
    "amount"      DOUBLE PRECISION NOT NULL,
    "method"      TEXT NOT NULL DEFAULT 'cash',
    "notes"       TEXT,
    "cashEntryId" TEXT,
    CONSTRAINT "VendorPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VendorPayment_cashEntryId_key" ON "VendorPayment"("cashEntryId");
CREATE INDEX IF NOT EXISTS "VendorPayment_date_idx" ON "VendorPayment"("date");
CREATE INDEX IF NOT EXISTS "VendorPayment_vendorId_idx" ON "VendorPayment"("vendorId");

-- ── Expense: link back to the loading trip that booked it ─────────────
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "loadGroupId" TEXT;
CREATE INDEX IF NOT EXISTS "Expense_loadGroupId_idx" ON "Expense"("loadGroupId");

-- New rows land on the new vocabulary; db:upgrade moves the existing ones.
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'active';

-- ── Foreign keys, added once every table above exists ─────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Task_assignedToId_fkey') THEN
        ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey"
            FOREIGN KEY ("assignedToId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Task_createdById_fkey') THEN
        ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey"
            FOREIGN KEY ("createdById") REFERENCES "User"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoadingWork_tipperId_fkey') THEN
        ALTER TABLE "LoadingWork" ADD CONSTRAINT "LoadingWork_tipperId_fkey"
            FOREIGN KEY ("tipperId") REFERENCES "Tipper"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoadingCharge_clientId_fkey') THEN
        ALTER TABLE "LoadingCharge" ADD CONSTRAINT "LoadingCharge_clientId_fkey"
            FOREIGN KEY ("clientId") REFERENCES "Client"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoadingCharge_vendorId_fkey') THEN
        ALTER TABLE "LoadingCharge" ADD CONSTRAINT "LoadingCharge_vendorId_fkey"
            FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoadingCharge_cashEntryId_fkey') THEN
        ALTER TABLE "LoadingCharge" ADD CONSTRAINT "LoadingCharge_cashEntryId_fkey"
            FOREIGN KEY ("cashEntryId") REFERENCES "CashEntry"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Die_brickSizeId_fkey') THEN
        ALTER TABLE "Die" ADD CONSTRAINT "Die_brickSizeId_fkey"
            FOREIGN KEY ("brickSizeId") REFERENCES "BrickSize"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Die_vendorId_fkey') THEN
        ALTER TABLE "Die" ADD CONSTRAINT "Die_vendorId_fkey"
            FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DieUsage_dieId_fkey') THEN
        ALTER TABLE "DieUsage" ADD CONSTRAINT "DieUsage_dieId_fkey"
            FOREIGN KEY ("dieId") REFERENCES "Die"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VendorPayment_vendorId_fkey') THEN
        ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_vendorId_fkey"
            FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VendorPayment_tipperId_fkey') THEN
        ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_tipperId_fkey"
            FOREIGN KEY ("tipperId") REFERENCES "Tipper"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VendorPayment_cashEntryId_fkey') THEN
        ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_cashEntryId_fkey"
            FOREIGN KEY ("cashEntryId") REFERENCES "CashEntry"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
