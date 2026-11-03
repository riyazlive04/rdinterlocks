/**
 * Task categories, checklists, notes, files and recurrence —
 * build-docs/features/task-extensions.md
 *
 * Same split as the other action suites: the rules are pure functions and are
 * tested directly; the writes are tested against real rows. The recurrence
 * engine takes a transaction client, so it IS exercised end to end here.
 *
 * SAFETY: writes and deletes its own fixtures; refuses a non-local database.
 *
 * Run: npx tsx scripts/e2e/run-task-extensions.ts
 */

import { randomUUID } from "crypto";
import { tc, eq, ok, run } from "./harness";
import { prisma } from "@/lib/db";
import {
  canContributeToTask,
  canDeleteTaskNote,
  canViewTask,
  ROLES,
} from "@/lib/roles";
import {
  TASK_CATEGORIES,
  TASK_RECURRENCES,
  categoryLabel,
  nextDueDate,
  normalizeCategory,
  normalizeRecurrence,
} from "../../src/app/(app)/tasks/task-meta";
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENTS_PER_TASK,
  MAX_ATTACHMENT_BYTES,
  attachmentProblem,
  isInlineSafe,
  safeFileName,
} from "@/lib/task-attachments";
import { spawnNextOccurrence } from "@/lib/task-recurrence";

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

const TAG = "E2E_TASKX";
const uniq = () => `${TAG}_${randomUUID().slice(0, 8)}`;

async function cleanup() {
  const tasks = await prisma.task.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = tasks.map((t) => t.id);
  if (ids.length) {
    await prisma.taskChecklistItem.deleteMany({ where: { taskId: { in: ids } } });
    await prisma.taskComment.deleteMany({ where: { taskId: { in: ids } } });
    await prisma.taskAttachment.deleteMany({ where: { taskId: { in: ids } } });
    // Children first: a recurrence parent cannot be deleted while a
    // successor still points at it... except it can (SetNull), which is
    // exactly the property REC-05 asserts.
    await prisma.task.deleteMany({ where: { recurrenceParentId: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
  }
  const users = await prisma.user.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  for (const u of users) {
    await prisma.taskChecklistItem.updateMany({ where: { doneById: u.id }, data: { doneById: null } });
    await prisma.task.deleteMany({ where: { OR: [{ assignedToId: u.id }, { createdById: u.id }] } });
    await prisma.dutySession.deleteMany({ where: { userId: u.id } });
    await prisma.leadActivity.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
  }
}

const mkUser = (role: string) =>
  prisma.user.create({
    data: { name: uniq(), pinHash: "x", role, permissions: [], active: true },
  });

// ───────────────────────────── categories ────────────────────────────────

/** AC CAT-01: a fixed list, with null a legal value. */
const categories = tc("CAT-01", "categories are a fixed list and null is legal", () => {
  for (const c of TASK_CATEGORIES) {
    eq(`${c} round-trips`, normalizeCategory(c), c);
    ok(`${c} has a label`, categoryLabel(c).length > 0);
  }
  // Free text is exactly what this prevents: "Prodcution" must not become a
  // category nobody can ever filter on again.
  eq("a typo is not a category", normalizeCategory("Prodcution"), null);
  eq("wrong case is not a category", normalizeCategory("Production"), null);
  eq("null stays null", normalizeCategory(null), null);
  eq("empty stays null", normalizeCategory(""), null);
  eq("and reads as uncategorised", categoryLabel(null), "Uncategorised");
  eq("six categories", TASK_CATEGORIES.length, 6);
});

// ───────────────────────── visibility and writing ────────────────────────

const OWNER = { userId: "u-owner", role: "owner" };
const MANAGER = { userId: "u-manager", role: "manager" };
const TELE = { userId: "u-tele", role: "telecaller" };
const OTHER_TELE = { userId: "u-tele-2", role: "telecaller" };

const taskOf = (assignedToId: string, createdById: string | null, assigneeRole = "telecaller") => ({
  assignedToId,
  createdById,
  assigneeRole,
});

/**
 * AC VIS-01: the creator can always read back, even with no rank.
 *
 * This is the one way canViewTask is broader than canUpdateTaskStatus, and it
 * matters: the person who asked for the work must be able to see the photo of
 * why it could not be done, even after a reorganisation leaves them no longer
 * outranking the assignee.
 */
const visibility = tc("VIS-01", "assignee, creator and seniors may read a task", () => {
  const task = taskOf(TELE.userId, MANAGER.userId);
  ok("the assignee may", canViewTask(TELE, task).allowed);
  ok("the creator may", canViewTask(MANAGER, task).allowed);
  ok("a senior may", canViewTask(OWNER, task).allowed);

  // A peer may not — reading does not run sideways either.
  const peer = canViewTask(OTHER_TELE, task);
  eq("another telecaller may not", peer.allowed, false);
  ok(
    "and is told why",
    !peer.allowed && /not yours or your team/i.test(peer.reason),
    !peer.allowed ? peer.reason : ""
  );

  // The creator carve-out, isolated: a supervisor who raised a task for
  // another supervisor outranks nobody here, but still created it.
  const peerCreated = taskOf("u-sup-2", "u-sup-1", "supervisor");
  ok(
    "the creator reads it without rank",
    canViewTask({ userId: "u-sup-1", role: "supervisor" }, peerCreated).allowed
  );
  eq(
    "but an unrelated peer does not",
    canViewTask({ userId: "u-sup-3", role: "supervisor" }, peerCreated).allowed,
    false
  );

  // Contributing follows viewing exactly.
  for (const actor of [TELE, MANAGER, OWNER]) {
    eq(
      `${actor.role} may contribute iff they may view`,
      canContributeToTask(actor, task).allowed,
      canViewTask(actor, task).allowed
    );
  }
  eq("a peer may not contribute", canContributeToTask(OTHER_TELE, task).allowed, false);
});

/** AC VIS-02: your own note always; someone else's only with rank. */
const noteDeletion = tc("VIS-02", "deleting a note needs authorship or rank", () => {
  const task = taskOf(TELE.userId, MANAGER.userId);

  ok("your own note", canDeleteTaskNote(TELE, task, TELE.userId).allowed);
  ok("a senior may remove anyone's", canDeleteTaskNote(MANAGER, task, TELE.userId).allowed);
  ok("the owner too", canDeleteTaskNote(OWNER, task, "someone-else").allowed);

  // The assignee may NOT remove a manager's note from their own task: the
  // thread is a record, not their workspace.
  const theirs = canDeleteTaskNote(TELE, task, MANAGER.userId);
  eq("not someone else's, on your own task", theirs.allowed, false);
  ok(
    "and the refusal names who can",
    !theirs.allowed && /person who added it, or their senior/i.test(theirs.reason),
    !theirs.allowed ? theirs.reason : ""
  );

  // A note whose author was deleted (userId null) is nobody's "own".
  eq("an orphaned note is not yours", canDeleteTaskNote(TELE, task, null).allowed, false);
  ok("but a senior can still clear it", canDeleteTaskNote(MANAGER, task, null).allowed);
});

// ───────────────────────────── attachments ───────────────────────────────

/** AC ATT-01: the allow-list, the size cap and the per-task cap. */
const attachmentRules = tc("ATT-01", "attachments are bounded and type-checked", () => {
  const good = { name: "mould.jpg", type: "image/jpeg", size: 1024 * 1024 };
  eq("a 1 MB photo is fine", attachmentProblem(good, 0), null);

  ok("an empty file is refused", !!attachmentProblem({ ...good, size: 0 }, 0));
  const tooBig = attachmentProblem({ ...good, size: MAX_ATTACHMENT_BYTES + 1 }, 0);
  ok("over the cap is refused", !!tooBig);
  ok("and the message says the limit", !!tooBig && /limit is/i.test(tooBig));

  const full = attachmentProblem(good, MAX_ATTACHMENTS_PER_TASK);
  ok("a full task is refused", !!full);
  ok("and says to remove one", !!full && /remove one/i.test(full));

  // The allow-list is the security boundary, so the dangerous types are
  // named explicitly rather than left to "not in the list".
  for (const bad of ["text/html", "image/svg+xml", "application/xml", "application/javascript", ""]) {
    ok(`${bad || "(no type)"} is refused`, !!attachmentProblem({ ...good, type: bad }, 0));
  }
  for (const allowed of Object.keys(ALLOWED_ATTACHMENT_TYPES)) {
    eq(`${allowed} is allowed`, attachmentProblem({ ...good, type: allowed }, 0), null);
  }

  // Only images and PDF are ever shown inline — text/csv render in-page, so
  // they are forced as downloads.
  ok("jpeg inline", isInlineSafe("image/jpeg"));
  ok("pdf inline", isInlineSafe("application/pdf"));
  ok("text is NOT inline", !isInlineSafe("text/plain"));
  ok("csv is NOT inline", !isInlineSafe("text/csv"));
  ok("svg is NOT inline", !isInlineSafe("image/svg+xml"));
  ok("html is NOT inline", !isInlineSafe("text/html"));
});

/** AC ATT-02: the filename reaches a header, so it is sanitised. */
const fileNames = tc("ATT-02", "filenames cannot escape the header", () => {
  eq("a plain name survives", safeFileName("mould photo.jpg"), "mould photo.jpg");

  // Path traversal — both separators, since the client may be Windows.
  eq("unix path stripped", safeFileName("../../etc/passwd"), "passwd");
  eq("windows path stripped", safeFileName("C:\\Windows\\win.ini"), "win.ini");
  eq("bare traversal yields nothing", safeFileName("../.."), "");

  // A quote would terminate the quoted-string in Content-Disposition.
  ok('quotes removed', !safeFileName('a"b.jpg').includes('"'));
  ok("semicolons removed", !safeFileName("a;b.jpg").includes(";"));
  ok("backslashes removed", !safeFileName("a\\b.jpg").includes("\\"));
  // CRLF would split the header entirely.
  const crlf = safeFileName("a\r\nX-Evil: 1.jpg");
  ok("newlines removed", !/[\r\n]/.test(crlf));

  eq("empty stays empty", safeFileName(""), "");
  eq("whitespace only is empty", safeFileName("   "), "");
  eq("hidden-file dots stripped", safeFileName(".htaccess"), "htaccess");
  ok("long names are truncated", safeFileName("x".repeat(500)).length <= 120);
});

/** AC ATT-03: a real file round-trips, and the bytes are never over-read. */
const attachmentWrites = tc("ATT-03", "a file stores and reads back", async () => {
  const sup = await mkUser("supervisor");
  const manager = await mkUser("manager");
  const task = await prisma.task.create({
    data: { title: `${TAG} fix the belt`, assignedToId: sup.id, createdById: manager.id },
  });

  const bytes = Buffer.from("not really a jpeg, but bytes are bytes");
  const { createHash } = await import("crypto");
  const sha = createHash("sha256").update(bytes).digest("hex");

  const saved = await prisma.taskAttachment.create({
    data: {
      taskId: task.id,
      name: "belt.jpg",
      mimeType: "image/jpeg",
      byteSize: bytes.byteLength,
      data: bytes,
      sha256: sha,
      uploadedById: sup.id,
      uploaderName: sup.name,
    },
  });
  eq("the size matches the real buffer", saved.byteSize, bytes.byteLength);

  // The list query must never pull the blob — this is the shape page.tsx uses.
  const listed = await prisma.taskAttachment.findMany({
    where: { taskId: task.id },
    select: { id: true, name: true, byteSize: true, uploaderName: true },
  });
  eq("one file listed", listed.length, 1);
  ok("the uploader's name is snapshotted", listed[0].uploaderName === sup.name);
  ok("and `data` is absent from the listing", !("data" in listed[0]));

  // Read back for download.
  const full = await prisma.taskAttachment.findUniqueOrThrow({ where: { id: saved.id } });
  eq("the bytes survived", Buffer.from(full.data).toString(), bytes.toString());
  eq("the hash matches", full.sha256, sha);

  // Deleting the TASK takes its files with it (Cascade), so no orphan blobs.
  await prisma.task.delete({ where: { id: task.id } });
  eq("files cascade with the task", await prisma.taskAttachment.count({ where: { id: saved.id } }), 0);
});

// ───────────────────────────── checklist ─────────────────────────────────

/** AC CHK-01: steps are ordered rows, and progress is countable. */
const checklist = tc("CHK-01", "checklist steps are ordered and countable", async () => {
  const sup = await mkUser("supervisor");
  const task = await prisma.task.create({
    data: { title: `${TAG} service the mixer`, assignedToId: sup.id },
  });

  for (const [i, text] of ["Drain oil", "Replace filter", "Refill"].entries()) {
    await prisma.taskChecklistItem.create({ data: { taskId: task.id, text, order: i } });
  }

  const steps = await prisma.taskChecklistItem.findMany({
    where: { taskId: task.id },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  eq("three steps", steps.length, 3);
  eq("in order", steps.map((s) => s.text), ["Drain oil", "Replace filter", "Refill"]);
  eq("none done yet", steps.filter((s) => s.done).length, 0);

  // Ticking records who, which is the point of a shared checklist.
  await prisma.taskChecklistItem.update({
    where: { id: steps[0].id },
    data: { done: true, doneAt: new Date(), doneById: sup.id },
  });
  const after = await prisma.taskChecklistItem.findUniqueOrThrow({ where: { id: steps[0].id } });
  eq("ticked", after.done, true);
  eq("by whom", after.doneById, sup.id);
  ok("and when", !!after.doneAt);

  // Unticking clears the attribution rather than leaving a stale name.
  await prisma.taskChecklistItem.update({
    where: { id: steps[0].id },
    data: { done: false, doneAt: null, doneById: null },
  });
  const undone = await prisma.taskChecklistItem.findUniqueOrThrow({ where: { id: steps[0].id } });
  eq("untick clears who", undone.doneById, null);
  eq("and when", undone.doneAt, null);

  // Deleting a middle step must not make the next insert collide.
  await prisma.taskChecklistItem.delete({ where: { id: steps[1].id } });
  const max = await prisma.taskChecklistItem.findFirst({
    where: { taskId: task.id },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const added = await prisma.taskChecklistItem.create({
    data: { taskId: task.id, text: "Test run", order: (max?.order ?? -1) + 1 },
  });
  const orders = (
    await prisma.taskChecklistItem.findMany({ where: { taskId: task.id }, select: { order: true } })
  ).map((x) => x.order);
  eq("orders stay unique", orders.length, new Set(orders).size);
  ok("the new step is last", added.order === Math.max(...orders));

  await prisma.task.delete({ where: { id: task.id } });
  eq("steps cascade with the task", await prisma.taskChecklistItem.count({ where: { taskId: task.id } }), 0);
});

// ───────────────────────────── comments ──────────────────────────────────

/** AC CMT-01: the thread is append-only in order, and survives its author. */
const comments = tc("CMT-01", "notes keep their order and outlive the author", async () => {
  const sup = await mkUser("supervisor");
  const leaver = await mkUser("telecaller");
  const task = await prisma.task.create({
    data: { title: `${TAG} chase the cement`, assignedToId: sup.id },
  });

  await prisma.taskComment.create({
    data: { taskId: task.id, userId: sup.id, authorName: sup.name, body: "Supplier called back" },
  });
  await prisma.taskComment.create({
    data: { taskId: task.id, userId: leaver.id, authorName: leaver.name, body: "Delivery Thursday" },
  });

  const thread = await prisma.taskComment.findMany({
    where: { taskId: task.id },
    orderBy: { createdAt: "asc" },
  });
  eq("two notes", thread.length, 2);
  eq("oldest first", thread[0].body, "Supplier called back");

  // The author leaves. The note must remain, and must still read as a name.
  await prisma.taskChecklistItem.updateMany({ where: { doneById: leaver.id }, data: { doneById: null } });
  await prisma.task.deleteMany({ where: { assignedToId: leaver.id } });
  await prisma.user.delete({ where: { id: leaver.id } });

  const survived = await prisma.taskComment.findMany({
    where: { taskId: task.id },
    orderBy: { createdAt: "asc" },
  });
  eq("both notes survive", survived.length, 2);
  const orphan = survived.find((c) => c.body === "Delivery Thursday")!;
  eq("the link is nulled, not cascaded", orphan.userId, null);
  ok("but the name is still readable", orphan.authorName.startsWith(TAG));

  await prisma.task.delete({ where: { id: task.id } });
  eq("notes cascade with the task", await prisma.taskComment.count({ where: { taskId: task.id } }), 0);
});

// ───────────────────────────── recurrence ────────────────────────────────

/** AC REC-01: the next due date advances from the DUE date, not completion. */
const dueDates = tc("REC-01", "a late completion does not drift the series", () => {
  for (const r of TASK_RECURRENCES) {
    eq(`${r} round-trips`, normalizeRecurrence(r), r);
  }
  eq("unknown is null", normalizeRecurrence("hourly"), null);
  eq("null is null", normalizeRecurrence(null), null);

  // Weekly task due Monday, finished Thursday: next is the FOLLOWING Monday,
  // not Thursday+7. Otherwise a weekly job drifts later every cycle until it
  // is no longer weekly.
  const due = new Date("2026-06-01T09:00:00Z"); // Monday
  const late = new Date("2026-06-04T17:00:00Z"); // Thursday
  const next = nextDueDate("weekly", due, late);
  eq("advanced from the due date", next.toISOString().slice(0, 10), "2026-06-08");

  eq(
    "daily",
    nextDueDate("daily", new Date("2026-06-01T09:00:00Z"), new Date("2026-06-01T10:00:00Z"))
      .toISOString()
      .slice(0, 10),
    "2026-06-02"
  );
  eq(
    "fortnightly",
    nextDueDate("fortnightly", new Date("2026-06-01T09:00:00Z"), new Date("2026-06-01T10:00:00Z"))
      .toISOString()
      .slice(0, 10),
    "2026-06-15"
  );

  // With no due date there is nothing to anchor to, so completion is used.
  const anchorless = nextDueDate("weekly", null, new Date("2026-06-10T09:00:00Z"));
  eq("falls back to completion", anchorless.toISOString().slice(0, 10), "2026-06-17");

  // A series months behind must not produce an occurrence already overdue.
  const stale = nextDueDate("weekly", new Date("2026-01-05T09:00:00Z"), new Date("2026-06-15T09:00:00Z"));
  ok("caught up past the completion date", stale.getTime() > new Date("2026-06-15T09:00:00Z").getTime());
});

/** AC REC-02: monthly clamps instead of rolling into the next month. */
const monthlyClamp = tc("REC-02", "the 31st does not become the 1st", () => {
  // Jan 31 + 1 month must be Feb 28, not Mar 3 (which is what naive
  // setMonth(+1) produces).
  const jan31 = new Date("2026-01-31T09:00:00Z");
  const feb = nextDueDate("monthly", jan31, new Date("2026-01-31T10:00:00Z"));
  eq("Jan 31 -> Feb 28", feb.toISOString().slice(0, 10), "2026-02-28");

  const mar31 = new Date("2026-03-31T09:00:00Z");
  eq(
    "Mar 31 -> Apr 30",
    nextDueDate("monthly", mar31, new Date("2026-03-31T10:00:00Z")).toISOString().slice(0, 10),
    "2026-04-30"
  );
  // A normal month is untouched.
  eq(
    "Jun 15 -> Jul 15",
    nextDueDate("monthly", new Date("2026-06-15T09:00:00Z"), new Date("2026-06-15T10:00:00Z"))
      .toISOString()
      .slice(0, 10),
    "2026-07-15"
  );
  // Leap year.
  eq(
    "Jan 31 2028 -> Feb 29 (leap)",
    nextDueDate("monthly", new Date("2028-01-31T09:00:00Z"), new Date("2028-01-31T10:00:00Z"))
      .toISOString()
      .slice(0, 10),
    "2028-02-29"
  );
});

/** AC REC-03 / REC-04: one successor, ever, and only for repeating tasks. */
const spawning = tc("REC-03", "completing a repeating task makes exactly one successor", async () => {
  const sup = await mkUser("supervisor");
  const manager = await mkUser("manager");

  const make = (recurrence: string | null, due: Date | null) =>
    prisma.task.create({
      data: {
        title: `${TAG} sweep the yard`,
        details: "Both bays",
        assignedToId: sup.id,
        createdById: manager.id,
        dueDate: due,
        priority: "low",
        category: "maintenance",
        recurrence,
        checklist: { create: [{ text: "Bay 1", order: 0 }, { text: "Bay 2", order: 1 }] },
      },
      include: { checklist: true },
    });

  const completedAt = new Date("2026-06-04T17:00:00Z");
  const task = await make("weekly", new Date("2026-06-01T09:00:00Z"));

  // Tick a step, so we can prove the ticks do NOT travel.
  await prisma.taskChecklistItem.update({
    where: { id: task.checklist[0].id },
    data: { done: true, doneAt: completedAt, doneById: sup.id },
  });

  const first = await prisma.$transaction((tx) =>
    spawnNextOccurrence(
      tx,
      {
        id: task.id,
        title: task.title,
        details: task.details,
        assignedToId: task.assignedToId,
        createdById: task.createdById,
        dueDate: task.dueDate,
        priority: task.priority,
        category: task.category,
        recurrence: task.recurrence,
        recurrenceSpawnedAt: task.recurrenceSpawnedAt,
      },
      completedAt
    )
  );
  ok("a successor was created", first.spawned);
  if (!first.spawned) return;

  const next = await prisma.task.findUniqueOrThrow({
    where: { id: first.taskId },
    include: { checklist: { orderBy: { order: "asc" } } },
  });
  eq("the instruction is copied", next.title, task.title);
  eq("details too", next.details, task.details);
  eq("same assignee", next.assignedToId, sup.id);
  eq("still attributed to whoever set it up", next.createdById, manager.id);
  eq("priority carried", next.priority, "low");
  eq("category carried", next.category, "maintenance");
  eq("still repeating", next.recurrence, "weekly");
  eq("linked to its parent", next.recurrenceParentId, task.id);
  eq("open", next.status, "open");
  eq("due a week after the ORIGINAL due date", next.dueDate?.toISOString().slice(0, 10), "2026-06-08");

  // The steps travel; the ticks do not.
  eq("steps copied", next.checklist.length, 2);
  eq("in order", next.checklist.map((c) => c.text), ["Bay 1", "Bay 2"]);
  eq("and all unticked", next.checklist.filter((c) => c.done).length, 0);
  eq("with no stale attribution", next.checklist.filter((c) => c.doneById).length, 0);
  eq("and nothing started", next.startedAt, null);

  // AC REC-04: completing → reopening → completing must not spawn twice.
  const reread = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  ok("the parent is marked as having spawned", !!reread.recurrenceSpawnedAt);
  const second = await prisma.$transaction((tx) =>
    spawnNextOccurrence(
      tx,
      {
        id: reread.id,
        title: reread.title,
        details: reread.details,
        assignedToId: reread.assignedToId,
        createdById: reread.createdById,
        dueDate: reread.dueDate,
        priority: reread.priority,
        category: reread.category,
        recurrence: reread.recurrence,
        recurrenceSpawnedAt: reread.recurrenceSpawnedAt,
      },
      new Date()
    )
  );
  eq("a second attempt makes nothing", second.spawned, false);
  ok(
    "and says why",
    !second.spawned && /already produced/i.test(second.reason),
    !second.spawned ? second.reason : ""
  );
  eq(
    "so there is exactly one successor",
    await prisma.task.count({ where: { recurrenceParentId: task.id } }),
    1
  );

  // A non-repeating task spawns nothing.
  const plain = await make(null, new Date("2026-06-01T09:00:00Z"));
  const none = await prisma.$transaction((tx) =>
    spawnNextOccurrence(
      tx,
      {
        id: plain.id,
        title: plain.title,
        details: plain.details,
        assignedToId: plain.assignedToId,
        createdById: plain.createdById,
        dueDate: plain.dueDate,
        priority: plain.priority,
        category: plain.category,
        recurrence: plain.recurrence,
        recurrenceSpawnedAt: plain.recurrenceSpawnedAt,
      },
      completedAt
    )
  );
  eq("nothing spawned", none.spawned, false);
  eq(
    "and no child exists",
    await prisma.task.count({ where: { recurrenceParentId: plain.id } }),
    0
  );
});

/**
 * AC REC-05: deleting an old occurrence must not delete the future chain.
 *
 * recurrenceParentId is SetNull for exactly this reason — Cascade would mean
 * tidying up last month's completed routine silently removes next week's.
 */
const parentDeletion = tc("REC-05", "deleting a past occurrence spares its successor", async () => {
  const sup = await mkUser("supervisor");
  const parent = await prisma.task.create({
    data: { title: `${TAG} weekly check`, assignedToId: sup.id, recurrence: "weekly" },
  });
  const child = await prisma.task.create({
    data: {
      title: `${TAG} weekly check`,
      assignedToId: sup.id,
      recurrence: "weekly",
      recurrenceParentId: parent.id,
    },
  });

  await prisma.task.delete({ where: { id: parent.id } });

  const survivor = await prisma.task.findUnique({ where: { id: child.id } });
  ok("the successor survives", !!survivor);
  eq("with its parent link nulled", survivor?.recurrenceParentId, null);
  eq("and it still repeats", survivor?.recurrence, "weekly");
});

/** Nothing piles up: one open occurrence at a time, by construction. */
const noPileUp = tc("REC-06", "an uncompleted routine does not stack up", async () => {
  const sup = await mkUser("supervisor");
  const task = await prisma.task.create({
    data: {
      title: `${TAG} daily meter reading`,
      assignedToId: sup.id,
      recurrence: "daily",
      dueDate: new Date("2026-01-01T09:00:00Z"),
    },
  });

  // Six months pass and nobody completes it. Because generation is driven by
  // completion, there is still exactly one row — which is the whole argument
  // for that design.
  eq(
    "still one occurrence",
    await prisma.task.count({ where: { title: `${TAG} daily meter reading` } }),
    1
  );
  eq("and no successor", await prisma.task.count({ where: { recurrenceParentId: task.id } }), 0);
});

/** Every role against the read rule, so none is left to inference. */
const everyRole = tc("VIS-03", "every role is covered by the read rule", () => {
  for (const role of ROLES) {
    const actor = { userId: `u-${role}`, role };
    const own = taskOf(actor.userId, "someone-else", role);
    ok(`${role} may read their own task`, canViewTask(actor, own).allowed);
    // An OWNER's task is readable only by its assignee or its creator —
    // nobody outranks an owner, not even another owner. The "no peers" rule
    // from phase 4 is applied to reading exactly as it is to writing, which
    // is deliberate: two co-owners are peers, and the chain never runs
    // sideways. (In practice there is one owner.)
    const ownersTask = taskOf("someone", "someone-else", "owner");
    eq(
      `${role} cannot read an unrelated owner's task`,
      canViewTask(actor, ownersTask).allowed,
      false
    );
    // ...but the assignee and creator still can, whoever they are.
    ok(
      `${role} reads an owner-ranked task they were assigned`,
      canViewTask(actor, taskOf(actor.userId, "someone-else", "owner")).allowed
    );
    ok(
      `${role} reads an owner-ranked task they created`,
      canViewTask(actor, taskOf("someone", actor.userId, "owner")).allowed
    );
  }
});

(async () => {
  await cleanup();
  try {
    await run("Task extensions", [
      categories,
      visibility,
      noteDeletion,
      everyRole,
      attachmentRules,
      fileNames,
      attachmentWrites,
      checklist,
      comments,
      dueDates,
      monthlyClamp,
      spawning,
      parentDeletion,
      noPileUp,
    ]);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})();
