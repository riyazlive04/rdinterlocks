/**
 * Snapshot a database's shape and size, for before/after comparison across a
 * schema push.
 *
 * Why this exists rather than `pg_dump -s`: pg_dump refuses to run against a
 * server newer than itself, and the managed database's version is not ours to
 * choose. This reads information_schema instead, which works on any version
 * and — more usefully — produces a diffable text file, so "nothing was lost"
 * is a `diff` rather than a judgement.
 *
 * READ-ONLY. It issues SELECTs and nothing else.
 *
 *   npx tsx scripts/db-snapshot.ts before.txt
 *   # ...push...
 *   npx tsx scripts/db-snapshot.ts after.txt
 *   diff before.txt after.txt
 */

import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: npx tsx scripts/db-snapshot.ts <output-file>");
    process.exit(1);
  }

  const columns = await prisma.$queryRaw<
    Array<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>
  >`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, column_name
  `;

  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;

  const lines: string[] = [];
  lines.push(`TABLES: ${tables.length}`);
  lines.push(`COLUMNS: ${columns.length}`);
  lines.push("");

  // Row counts matter more than anything else here: a schema change that
  // silently emptied a table is the failure this file exists to catch.
  lines.push("=== ROW COUNTS ===");
  for (const t of tables) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM "${t.table_name}"`
    );
    lines.push(`${t.table_name} = ${rows[0].n}`);
  }

  lines.push("");
  lines.push("=== COLUMNS ===");
  for (const c of columns) {
    lines.push(
      `${c.table_name}.${c.column_name} ${c.data_type} ` +
        `${c.is_nullable === "YES" ? "NULL" : "NOT NULL"} default=${c.column_default ?? "-"}`
    );
  }

  writeFileSync(out, lines.join("\n") + "\n", "utf8");
  console.log(`${tables.length} tables, ${columns.length} columns -> ${out}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
