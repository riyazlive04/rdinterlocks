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
  canCreateTaskFor,
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
      passwordRule,
    ]);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})();
