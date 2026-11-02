import { PrismaClient } from "@prisma/client";
import { LEAD_STAGE_DEFS } from "./lead-stage-defs";

// One-off backfill safe to run against a LIVE database: upserts the five
// canonical LeadStage rows (idempotent — upsert by slug, never deletes),
// then sets stageId/stageEnteredAt on every existing Lead that doesn't have
// one yet, mapped from its current quotationStage string. Touches nothing
// else: no wipe, no destructive step, unrelated to prisma/seed.ts's
// wipe-and-reseed main() (which never runs against production).
//
// stageEnteredAt is backfilled from the lead's createdAt as the best
// available approximation — there's no real per-transition history for
// leads that predate this feature, so "when the lead was created" is a
// closer guess than "now" (which would understate how long it's actually
// been sitting in that stage).
//
// Defaults to a DRY RUN that only prints what it would change.
//
//   npx tsx prisma/backfill-lead-stages.ts            # dry run
//   npx tsx prisma/backfill-lead-stages.ts --apply     # writes

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Backfill lead stages — ${apply ? "APPLY" : "DRY RUN"}\n`);

  const stageBySlug = new Map<string, { id: string; slug: string }>();
  for (const def of LEAD_STAGE_DEFS) {
    if (apply) {
      const stage = await prisma.leadStage.upsert({
        where: { slug: def.slug },
        update: {},
        create: {
          slug: def.slug,
          name: def.name,
          sortOrder: def.sortOrder,
          colour: def.colour,
          isDefault: def.isDefault ?? false,
          isWon: def.isWon ?? false,
          isLost: def.isLost ?? false,
        },
      });
      stageBySlug.set(stage.slug, stage);
    } else {
      const existing = await prisma.leadStage.findUnique({ where: { slug: def.slug } });
      // Even when it doesn't exist yet, register it under a placeholder id so
      // the dry-run's per-slug counts below preview what --apply would do —
      // otherwise every lead reads as "unmatched" on a fresh database purely
      // because the stage rows aren't there YET, not because nothing matches.
      stageBySlug.set(def.slug, existing ?? { id: "(pending)", slug: def.slug });
      console.log(`  LeadStage "${def.slug}" ${existing ? "already exists" : "would be created"}`);
    }
  }

  const unstaged = await prisma.lead.findMany({
    where: { stageId: null },
    select: { id: true, quotationStage: true, createdAt: true },
  });

  const counts: Record<string, number> = {};
  let unmatched = 0;
  for (const lead of unstaged) {
    const stage = stageBySlug.get(lead.quotationStage);
    if (!stage) {
      unmatched++;
      continue;
    }
    counts[stage.slug] = (counts[stage.slug] ?? 0) + 1;
    if (apply) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { stageId: stage.id, stageEnteredAt: lead.createdAt },
      });
    }
  }

  console.log(`\n${unstaged.length} lead(s) without a stageId.`);
  for (const [slug, count] of Object.entries(counts)) {
    console.log(`  ${apply ? "backfilled" : "would backfill"} ${count} -> "${slug}"`);
  }
  if (unmatched > 0) {
    console.log(
      `  ${unmatched} lead(s) have a quotationStage that doesn't match any configured stage — left as stageId: null.`
    );
  }
  if (!apply) {
    console.log("\nDry run only — re-run with --apply to write these changes.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
