/**
 * Does the database still have everything the app expects?
 *
 * Twice now, tables and columns this release added have vanished from the live
 * database — the pages that use them answer 500 and the first anyone knows is a
 * customer-facing error. `prisma db push` from a checkout that predates a
 * release will do it: push makes the database match that schema exactly, so
 * anything the older schema doesn't mention is dropped.
 *
 * This checks the pieces that have actually gone missing before, and names the
 * fix. Run it after any deploy, or any time a page 500s.
 *
 *   npm run db:check
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TABLES = ["Die", "DieUsage", "VendorPayment", "Task", "LoadingCharge", "Delivery"];
const COLUMNS: Array<[string, string]> = [
  ["Expense", "loadGroupId"],
  ["Task", "statusReason"],
  ["Delivery", "loadGroupId"],
  ["LoadingWork", "loadGroupId"],
  ["LoadingWork", "loadType"],
  ["LoadingWork", "tipperId"],
  ["TipperLoad", "loadGroupId"],
  ["Settings", "materialBasis"],
];

async function main() {
  const tables = new Set(
    (
      await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
        `select table_name from information_schema.tables where table_schema = 'public'`
      )
    ).map((r) => r.table_name)
  );
  const cols = new Set(
    (
      await prisma.$queryRawUnsafe<Array<{ k: string }>>(
        `select table_name || '.' || column_name as k from information_schema.columns where table_schema = 'public'`
      )
    ).map((r) => r.k)
  );

  const missingTables = TABLES.filter((t) => !tables.has(t));
  const missingCols = COLUMNS.filter(([t, c]) => tables.has(t) && !cols.has(`${t}.${c}`));

  for (const t of TABLES) console.log(`  ${tables.has(t) ? "ok     " : "MISSING"}  table  ${t}`);
  for (const [t, c] of COLUMNS) {
    console.log(`  ${cols.has(`${t}.${c}`) ? "ok     " : "MISSING"}  column ${t}.${c}`);
  }

  if (missingTables.length === 0 && missingCols.length === 0) {
    console.log("\nSchema is complete.");
    return;
  }
  console.error(
    `\n${missingTables.length} table(s) and ${missingCols.length} column(s) are missing.\n` +
      `Almost certainly a 'prisma db push' from a checkout older than this release.\n\n` +
      `Fix (additive, safe to re-run, stop the app first):\n` +
      `  npx prisma db execute --schema prisma/schema.prisma --file prisma/sql/2026-07-31-catch-up.sql\n` +
      `  npx prisma db execute --schema prisma/schema.prisma --file prisma/sql/2026-08-03-delivery-loadgroup.sql\n` +
      `  npm run db:upgrade\n`
  );
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
