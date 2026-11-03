-- Links a Delivery back to the loading entry that created it, so the two are
-- edited and deleted together. Additive and re-runnable; no DROP anywhere.
--
-- Stop the app first — ADD COLUMN needs an exclusive lock, and a connection
-- sitting idle in a transaction will make it time out.
--
-- Run: npx prisma db execute --schema prisma/schema.prisma --file prisma/sql/2026-08-03-delivery-loadgroup.sql

SET statement_timeout = '300s';
SET lock_timeout = '30s';

ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "loadGroupId" TEXT;
CREATE INDEX IF NOT EXISTS "Delivery_loadGroupId_idx" ON "Delivery"("loadGroupId");
