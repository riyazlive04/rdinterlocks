#!/usr/bin/env node
/**
 * Refuse to continue unless BOTH database URLs point at a local host.
 *
 * ─── The hole this closes ─────────────────────────────────────────────
 * Every suite in scripts/e2e guards on DATABASE_URL. But `prisma db push`
 * and `prisma migrate` connect through **directUrl**, not url — and `.env`
 * supplies DIRECT_URL pointing at the live Supabase database. So overriding
 * DATABASE_URL alone and running a push looks safe, passes every existing
 * guard, and writes the schema change to production:
 *
 *   DATABASE_URL=postgres://...@127.0.0.1:55432/rditest npm run test:seed
 *   #            ^ local                    DIRECT_URL ^ still production
 *
 * And test:seed runs prisma/seed.ts, which truncates 34 tables.
 *
 * Prisma does not override an environment variable that is already set, so
 * the fix is to require both to be set AND local, rather than to rely on
 * whoever runs it remembering the second one.
 *
 * Used by `npm run test:seed`. Override with ALLOW_REMOTE_DB_PUSH=yes only
 * for a database you are willing to have rebuilt.
 */

const LOCAL = /^(localhost|127\.0\.0\.1|::1|0\.0\.0\.0|host\.docker\.internal|postgres)$/i;

function hostOf(raw) {
  try {
    // The postgres: scheme parses fine as a URL; the password may contain
    // characters that do not, hence the try.
    return new URL(raw).hostname;
  } catch {
    const m = /@([^:/?]+)/.exec(raw);
    return m ? m[1] : "";
  }
}

const redact = (raw) => raw.replace(/:[^:@/]*@/, ":***@");

const problems = [];
for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
  const raw = process.env[name] ?? "";
  if (!raw) {
    problems.push(`${name} is not set`);
    continue;
  }
  const host = hostOf(raw);
  if (!LOCAL.test(host)) {
    problems.push(`${name} points at "${host}" — ${redact(raw)}`);
  }
}

if (problems.length === 0) process.exit(0);

if (process.env.ALLOW_REMOTE_DB_PUSH === "yes") {
  console.warn("WARNING: non-local database accepted via ALLOW_REMOTE_DB_PUSH=yes");
  for (const p of problems) console.warn(`  - ${p}`);
  process.exit(0);
}

console.error(
  "REFUSING TO REBUILD THIS DATABASE.\n\n" +
    problems.map((p) => `  - ${p}`).join("\n") +
    "\n\nThis task pushes the schema and runs the seed, which truncates 34\n" +
    "tables. BOTH urls must be local, because `prisma db push` connects\n" +
    "through DIRECT_URL — setting DATABASE_URL alone leaves the push aimed\n" +
    "at whatever .env says, which is the live database.\n\n" +
    "  export DATABASE_URL=postgres://rditest:rditest@127.0.0.1:55432/rditest\n" +
    "  export DIRECT_URL=$DATABASE_URL\n\n" +
    "Set ALLOW_REMOTE_DB_PUSH=yes only for a database you are willing to\n" +
    "have rebuilt from scratch."
);
process.exit(2);
