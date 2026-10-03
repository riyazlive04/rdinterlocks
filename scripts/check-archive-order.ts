/**
 * Asserts the archive walk order derived from Prisma's DMMF is actually safe:
 *
 *  1. Every model in the schema is either archived or deliberately exempt.
 *  2. Every REQUIRED foreign key points at a model that comes EARLIER in the
 *     insert order (so pass 1 of a restore can never violate a constraint).
 *  3. Every OPTIONAL foreign key is listed as a softFk (so it gets nulled on
 *     insert and patched in pass 2) — this is what makes self-references and
 *     mutual references restorable.
 *
 * Run: npx tsx scripts/check-archive-order.ts
 */
import { Prisma } from "@prisma/client";
import { archivePlan } from "../src/lib/archive";

const EXEMPT = new Set(["User", "Settings", "ArchiveBatch"]);

const plan = archivePlan();
const position = new Map(plan.map((p, i) => [p.name, i]));
const problems: string[] = [];

// 1. Coverage
for (const m of Prisma.dmmf.datamodel.models) {
  if (EXEMPT.has(m.name)) continue;
  if (!position.has(m.name)) problems.push(`${m.name} is in the schema but not in the archive plan`);
}

for (const m of Prisma.dmmf.datamodel.models) {
  if (EXEMPT.has(m.name)) continue;
  const self = position.get(m.name);
  if (self === undefined) continue;
  const entry = plan[self];

  const owning = m.fields.filter(
    (f) => f.kind === "object" && (f.relationFromFields?.length ?? 0) > 0
  );

  for (const f of owning) {
    const cols = f.relationFromFields ?? [];
    const required = cols.every((c) => m.fields.find((x) => x.name === c)?.isRequired);

    if (required) {
      // 2. Required FK must resolve to an earlier model (or an exempt one,
      //    whose rows are never removed).
      if (EXEMPT.has(f.type)) continue;
      if (f.type === m.name) {
        problems.push(`${m.name}.${cols.join(",")} is a REQUIRED self-reference — unrestorable`);
        continue;
      }
      const dep = position.get(f.type);
      if (dep === undefined) {
        problems.push(`${m.name}.${f.name} -> ${f.type} which is not in the plan`);
      } else if (dep >= self) {
        problems.push(
          `insert order: ${m.name} (#${self}) comes before its required parent ${f.type} (#${dep})`
        );
      }
    } else {
      // 3. Optional FK must be deferred to pass 2.
      for (const c of cols) {
        if (!entry.softFks.includes(c)) {
          problems.push(`${m.name}.${c} is an optional FK but is not in softFks`);
        }
      }
    }
  }
}

console.log(`Models in plan: ${plan.length} (+${EXEMPT.size} exempt)`);
console.log(`Deferred optional FKs: ${plan.reduce((n, p) => n + p.softFks.length, 0)}`);
console.log(`\nInsert order (delete runs in reverse):`);
plan.forEach((p, i) => {
  const marks = [p.softFks.length ? `soft:${p.softFks.join(",")}` : ""].filter(Boolean);
  console.log(`  ${String(i + 1).padStart(2)}. ${p.name}${marks.length ? `  [${marks}]` : ""}`);
});

if (problems.length) {
  console.error(`\n${problems.length} PROBLEM(S):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nOK — insert order satisfies every required FK, every optional FK is deferred.");
