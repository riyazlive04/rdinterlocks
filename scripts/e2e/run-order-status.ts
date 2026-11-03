/**
 * Order status vocabulary — src/lib/order-status.ts
 *
 * Why this suite exists: this app carried TWO vocabularies for Order.status
 * at once. The `feat/lead-intake-quote-review` branch used
 * open | partial | complete | cancelled; main used
 * upcoming | active | completed | cancelled and changed the column DEFAULT to
 * `active`. Merging the two put both sets of string literals in one codebase,
 * and every suite kept passing because each one seeded its own vocabulary and
 * never met the other's.
 *
 * The user-visible result was silent and wrong rather than loud: the owner's
 * "Pending orders" panel queried `in: ["open", "partial"]`, which matches
 * nothing once a new row defaults to `active`, so the panel rendered empty
 * with no error anywhere. These assertions are written against that failure.
 *
 * Pure logic, no database.
 *
 * Run: npx tsx scripts/e2e/run-order-status.ts
 */

import { tc, eq, ok, run } from "./harness";
import {
  ORDER_STATUSES,
  OPEN_ORDER_STATUSES,
  CLOSED_ORDER_STATUSES,
  isOrderOpen,
  deriveOrderStatus,
  orderStatusLabel,
} from "@/lib/order-status";

const CANONICAL_OPEN = ["upcoming", "active"];
const CANONICAL_CLOSED = ["completed", "cancelled"];
const LEGACY_OPEN = ["open", "partial"];
const LEGACY_CLOSED = ["complete"];

/**
 * OS-01: the regression that started this. A row holding the column default
 * must read as open, or the panel that lists what is pending goes blank.
 */
const theDefaultIsOpen = tc("OS-01", "an order holding the column default is open", () => {
  ok("the schema default `active` is open", isOrderOpen("active"));
  ok("and it is matched by the query list", OPEN_ORDER_STATUSES.includes("active" as never));
  ok("`upcoming` is open too", isOrderOpen("upcoming"));
});

/** OS-02: both vocabularies are understood, because the database holds both. */
const bothVocabularies = tc("OS-02", "legacy and canonical spellings agree", () => {
  for (const s of [...CANONICAL_OPEN, ...LEGACY_OPEN]) {
    ok(`${s} is open`, isOrderOpen(s));
    ok(`${s} is in the query list`, OPEN_ORDER_STATUSES.includes(s as never));
  }
  for (const s of [...CANONICAL_CLOSED, ...LEGACY_CLOSED]) {
    ok(`${s} is closed`, !isOrderOpen(s));
    ok(`${s} is in the closed list`, CLOSED_ORDER_STATUSES.includes(s as never));
  }
});

/**
 * OS-03: the direction of the legacy guess matters. A finished order wrongly
 * read as open comes BACK into the fulfilment queue and the owner's pending
 * panel; that is the louder, more misleading failure, so `complete` must be
 * closed rather than falling through.
 */
const legacyCompleteIsClosed = tc("OS-03", "a legacy `complete` order stays finished", () => {
  ok("not open", !isOrderOpen("complete"));
  ok("canonical `completed` also not open", !isOrderOpen("completed"));
});

/** OS-04: the two lists must never overlap, or a row would be both. */
const listsAreDisjoint = tc("OS-04", "open and closed never overlap", () => {
  const overlap = OPEN_ORDER_STATUSES.filter((s) =>
    (CLOSED_ORDER_STATUSES as readonly string[]).includes(s)
  );
  eq("no status is both open and closed", overlap, []);
});

/**
 * OS-05: only canonical values are ever WRITTEN. The legacy spellings are
 * read-compatibility for existing rows, not something new code may create —
 * otherwise the divergence this suite exists to catch grows back.
 */
const writesStayCanonical = tc("OS-05", "nothing writes a legacy spelling", () => {
  const now = new Date("2026-11-03T00:00:00Z");
  const cases = [
    { orderedQty: 100, deliveredQty: 100, date: now, now },
    { orderedQty: 100, deliveredQty: 40, date: now, now },
    { orderedQty: 100, deliveredQty: 0, date: new Date("2026-12-01T00:00:00Z"), now },
    { orderedQty: 100, deliveredQty: 0, date: new Date("2026-10-01T00:00:00Z"), now },
    { orderedQty: 0, deliveredQty: 0, date: now, now, current: "cancelled" },
  ];
  const legacy = [...LEGACY_OPEN, ...LEGACY_CLOSED];
  for (const c of cases) {
    const got = deriveOrderStatus(c);
    ok(`derive(${c.deliveredQty}/${c.orderedQty}) -> ${got} is not legacy`, !legacy.includes(got));
  }
  // And the chips the UI offers are canonical only.
  for (const s of ORDER_STATUSES) {
    ok(`chip ${s.key} is canonical`, !legacy.includes(s.key));
  }
});

/** OS-06: deriveOrderStatus' documented contract, including the cancel pin. */
const deriveContract = tc("OS-06", "status is derived from what actually went out", () => {
  const now = new Date("2026-11-03T00:00:00Z");
  eq(
    "everything delivered -> completed",
    deriveOrderStatus({ orderedQty: 50, deliveredQty: 50, date: now, now }),
    "completed"
  );
  eq(
    "part delivered -> active",
    deriveOrderStatus({ orderedQty: 50, deliveredQty: 10, date: now, now }),
    "active"
  );
  eq(
    "nothing out and still ahead -> upcoming",
    deriveOrderStatus({
      orderedQty: 50,
      deliveredQty: 0,
      date: now,
      expectedDeliveryDate: new Date("2026-12-01T00:00:00Z"),
      now,
    }),
    "upcoming"
  );
  eq(
    "nothing out and overdue -> active",
    deriveOrderStatus({
      orderedQty: 50,
      deliveredQty: 0,
      date: now,
      expectedDeliveryDate: new Date("2026-10-01T00:00:00Z"),
      now,
    }),
    "active"
  );
  eq(
    "cancelled is a decision, never re-derived",
    deriveOrderStatus({
      orderedQty: 50,
      deliveredQty: 50,
      date: now,
      now,
      current: "cancelled",
    }),
    "cancelled"
  );
});

/** OS-07: an unknown value is labelled, not crashed on. */
const unknownIsSafe = tc("OS-07", "an unrecognised status still renders", () => {
  eq("falls back to Cancelled", orderStatusLabel("something-nobody-wrote"), "Cancelled");
  eq("canonical label", orderStatusLabel("active"), "Active");
});

run("ORDER STATUS SUITE (no database required)", [
  theDefaultIsOpen,
  bothVocabularies,
  legacyCompleteIsClosed,
  listsAreDisjoint,
  writesStayCanonical,
  deriveContract,
  unknownIsSafe,
]);
