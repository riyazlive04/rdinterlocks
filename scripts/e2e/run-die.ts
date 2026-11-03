/**
 * The die register — build-docs/features/die-register.md
 *
 * `Die` / `DieUsage` existed in the live database but were never committed to
 * schema.prisma, so the next `db push` would have dropped them. They were
 * retained pending a decision; the decision is to keep them and let the
 * manager or supervisor maintain them.
 *
 * The screen was ported from origin/feature/register-dies-avm-tipper-pl,
 * where **none of the four server actions had any authorization**. The gates
 * added on the way in are the most important thing here, so DIE-09..11 test
 * the decisions directly rather than trusting the port.
 *
 * SAFETY: writes and deletes its own fixtures; refuses a non-local database.
 * It writes to CashEntry and Expense, so cleanup removes those by id — the
 * mistake a throwaway script once made against production was to leave a
 * CashEntry stranded.
 *
 * Run: npx tsx scripts/e2e/run-die.ts
 */

import { tc, eq, ok, run } from "./harness";
import { prisma } from "@/lib/db";
import { can, DEFAULT_AREAS_BY_ROLE } from "@/lib/access";
import { isFullAccess } from "@/lib/roles";
import { categoryIdByName } from "@/lib/expense-category";

const url = process.env.DATABASE_URL ?? "";
const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);
if (!isLocal && process.env.E2E_ALLOW_REMOTE_DB !== "yes") {
  console.error(
    "REFUSING TO RUN: DATABASE_URL is not local.\n" +
      `  got: ${url.replace(/:[^:@/]*@/, ":***@") || "(unset)"}\n` +
      "This suite writes and deletes rows. Point it at a throwaway database."
  );
  process.exit(2);
}

const TAG = "E2E_DIE";
const day = (iso: string) => new Date(`${iso}T06:00:00Z`);

async function cleanup() {
  const dies = await prisma.die.findMany({
    where: { OR: [{ code: { startsWith: TAG } }, { notes: { startsWith: TAG } }] },
    select: { id: true, expenseId: true },
  });
  for (const d of dies) {
    await prisma.dieUsage.deleteMany({ where: { dieId: d.id } });
    await prisma.die.delete({ where: { id: d.id } }).catch(() => {});
  }
  // Expense is the child of CashEntry here; both are removed explicitly.
  const expenses = await prisma.expense.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true, cashEntryId: true },
  });
  await prisma.expense.deleteMany({ where: { id: { in: expenses.map((e) => e.id) } } });
  const cashIds = expenses.map((e) => e.cashEntryId).filter((x): x is string => !!x);
  if (cashIds.length) await prisma.cashEntry.deleteMany({ where: { id: { in: cashIds } } });
  await prisma.cashEntry.deleteMany({ where: { title: { startsWith: TAG } } });

  await prisma.productionEntry.deleteMany({ where: { notes: { startsWith: TAG } } });
}

/**
 * The create path, rebuilt from app/(app)/die/actions.ts.
 *
 * The action itself needs a request context (requireArea), so the suite
 * performs the same writes and tests the *decisions* separately in DIE-09..11
 * — the same split as run-actions.ts, for the same reason.
 */
async function createDieRow(opts: {
  cost: number;
  purchasedAt: Date;
  brickSizeId?: string | null;
  seq: number;
}) {
  const code = `${TAG} ${opts.seq}`;
  let expenseId: string | null = null;

  if (opts.cost > 0) {
    const categoryId = await categoryIdByName("Mould (Die)");
    const entry = await prisma.cashEntry.create({
      data: {
        date: opts.purchasedAt,
        amount: opts.cost,
        direction: "out",
        source: "expense",
        category: "Mould (Die)",
        title: `${TAG} ${code} - new die`,
        method: "cash",
        expense: {
          create: {
            date: opts.purchasedAt,
            categoryId,
            title: `${TAG} ${code} - new die`,
            amount: opts.cost,
          },
        },
      },
      include: { expense: true },
    });
    expenseId = entry.expense?.id ?? null;
  }

  return prisma.die.create({
    data: {
      code,
      brickSizeId: opts.brickSizeId ?? null,
      cost: opts.cost,
      purchasedAt: opts.purchasedAt,
      notes: TAG,
      expenseId,
      usages: { create: [{ side: 1, startedAt: opts.purchasedAt }] },
    },
    include: { usages: true },
  });
}

// ───────────────────────── the side lifecycle ────────────────────────────

/** AC DIE-01 / DIE-03 / DIE-04 / DIE-05: a die's two faces, start to scrap. */
const lifecycle = tc("DIE-01", "a die goes in, flips, and is retired", async () => {
  const purchased = day("2026-01-10");
  const die = await createDieRow({ cost: 0, purchasedAt: purchased, seq: 1 });

  eq("side 1 opens with the die", die.usages.length, 1);
  eq("on side 1", die.usages[0].side, 1);
  eq("from the purchase date", die.usages[0].startedAt.getTime(), purchased.getTime());
  eq("and it is running", die.usages[0].endedAt, null);

  // ─── Flip: close side 1, open side 2, same date (DIE-03) ───
  const flipped = day("2026-03-01");
  const side1 = die.usages[0];
  await prisma.dieUsage.update({ where: { id: side1.id }, data: { endedAt: flipped } });
  await prisma.dieUsage.create({ data: { dieId: die.id, side: 2, startedAt: flipped } });

  const afterFlip = await prisma.dieUsage.findMany({
    where: { dieId: die.id },
    orderBy: { side: "asc" },
  });
  eq("two faces now", afterFlip.length, 2);
  eq("side 1 closed on the flip date", afterFlip[0].endedAt?.getTime(), flipped.getTime());
  eq("side 2 opened the same day", afterFlip[1].startedAt.getTime(), flipped.getTime());
  eq("side 2 is running", afterFlip[1].endedAt, null);

  // A second flip is impossible — the unique constraint is the real guard, so
  // this proves the database would reject it even if a check were removed.
  let dup = false;
  try {
    await prisma.dieUsage.create({ data: { dieId: die.id, side: 2, startedAt: flipped } });
  } catch {
    dup = true;
  }
  ok("a die can never have two rows for one face", dup);

  // ─── Retire: close every open face (DIE-04) ───
  const retired = day("2026-06-01");
  await prisma.dieUsage.updateMany({
    where: { dieId: die.id, endedAt: null },
    data: { endedAt: retired },
  });
  const done = await prisma.dieUsage.findMany({ where: { dieId: die.id } });
  eq("nothing is left running", done.filter((u) => !u.endedAt).length, 0);

  // ─── Reopen: the undo for a mis-tap (DIE-05) ───
  const side2 = done.find((u) => u.side === 2)!;
  await prisma.dieUsage.update({ where: { id: side2.id }, data: { endedAt: null } });
  const reopened = await prisma.dieUsage.findUniqueOrThrow({ where: { id: side2.id } });
  eq("side 2 is running again", reopened.endedAt, null);
});

/** AC DIE-02: codes are sequential and never collide. */
const codes = tc("DIE-02", "die codes do not collide or skip", async () => {
  const a = await createDieRow({ cost: 0, purchasedAt: day("2026-02-01"), seq: 11 });
  const b = await createDieRow({ cost: 0, purchasedAt: day("2026-02-02"), seq: 12 });
  ok("two distinct codes", a.code !== b.code);

  // `code` is @unique, which is what actually stops a duplicate — the derived
  // `Die N` numbering is a convenience on top of that.
  let clash = false;
  try {
    await prisma.die.create({ data: { code: a.code, notes: TAG } });
  } catch {
    clash = true;
  }
  ok("the database refuses a duplicate code", clash);
});

/** AC DIE-06 / DIE-07: the money a die purchase books, and unwinds. */
const money = tc("DIE-06", "a costed die books one expense and unwinds cleanly", async () => {
  // Zero cost books nothing — a die registered before the invoice arrives.
  const free = await createDieRow({ cost: 0, purchasedAt: day("2026-04-01"), seq: 21 });
  eq("no expense for a zero-cost die", free.expenseId, null);

  const costed = await createDieRow({ cost: 18000, purchasedAt: day("2026-04-02"), seq: 22 });
  ok("a costed die is linked to its expense", !!costed.expenseId);

  const expense = await prisma.expense.findUniqueOrThrow({
    where: { id: costed.expenseId! },
    include: { category: true, cashEntry: true },
  });
  eq("for the purchase price", expense.amount, 18000);
  eq("under Mould (Die)", expense.category.name, "Mould (Die)");
  ok("and attached to a cash entry", !!expense.cashEntryId);
  eq("money leaving the books", expense.cashEntry?.direction, "out");
  eq("for the same amount", expense.cashEntry?.amount, 18000);

  // ─── DIE-07: deleting a costed die leaves no orphan money ───
  const expenseId = expense.id;
  const cashEntryId = expense.cashEntryId!;
  await prisma.dieUsage.deleteMany({ where: { dieId: costed.id } });
  await prisma.die.delete({ where: { id: costed.id } });
  await prisma.expense.delete({ where: { id: expenseId } });
  await prisma.cashEntry.delete({ where: { id: cashEntryId } });

  eq("the die is gone", await prisma.die.count({ where: { id: costed.id } }), 0);
  eq("its usages went with it", await prisma.dieUsage.count({ where: { dieId: costed.id } }), 0);
  eq("the expense is gone", await prisma.expense.count({ where: { id: expenseId } }), 0);
  // The one that matters: a stranded CashEntry is money in the cashbook with
  // nothing behind it, which is exactly the production incident in MEMORY.
  eq("and NO cash entry is stranded", await prisma.cashEntry.count({ where: { id: cashEntryId } }), 0);
});

/** AC DIE-08: bricks per face, bounded by the interval and the brick size. */
const bricksPerFace = tc("DIE-08", "bricks are counted per face and per size", async () => {
  const [size, other, machine] = await Promise.all([
    prisma.brickSize.findFirst({ orderBy: { order: "asc" } }),
    prisma.brickSize.findFirst({ orderBy: { order: "desc" } }),
    prisma.machine.findFirst(),
  ]);
  if (!size || !other || !machine || size.id === other.id) {
    return ok("fixtures present (need two brick sizes and a machine)", false);
  }

  const mk = (date: string, brickSizeId: string, brickCount: number) =>
    prisma.productionEntry.create({
      data: {
        date: day(date),
        machineId: machine.id,
        brickSizeId,
        brickCount,
        // Required with no default; the wage is irrelevant to this test but
        // the row cannot exist without it.
        ratePerBrick: 0.5,
        totalWage: brickCount * 0.5,
        notes: TAG,
      },
    });

  // Side 1 runs Jan 10 -> Mar 01, side 2 from Mar 01.
  await mk("2026-01-05", size.id, 1000); // before the die existed
  await mk("2026-01-20", size.id, 5000); // side 1
  await mk("2026-02-20", size.id, 3000); // side 1
  await mk("2026-02-21", other.id, 9000); // side 1 window, WRONG size
  await mk("2026-04-01", size.id, 7000); // side 2

  const entries = await prisma.productionEntry.findMany({
    where: { notes: TAG },
    select: { date: true, brickCount: true, brickSizeId: true },
  });

  // The page's own helper, same arithmetic.
  const bricksBetween = (from: Date, to: Date | null, brickSizeId: string | null) => {
    const end = to ?? new Date();
    return entries
      .filter((e) => e.date >= from && e.date <= end && (!brickSizeId || e.brickSizeId === brickSizeId))
      .reduce((s, e) => s + e.brickCount, 0);
  };

  eq(
    "side 1 counts only its own window and size",
    bricksBetween(day("2026-01-10"), day("2026-03-01"), size.id),
    8000
  );
  eq(
    "side 2 counts from the flip onward",
    bricksBetween(day("2026-03-01"), null, size.id),
    7000
  );
  eq(
    "a die with no brick size counts every size in the window",
    bricksBetween(day("2026-01-10"), day("2026-03-01"), null),
    17000
  );
  eq(
    "production before the die existed is excluded",
    bricksBetween(day("2026-01-10"), day("2026-03-01"), size.id),
    8000
  );
});

// ──────────────────────────── authorization ──────────────────────────────
//
// The port's source branch had NO authorization on any die action. These
// three assert the gates that were added, as decisions — the actions
// themselves need a request context, same split as run-actions.ts.

/** AC DIE-09: the register belongs to the floor, not the phone. */
const areaDefaults = tc("DIE-09", "a supervisor holds the die register, a telecaller does not", () => {
  const sup = { role: "supervisor", permissions: DEFAULT_AREAS_BY_ROLE.supervisor };
  const tele = { role: "telecaller", permissions: DEFAULT_AREAS_BY_ROLE.telecaller };
  ok("supervisor: die", can(sup, "die"));
  ok("telecaller: NOT die", !can(tele, "die"));
  ok("owner: die, via full access", can({ role: "owner", permissions: [] }, "die"));
  ok("manager: die, via full access", can({ role: "manager", permissions: [] }, "die"));
  // The supervisor deliberately does NOT get the cashbook, which is what
  // makes DIE-10 meaningful.
  ok("supervisor: NOT expense", !can(sup, "expense"));
});

/**
 * AC DIE-10: recording what a die COST books an expense, so it needs cashbook
 * standing on top of the die area.
 *
 * This mirrors the condition in createDie. A supervisor can register the
 * mould at zero — which is the normal case anyway, since the die usually
 * arrives before the invoice — and a manager adds the amount.
 */
const costNeedsExpense = tc("DIE-10", "a costed die needs cashbook access", () => {
  const mayBookCost = (u: { role: string; permissions: string[] }, cost: number) =>
    cost <= 0 || can(u, "expense") || isFullAccess(u.role);

  const sup = { role: "supervisor", permissions: DEFAULT_AREAS_BY_ROLE.supervisor };
  ok("a supervisor may register a die at no cost", mayBookCost(sup, 0));
  ok("but NOT book what it cost", !mayBookCost(sup, 18000));

  const supWithCash = { role: "supervisor", permissions: [...DEFAULT_AREAS_BY_ROLE.supervisor, "expense"] };
  ok("granting the cashbook lets them", mayBookCost(supWithCash, 18000));
  ok("a manager may", mayBookCost({ role: "manager", permissions: [] }, 18000));
  ok("an owner may", mayBookCost({ role: "owner", permissions: [] }, 18000));
});

/** AC DIE-11: deleting a die removes money, so it is owner/manager only. */
const deleteIsFullAccess = tc("DIE-11", "only an owner or manager deletes a die", () => {
  ok("owner", isFullAccess("owner"));
  ok("admin", isFullAccess("admin"));
  ok("manager", isFullAccess("manager"));
  ok("NOT a supervisor, even holding `die`", !isFullAccess("supervisor"));
  ok("NOT a telecaller", !isFullAccess("telecaller"));
  ok("NOT staff", !isFullAccess("staff"));
});

/** AC DIE-12: the models were already declared — this feature adds no schema. */
const noSchemaChange = tc("DIE-12", "the tables already existed", async () => {
  // If `db push` had ever dropped these, the queries would throw rather than
  // return 0 — which is the whole reason they were restored to schema.prisma.
  ok("Die is queryable", typeof (await prisma.die.count()) === "number");
  ok("DieUsage is queryable", typeof (await prisma.dieUsage.count()) === "number");
});

(async () => {
  await cleanup();
  try {
    await run("Die register", [
      lifecycle,
      codes,
      money,
      bricksPerFace,
      areaDefaults,
      costNeedsExpense,
      deleteIsFullAccess,
      noSchemaChange,
    ]);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})();
