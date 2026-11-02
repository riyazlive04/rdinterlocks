/**
 * Pulls Meta Lead Ads submissions from the upstream relay export into this
 * CRM (see src/lib/facebook-feed.ts for why that channel exists).
 *
 * Run (loads .env for DATABASE_URL + the feed credentials):
 *   node --env-file=.env --import tsx scripts/pull-facebook-leads.ts --dry-run
 *   node --env-file=.env --import tsx scripts/pull-facebook-leads.ts --backdate
 *
 * Flags:
 *   --dry-run            Fetch and map only; write nothing. Always do this first.
 *   --backdate           Set a NEWLY created lead's createdAt/stageEnteredAt to
 *                        the customer's real submission time instead of now.
 *   --since=<iso>        Relay cursor; only rows captured after it. Omit for all.
 *   --limit=<n>          Rows per page (relay default 500).
 *   --max-pages=<n>      Stop after n pages. Useful for a small trial run.
 *   --mode=merge|replace How an existing lead's fields are treated (default merge).
 *
 * Safe to re-run: every row carries Meta's leadgen_id, so a second pass
 * updates instead of duplicating, and never re-counts a touchpoint.
 */
import { syncFacebookFeed, type FeedSyncReport } from "../src/lib/facebook-feed";
import { prisma } from "../src/lib/db";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
}

function printReport(label: string, r: FeedSyncReport) {
  console.log(`\n${label}`);
  console.log(`  pages fetched      ${r.pages}`);
  console.log(`  rows fetched       ${r.fetched}`);
  console.log(`  skipped (test)     ${r.skippedTest}`);
  console.log(`  skipped (no phone) ${r.skippedNoPhone}`);
  console.log(`  skipped (no id)    ${r.skippedNoLeadgenId}`);
  console.log(`  created            ${r.created}`);
  console.log(`  updated            ${r.updated}`);
  console.log(`  conflict           ${r.conflict}   (already converted — left untouched)`);
  console.log(`  error              ${r.error}`);
  if (r.backdated) console.log(`  backdated          ${r.backdated}`);
  console.log(`  next --since       ${r.nextSince ?? "(none)"}`);
  console.log(`  requestId          ${r.requestId}`);
}

async function main() {
  const dryRun = flag("dry-run") !== undefined;
  const backdate = flag("backdate") !== undefined;
  const since = flag("since") || undefined;
  const limit = flag("limit");
  const maxPages = flag("max-pages");
  const mode = (flag("mode") || "merge") as "merge" | "replace";

  if (mode !== "merge" && mode !== "replace") {
    throw new Error(`--mode must be "merge" or "replace", got "${mode}"`);
  }

  console.log(
    `Facebook lead feed → CRM  [${dryRun ? "DRY RUN — nothing is written" : "LIVE"}]` +
      `  mode=${mode}${backdate ? " backdate=on" : ""}${since ? ` since=${since}` : ""}`
  );

  let lastLogged = 0;
  const report = await syncFacebookFeed({
    since,
    mode,
    dryRun,
    backdate,
    pageSize: limit ? Number(limit) : undefined,
    maxPages: maxPages ? Number(maxPages) : undefined,
    apiKeyLabel: "facebook-feed:cli",
    onProgress: (done, r) => {
      // One line per 50 rows — enough to see it moving through ~750 rows
      // without burying the final report in scrollback.
      if (done - lastLogged >= 50) {
        lastLogged = done;
        console.log(`  … ${done} rows  (created ${r.created}, updated ${r.updated}, error ${r.error})`);
      }
    },
  });

  printReport(dryRun ? "DRY RUN — would have:" : "Done:", report);
  if (dryRun) console.log("\nRe-run without --dry-run to apply.");
}

main()
  .catch((e) => {
    console.error("\nFailed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
