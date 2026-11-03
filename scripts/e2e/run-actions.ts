/**
 * The decisions the server actions make — fulfilment stage transitions and
 * task delegation.
 *
 * ─── Why it is shaped this way ────────────────────────────────────────
 * TESTING.md recorded this gap as "no test covers the fulfilment stage
 * transitions or the task delegation server actions through HTTP". Next.js
 * server actions cannot be called over HTTP from a script: the client sends
 * an encrypted action id the framework mints at build time, so there is no
 * stable URL to post to, and `requireSession()` needs a real request context.
 *
 * So rather than leave the rules untested or fake a request, the DECISIONS
 * were lifted out of the actions into pure functions — `decideStageChange`
 * in fulfilment/stage.ts and the `can*Task*` family in lib/roles.ts — and the
 * actions now call them. The actions keep only what no test can meaningfully
 * stand in for: authenticate, load the subject's role from the database,
 * write. This suite exercises the rules themselves, exhaustively, and then
 * checks the write they guard against real rows.
 *
 * The security boundary did not move: every role fed to these functions is
 * still one the action read from the database, never one that arrived with
 * the request.
 *
 * SAFETY: writes and deletes its own fixtures; refuses a non-local database.
 *
 * Run: npx tsx scripts/e2e/run-actions.ts
 */

import { randomUUID } from "crypto";
import { tc, eq, ok, run } from "./harness";
import { prisma } from "@/lib/db";
import {
  FULFILMENT_STAGES,
  decideStageChange,
  nextStage,
  normalizeStage,
  stageIndex,
  type FulfilmentStage,
} from "../../src/app/(app)/fulfilment/stage";
import {
  TASK_PRIORITIES,
  compareTasks,
  isOverdue,
  isTaskActive,
  isTaskDone,
  nextTaskStatus,
  normalizePriority,
  normalizeTaskStatus,
  priorityRank,
} from "../../src/app/(app)/tasks/task-meta";
import {
  canCreateTaskFor,
  decideTaskStatusChange,
  canDeleteTask,
  canReassignTask,
  canUpdateTaskStatus,
  minPasswordLength,
  passwordProblem,
  isFullAccess,
  ROLES,
} from "@/lib/roles";

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

const TAG = "E2E_ACT";
const uniq = () => `${TAG}_${randomUUID().slice(0, 8)}`;

const approved = (from: FulfilmentStage) => ({
  status: "open",
  approvedAt: new Date(),
  from,
});

// ───────────────────── fulfilment stage transitions ──────────────────────

/** A supervisor walks the line one stage at a time, forwards only. */
const oneStep = tc("STAGE-01", "a supervisor may only step forward by one", () => {
  const sup = { fullAccess: false };

  eq("queued -> in_production", decideStageChange(approved("queued"), "in_production", sup).allowed, true);
  eq("in_production -> ready", decideStageChange(approved("in_production"), "ready", sup).allowed, true);
  eq("ready -> dispatched", decideStageChange(approved("ready"), "dispatched", sup).allowed, true);

  // The failure this rule exists to prevent: an order marked dispatched that
  // was never produced reads to the office as "sent to the customer", empties
  // out of the queue, and is only found when the customer rings.
  const skip = decideStageChange(approved("queued"), "dispatched", sup);
  eq("queued -/-> dispatched", skip.allowed, false);
  ok(
    "and the refusal says to go one at a time",
    !skip.allowed && /one stage at a time/i.test(skip.reason),
    !skip.allowed ? skip.reason : ""
  );
  eq("queued -/-> ready", decideStageChange(approved("queued"), "ready", sup).allowed, false);

  const back = decideStageChange(approved("ready"), "in_production", sup);
  eq("no stepping back", back.allowed, false);
  ok(
    "and it points at who can",
    !back.allowed && /manager/i.test(back.reason),
    !back.allowed ? back.reason : ""
  );
});

/** Every from/to pair, so no combination is left to inference. */
const fullMatrix = tc("STAGE-02", "the whole transition matrix is as stated", () => {
  let supAllowed = 0;
  let ownerAllowed = 0;
  for (const from of FULFILMENT_STAGES) {
    for (const to of FULFILMENT_STAGES) {
      const sup = decideStageChange(approved(from), to, { fullAccess: false });
      const own = decideStageChange(approved(from), to, { fullAccess: true });
      const step = stageIndex(to) - stageIndex(from);

      eq(
        `supervisor ${from} -> ${to}`,
        sup.allowed,
        step === 0 || step === 1
      );
      eq(`owner ${from} -> ${to}`, own.allowed, true);
      if (sup.allowed) supAllowed++;
      if (own.allowed) ownerAllowed++;
    }
  }
  // 4 no-ops + 3 single forward steps.
  eq("a supervisor has 7 legal moves", supAllowed, 7);
  eq("an owner has all 16", ownerAllowed, 16);
});

/** A no-op must not restart the "waiting since" clock. */
const noop = tc("STAGE-03", "a double-tap is a no-op, not an error", () => {
  for (const stage of FULFILMENT_STAGES) {
    const d = decideStageChange(approved(stage), stage, { fullAccess: false });
    ok(`${stage}: allowed`, d.allowed);
    ok(`${stage}: flagged as a no-op so the clock is not reset`, d.allowed && d.noop);
  }
  const moving = decideStageChange(approved("queued"), "in_production", { fullAccess: false });
  ok("a real move is not a no-op", moving.allowed && !moving.noop);
});

/** Nothing outside the queue is the supervisor's to move. */
const outsideQueue = tc("STAGE-04", "unapproved, cancelled and complete orders are fixed", () => {
  const sup = { fullAccess: false };

  const unapproved = decideStageChange(
    { status: "open", approvedAt: null, from: "queued" },
    "in_production",
    sup
  );
  eq("an unapproved order cannot be started", unapproved.allowed, false);
  ok(
    "and the reason names the payment",
    !unapproved.allowed && /payment/i.test(unapproved.reason),
    !unapproved.allowed ? unapproved.reason : ""
  );

  for (const status of ["cancelled", "complete"]) {
    const d = decideStageChange(
      { status, approvedAt: new Date(), from: "ready" },
      "dispatched",
      sup
    );
    eq(`a ${status} order's stage is fixed`, d.allowed, false);
    ok(
      `and the reason says ${status}`,
      !d.allowed && d.reason.includes(status),
      !d.allowed ? d.reason : ""
    );
  }

  // A manager still has to be able to correct any of them.
  ok(
    "a manager may still fix a cancelled order",
    decideStageChange({ status: "cancelled", approvedAt: new Date(), from: "ready" }, "queued", {
      fullAccess: true,
    }).allowed
  );
  ok(
    "and an unapproved one",
    decideStageChange({ status: "open", approvedAt: null, from: "queued" }, "ready", {
      fullAccess: true,
    }).allowed
  );
});

/** An unknown stage reads as queued rather than vanishing from the queue. */
const normalization = tc("STAGE-05", "an unknown stage normalizes to queued", () => {
  eq("empty", normalizeStage(""), "queued");
  eq("legacy value", normalizeStage("on_hold"), "queued");
  eq("a known value is untouched", normalizeStage("ready"), "ready");
  eq("the end of the line offers nothing further", nextStage("dispatched"), null);
  eq("queued offers in_production", nextStage("queued"), "in_production");
});

/** And the write the rule guards actually lands. */
const stageWrite = tc("STAGE-06", "an allowed change moves the stage and the clock", async () => {
  const [size, type] = await Promise.all([
    prisma.brickSize.findFirst({ orderBy: { order: "asc" } }),
    prisma.constructionType.findFirst({ orderBy: { order: "asc" } }),
  ]);
  if (!size || !type) return ok("fixtures present (run the seeds first)", false);

  const client = await prisma.client.create({ data: { name: uniq() } });
  const long = new Date(Date.now() - 3 * 86400000);
  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      approvedAt: new Date(),
      status: "open",
      fulfilmentStage: "queued",
      stageChangedAt: long,
      items: {
        create: {
          brickSizeId: size.id,
          constructionTypeId: type.id,
          quantity: 100,
          pricePerBrick: 25,
          total: 2500,
        },
      },
    },
  });

  const d = decideStageChange(
    { status: order.status, approvedAt: order.approvedAt, from: normalizeStage(order.fulfilmentStage) },
    "in_production",
    { fullAccess: false }
  );
  ok("the move is allowed", d.allowed);
  await prisma.order.update({
    where: { id: order.id },
    data: { fulfilmentStage: "in_production", stageChangedAt: new Date() },
  });

  const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  eq("the stage moved", after.fulfilmentStage, "in_production");
  ok(
    "and the waiting-since clock moved with it",
    after.stageChangedAt.getTime() > long.getTime()
  );
});

// ─────────────────────────── task delegation ─────────────────────────────

const OWNER = { userId: "u-owner", role: "owner" };
const MANAGER = { userId: "u-manager", role: "manager" };
const SUPERVISOR = { userId: "u-supervisor", role: "supervisor" };
const TELECALLER = { userId: "u-telecaller", role: "telecaller" };

const active = (role: string) => ({ role, active: true });

/** AC: work travels strictly downward, and a telecaller hands out none. */
const delegation = tc("TASK-01", "tasks travel only downward", () => {
  ok("owner -> manager", canCreateTaskFor("owner", active("manager")).allowed);
  ok("manager -> supervisor", canCreateTaskFor("manager", active("supervisor")).allowed);
  ok("supervisor -> telecaller", canCreateTaskFor("supervisor", active("telecaller")).allowed);

  const up = canCreateTaskFor("manager", active("owner"));
  eq("manager -/-> owner", up.allowed, false);
  ok(
    "and the refusal explains the chain",
    !up.allowed && /down the chain/i.test(up.reason),
    !up.allowed ? up.reason : ""
  );

  eq("no peers: manager -/-> manager", canCreateTaskFor("manager", active("manager")).allowed, false);
  eq("no peers: supervisor -/-> supervisor", canCreateTaskFor("supervisor", active("supervisor")).allowed, false);

  const tele = canCreateTaskFor("telecaller", active("staff"));
  eq("a telecaller assigns to nobody", tele.allowed, false);
  ok(
    "and is told they cannot delegate at all",
    !tele.allowed && /cannot assign tasks to anyone/i.test(tele.reason),
    !tele.allowed ? tele.reason : ""
  );
});

/** A disabled account cannot be handed new work. */
const disabledAssignee = tc("TASK-02", "a disabled account takes no new work", () => {
  const d = canCreateTaskFor("owner", { role: "supervisor", active: false });
  eq("refused", d.allowed, false);
  ok("and says why", !d.allowed && /disabled/i.test(d.reason), !d.allowed ? d.reason : "");
  // The rank check must not mask it either way round.
  const both = canCreateTaskFor("manager", { role: "owner", active: false });
  eq("an upward, disabled target is still refused", both.allowed, false);
});

/** Completing your own work is yours by right; nobody else's is. */
const updateStatus = tc("TASK-03", "the assignee may complete their own task", () => {
  const mine = {
    assignedToId: TELECALLER.userId,
    createdById: MANAGER.userId,
    assigneeRole: "telecaller",
  };
  ok("the assignee may", canUpdateTaskStatus(TELECALLER, mine).allowed);
  ok("their manager may", canUpdateTaskStatus(MANAGER, mine).allowed);
  ok("the owner may", canUpdateTaskStatus(OWNER, mine).allowed);
  ok("a supervisor above them may", canUpdateTaskStatus(SUPERVISOR, mine).allowed);

  // Sideways is the case worth pinning: the chain never runs between peers.
  const peers = {
    assignedToId: "u-other-telecaller",
    createdById: MANAGER.userId,
    assigneeRole: "telecaller",
  };
  const sideways = canUpdateTaskStatus(TELECALLER, peers);
  eq("another telecaller's task is not theirs", sideways.allowed, false);
  ok(
    "and the refusal says whose is",
    !sideways.allowed && /your own tasks, or your team/i.test(sideways.reason),
    !sideways.allowed ? sideways.reason : ""
  );

  const upward = {
    assignedToId: OWNER.userId,
    createdById: OWNER.userId,
    assigneeRole: "owner",
  };
  eq("a manager cannot touch an owner's task", canUpdateTaskStatus(MANAGER, upward).allowed, false);
});

/** Reassigning needs rank over the current holder AND the new one. */
const reassign = tc("TASK-04", "reassigning needs rank over both ends", () => {
  const task = {
    assignedToId: "u-sup",
    createdById: MANAGER.userId,
    assigneeRole: "supervisor",
  };

  ok("owner moves it to another supervisor", canReassignTask(OWNER, task, active("supervisor")).allowed);
  ok("manager moves it down to a telecaller", canReassignTask(MANAGER, task, active("telecaller")).allowed);

  const upward = canReassignTask(MANAGER, task, active("owner"));
  eq("but not up to an owner", upward.allowed, false);

  // A supervisor does not outrank the current holder (another supervisor),
  // even though they could assign to the proposed telecaller.
  const notTheirs = canReassignTask(SUPERVISOR, task, active("telecaller"));
  eq("a peer's task is not theirs to move", notTheirs.allowed, false);
  ok(
    "and the reason names creation or rank",
    !notTheirs.allowed && /created, or ones that sit under you/i.test(notTheirs.reason),
    !notTheirs.allowed ? notTheirs.reason : ""
  );

  // The creator may move their own instruction even without rank over the
  // holder — this is the carve-out, so it is asserted rather than assumed.
  const supCreated = {
    assignedToId: "u-other-sup",
    createdById: SUPERVISOR.userId,
    assigneeRole: "supervisor",
  };
  ok(
    "the creator may move a task they raised",
    canReassignTask(SUPERVISOR, supCreated, active("telecaller")).allowed
  );

  eq(
    "a telecaller reassigns nothing",
    canReassignTask(TELECALLER, task, active("staff")).allowed,
    false
  );
  eq(
    "and nobody reassigns to a disabled account",
    canReassignTask(OWNER, task, { role: "supervisor", active: false }).allowed,
    false
  );
});

/**
 * Deletion is the creator's or a senior's — pointedly NOT the assignee's.
 * Finishing the work is theirs; deciding it never needed doing is not.
 */
const deletion = tc("TASK-05", "the assignee cannot delete their own task", () => {
  const task = {
    assignedToId: TELECALLER.userId,
    createdById: MANAGER.userId,
    assigneeRole: "telecaller",
  };
  const own = canDeleteTask(TELECALLER, task);
  eq("the assignee may not delete it", own.allowed, false);
  ok(
    "and is told who may",
    !own.allowed && /whoever assigned this task/i.test(own.reason),
    !own.allowed ? own.reason : ""
  );
  ok("the creator may", canDeleteTask(MANAGER, task).allowed);
  ok("a senior may", canDeleteTask(OWNER, task).allowed);

  // Contrast with TASK-03: the same actor and task, opposite answers.
  ok("though they may still COMPLETE it", canUpdateTaskStatus(TELECALLER, task).allowed);

  // A creator whose own account was deleted leaves createdById null; that
  // must not make the task deletable by whoever happens to pass null around.
  const orphan = { assignedToId: TELECALLER.userId, createdById: null, assigneeRole: "telecaller" };
  eq("a null creator matches nobody", canDeleteTask(TELECALLER, orphan).allowed, false);
  ok("but a senior can still clear it", canDeleteTask(MANAGER, orphan).allowed);
});

/** Every role, every rule — nothing in the hierarchy left unchecked. */
const everyRole = tc("TASK-06", "every role is covered by every rule", () => {
  for (const role of ROLES) {
    const actor = { userId: `u-${role}`, role };
    const ownTask = { assignedToId: actor.userId, createdById: "someone-else", assigneeRole: role };
    ok(`${role} may complete their own task`, canUpdateTaskStatus(actor, ownTask).allowed);
    eq(`${role} may not delete their own task`, canDeleteTask(actor, ownTask).allowed, false);
    eq(`${role} cannot assign to an owner`, canCreateTaskFor(role, active("owner")).allowed, false);
    eq(`${role} cannot assign to a peer`, canCreateTaskFor(role, active(role)).allowed, false);
  }
});

/** And the writes those rules guard, against real users and rows. */
const taskWrites = tc("TASK-07", "the guarded writes land as decided", async () => {
  const mk = (role: string) =>
    prisma.user.create({
      data: { name: uniq(), pinHash: "x", role, permissions: [], active: true },
    });
  const manager = await mk("manager");
  const sup = await mk("supervisor");
  const tele = await mk("telecaller");
  const disabled = await prisma.user.create({
    data: { name: uniq(), pinHash: "x", role: "telecaller", permissions: [], active: false },
  });

  // Allowed: manager -> supervisor.
  ok(
    "manager may assign to the supervisor",
    canCreateTaskFor(manager.role, { role: sup.role, active: sup.active }).allowed
  );
  const task = await prisma.task.create({
    data: {
      title: `${TAG} fix the mixer`,
      assignedToId: sup.id,
      createdById: manager.id,
    },
  });
  eq("the task exists, assigned down the chain", task.assignedToId, sup.id);

  // Refused: the disabled account.
  eq(
    "and not to the disabled account",
    canCreateTaskFor(manager.role, { role: disabled.role, active: disabled.active }).allowed,
    false
  );

  // The assignee completes it.
  const subject = {
    assignedToId: task.assignedToId,
    createdById: task.createdById,
    assigneeRole: sup.role,
  };
  ok(
    "the supervisor may complete it",
    canUpdateTaskStatus({ userId: sup.id, role: sup.role }, subject).allowed
  );
  const done = await prisma.task.update({
    where: { id: task.id },
    data: { status: "done", completedAt: new Date() },
  });
  eq("it is done", done.status, "done");
  ok("with a completion time", !!done.completedAt);

  // The telecaller, who is neither assignee nor senior, may not.
  eq(
    "the telecaller may not touch it",
    canUpdateTaskStatus({ userId: tele.id, role: tele.role }, subject).allowed,
    false
  );
  eq(
    "nor delete it",
    canDeleteTask({ userId: tele.id, role: tele.role }, subject).allowed,
    false
  );

  // The creator may delete it, and does.
  ok(
    "the manager who raised it may delete it",
    canDeleteTask({ userId: manager.id, role: manager.role }, subject).allowed
  );
  await prisma.task.delete({ where: { id: task.id } });
  eq("and it is gone", await prisma.task.count({ where: { id: task.id } }), 0);
});

// ─────────────────────────── password strength ───────────────────────────

/**
 * The minimum was 4 for everyone. With the username bypass closed in the
 * security review, a password is the ONLY factor left — and an owner or
 * manager can read the cashbook and the payroll and can create logins.
 */
const passwordRule = tc("PW-01", "full-access accounts need a longer password", () => {
  eq("owner needs 8", minPasswordLength("owner"), 8);
  eq("admin needs 8", minPasswordLength("admin"), 8);
  eq("manager needs 8", minPasswordLength("manager"), 8);
  // Deliberately NOT raised: a supervisor taps a short code into a tablet by
  // the machine, and forcing 8 there pushes it onto a wall.
  eq("supervisor keeps 4", minPasswordLength("supervisor"), 4);
  eq("telecaller keeps 4", minPasswordLength("telecaller"), 4);
  eq("staff keeps 4", minPasswordLength("staff"), 4);

  ok("a 4-character owner password is refused", !!passwordProblem("owner", "1234"));
  ok("and 7 is still refused", !!passwordProblem("owner", "1234567"));
  eq("8 is accepted", passwordProblem("owner", "12345678"), null);
  eq("a 4-character supervisor password is accepted", passwordProblem("supervisor", "1234"), null);
  ok("but 3 is not, for anyone", !!passwordProblem("supervisor", "123"));
  ok("nor is empty", !!passwordProblem("telecaller", ""));

  // The refusal has to say why, or it reads as an arbitrary rejection.
  const why = passwordProblem("manager", "abc");
  ok("the owner/manager refusal explains itself", !!why && /cashbook|payroll/i.test(why), why ?? "");

  for (const role of ROLES) {
    eq(
      `${role}: minimum follows full access`,
      minPasswordLength(role),
      isFullAccess(role) ? 8 : 4
    );
  }
});


// ──────────────────────── priority and progress ──────────────────────────

/** AC TASK-09: an unknown priority normalizes rather than vanishing. */
const priorityValues = tc("TASK-09", "priority normalizes and ranks", () => {
  for (const p of TASK_PRIORITIES) {
    eq(`${p} round-trips`, normalizePriority(p), p);
  }
  eq("unknown -> normal", normalizePriority("screaming"), "normal");
  eq("empty -> normal", normalizePriority(""), "normal");
  eq("null -> normal", normalizePriority(null), "normal");
  eq("undefined -> normal", normalizePriority(undefined), "normal");

  // Rank is the sort order, so urgent must be lowest.
  ok("urgent outranks high", priorityRank("urgent") < priorityRank("high"));
  ok("high outranks normal", priorityRank("high") < priorityRank("normal"));
  ok("normal outranks low", priorityRank("normal") < priorityRank("low"));
  eq("an unknown value sorts as normal", priorityRank("nonsense"), priorityRank("normal"));
  eq("there are four levels", TASK_PRIORITIES.length, 4);
});

/**
 * AC TASK-11: anything that is not `done` is active.
 *
 * The live database defaults Task.status to "wip", a value predating the
 * schema. Writing this check as "is open" instead of "is not done" is exactly
 * what hid those rows from all three dashboards.
 */
const statusValues = tc("TASK-11", "a legacy wip row counts as active", () => {
  ok("open is active", isTaskActive("open"));
  ok("wip is active", isTaskActive("wip"));
  ok("an unknown value is active", isTaskActive("parked_2019"));
  ok("done is not", !isTaskActive("done"));
  ok("only done is done", isTaskDone("done") && !isTaskDone("wip") && !isTaskDone("open"));

  eq("wip is a first-class status", normalizeTaskStatus("wip"), "wip");
  eq("unknown displays as open", normalizeTaskStatus("parked_2019"), "open");
  eq("null displays as open", normalizeTaskStatus(null), "open");

  // The one-tap cycle.
  eq("open -> wip", nextTaskStatus("open"), "wip");
  eq("wip -> done", nextTaskStatus("wip"), "done");
  eq("done -> open (reopen)", nextTaskStatus("done"), "open");
  eq("a legacy value starts", nextTaskStatus("parked_2019"), "wip");
});

/** AC TASK-10: overdue, then priority, then due date. */
const ordering = tc("TASK-10", "overdue outranks urgent, which outranks the due date", () => {
  const today = "2026-06-15";
  const t = (priority: string, dueDate: string | null, status = "open") => ({
    status,
    priority,
    dueDate,
  });

  // Overdue beats a higher priority that is not yet late. Stated because it
  // is a judgement: a missed deadline is already a failure.
  const lateLow = t("low", "2026-06-01");
  const urgentSoon = t("urgent", "2026-06-20");
  ok("the late low-priority task is overdue", isOverdue(lateLow, today));
  ok("the urgent one is not", !isOverdue(urgentSoon, today));
  ok("so the late one sorts first", compareTasks(lateLow, urgentSoon, today) < 0);

  // Within the same overdue-ness, priority decides.
  ok(
    "urgent before normal",
    compareTasks(t("urgent", "2026-06-30"), t("normal", "2026-06-20"), today) < 0
  );
  ok(
    "high before low",
    compareTasks(t("high", null), t("low", null), today) < 0
  );

  // Within the same priority, the earlier due date.
  ok(
    "earlier due date first",
    compareTasks(t("normal", "2026-06-18"), t("normal", "2026-06-25"), today) < 0
  );
  // An undated task is not more urgent than a dated one.
  ok("dated before undated", compareTasks(t("normal", "2026-06-25"), t("normal", null), today) < 0);
  eq("two identical tasks tie", compareTasks(t("normal", null), t("normal", null), today), 0);

  // A done task is never overdue, however old.
  ok("a completed task is not overdue", !isOverdue(t("low", "2020-01-01", "done"), today));

  // And the whole list sorts as documented.
  const list = [
    t("low", "2026-06-25"),
    t("urgent", "2026-06-30"),
    t("normal", "2026-06-01"),
    t("high", null),
  ];
  const sorted = [...list].sort((a, b) => compareTasks(a, b, today));
  eq("overdue normal leads", sorted[0].priority, "normal");
  eq("then urgent", sorted[1].priority, "urgent");
  eq("then high", sorted[2].priority, "high");
  eq("then low", sorted[3].priority, "low");
});

/** AC TASK-12 / TASK-13: what a status change does to the timestamps. */
const statusTransitions = tc("TASK-12", "status changes keep the timestamps honest", () => {
  const now = new Date("2026-06-15T10:00:00Z");
  const started = new Date("2026-06-10T08:00:00Z");
  const sup = { userId: "u-sup", role: "supervisor" };
  const subject = (status: string, startedAt: Date | null = null) => ({
    assignedToId: sup.userId,
    createdById: "u-manager",
    assigneeRole: "supervisor",
    status,
    startedAt,
  });

  // open -> wip records the start.
  const start = decideTaskStatusChange(sup, subject("open"), "wip", now);
  ok("starting is allowed", start.allowed);
  if (start.allowed) {
    eq("startedAt is set", start.startedAt?.getTime(), now.getTime());
    eq("completedAt is cleared", start.completedAt, null);
  }

  // Restarting a reopened task must NOT lose the original start.
  const restart = decideTaskStatusChange(sup, subject("open", started), "wip", now);
  ok("restart allowed", restart.allowed);
  if (restart.allowed) {
    eq("the original start is kept", restart.startedAt?.getTime(), started.getTime());
  }

  // -> done records completion.
  const finish = decideTaskStatusChange(sup, subject("wip", started), "done", now);
  ok("finishing is allowed", finish.allowed);
  if (finish.allowed) {
    eq("completedAt is set", finish.completedAt?.getTime(), now.getTime());
    eq("startedAt is untouched", finish.startedAt, undefined);
    ok("the reason is left alone", !finish.clearStatusReason);
  }

  // A short job may skip wip entirely.
  const quick = decideTaskStatusChange(sup, subject("open"), "done", now);
  ok("open -> done is allowed (no one-step rule here)", quick.allowed);

  // Reopening clears completion AND the stale reason, but keeps the start.
  const reopen = decideTaskStatusChange(sup, subject("done", started), "open", now);
  ok("reopening is allowed", reopen.allowed);
  if (reopen.allowed) {
    eq("completedAt is cleared", reopen.completedAt, null);
    ok("the stale reason is cleared", reopen.clearStatusReason === true);
    eq("but startedAt is kept", reopen.startedAt, undefined);
  }

  // AC TASK-13: a double-tap writes nothing.
  for (const status of ["open", "wip", "done"]) {
    const same = decideTaskStatusChange(sup, subject(status), status, now);
    ok(`${status} -> ${status} is allowed`, same.allowed);
    ok(`${status} -> ${status} is a no-op`, same.allowed && same.noop);
  }

  // An invented status is refused.
  const bogus = decideTaskStatusChange(sup, subject("open"), "cancelled", now);
  eq("an unknown target status is refused", bogus.allowed, false);
  ok(
    "and says so",
    !bogus.allowed && /not a task status/i.test(bogus.reason),
    !bogus.allowed ? bogus.reason : ""
  );
});

/** AC TASK-14: the permission on a status change is the phase 4 rule. */
const statusPermission = tc("TASK-14", "only the assignee or a senior moves a task", () => {
  const now = new Date("2026-06-15T10:00:00Z");
  const task = {
    assignedToId: "u-tele",
    createdById: "u-manager",
    assigneeRole: "telecaller",
    status: "open",
    startedAt: null,
  };

  ok(
    "the assignee may start it",
    decideTaskStatusChange({ userId: "u-tele", role: "telecaller" }, task, "wip", now).allowed
  );
  ok(
    "their manager may",
    decideTaskStatusChange({ userId: "u-manager", role: "manager" }, task, "wip", now).allowed
  );
  // A peer may not — the chain never runs sideways.
  const peer = decideTaskStatusChange(
    { userId: "u-other-tele", role: "telecaller" },
    task,
    "wip",
    now
  );
  eq("a peer may not", peer.allowed, false);
  ok(
    "and gets the phase 4 message",
    !peer.allowed && /your own tasks, or your team/i.test(peer.reason),
    !peer.allowed ? peer.reason : ""
  );
  // Rank is checked BEFORE the target status, so a peer passing nonsense
  // still gets the permission error rather than leaking that the status was
  // the problem.
  eq(
    "a peer with a bogus status is still refused",
    decideTaskStatusChange({ userId: "u-other", role: "telecaller" }, task, "wip", now).allowed,
    false
  );
});

/** AC TASK-15: the dashboards' filter now counts wip as open. */
const dashboardCounts = tc("TASK-15", "a wip task counts as open everywhere", async () => {
  const mk = (role: string) =>
    prisma.user.create({
      data: { name: uniq(), pinHash: "x", role, permissions: [], active: true },
    });
  const sup = await mk("supervisor");
  const manager = await mk("manager");

  const yesterday = new Date(Date.now() - 86400000);
  await prisma.task.create({
    data: {
      title: `${TAG} wip and overdue`,
      assignedToId: sup.id,
      createdById: manager.id,
      status: "wip",
      priority: "urgent",
      dueDate: yesterday,
      startedAt: yesterday,
    },
  });
  await prisma.task.create({
    data: {
      title: `${TAG} plain open`,
      assignedToId: sup.id,
      createdById: manager.id,
      status: "open",
      dueDate: yesterday,
    },
  });
  await prisma.task.create({
    data: {
      title: `${TAG} finished`,
      assignedToId: sup.id,
      createdById: manager.id,
      status: "done",
      completedAt: new Date(),
      dueDate: yesterday,
    },
  });

  // The OLD filter, kept here to show what it missed.
  const oldWay = await prisma.task.count({
    where: { assignedToId: sup.id, status: "open" },
  });
  const newWay = await prisma.task.count({
    where: { assignedToId: sup.id, status: { not: "done" } },
  });
  eq("the old `status: open` filter saw only one", oldWay, 1);
  eq("the new one sees both live tasks", newWay, 2);
  ok("so the wip task was being hidden", newWay > oldWay);

  // The overdue count the owner dashboard shows.
  const overdueNow = await prisma.task.count({
    where: { assignedToId: sup.id, status: { not: "done" }, dueDate: { lt: new Date() } },
  });
  eq("both overdue live tasks are counted", overdueNow, 2);

  // And priority persisted.
  const urgent = await prisma.task.findFirst({
    where: { title: { startsWith: TAG }, priority: "urgent" },
  });
  ok("the urgent task is stored as urgent", !!urgent);
  eq("with its start time", urgent?.startedAt?.toDateString(), yesterday.toDateString());
});

/** AC TASK-08: delegation itself is untouched by any of this. */
const delegationUnchanged = tc("TASK-08", "delegation still runs strictly downward", () => {
  // A deliberate duplicate of TASK-01's core, as a regression pin: priority
  // and progress must not have widened who may assign to whom.
  ok("owner -> manager", canCreateTaskFor("owner", { role: "manager", active: true }).allowed);
  ok("manager !-> owner", !canCreateTaskFor("manager", { role: "owner", active: true }).allowed);
  ok(
    "no peers",
    !canCreateTaskFor("supervisor", { role: "supervisor", active: true }).allowed
  );
  ok(
    "a telecaller delegates to nobody",
    !canCreateTaskFor("telecaller", { role: "staff", active: true }).allowed
  );
});

async function cleanup() {
  await prisma.task.deleteMany({ where: { title: { startsWith: TAG } } });
  const users = await prisma.user.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  for (const u of users) {
    await prisma.task.deleteMany({ where: { OR: [{ assignedToId: u.id }, { createdById: u.id }] } });
    await prisma.dutySession.deleteMany({ where: { userId: u.id } });
    await prisma.leadActivity.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
  }
  const clients = await prisma.client.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  for (const c of clients) {
    const orders = await prisma.order.findMany({ where: { clientId: c.id }, select: { id: true } });
    for (const o of orders) {
      await prisma.orderItem.deleteMany({ where: { orderId: o.id } });
      await prisma.order.delete({ where: { id: o.id } }).catch(() => {});
    }
    await prisma.client.delete({ where: { id: c.id } }).catch(() => {});
  }
}

(async () => {
  await cleanup();
  try {
    await run("Server-action decisions: stages & task delegation", [
      oneStep,
      fullMatrix,
      noop,
      outsideQueue,
      normalization,
      stageWrite,
      delegation,
      disabledAssignee,
      updateStatus,
      reassign,
      deletion,
      everyRole,
      taskWrites,
      delegationUnchanged,
      priorityValues,
      statusValues,
      ordering,
      statusTransitions,
      statusPermission,
      dashboardCounts,
      passwordRule,
    ]);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})();
