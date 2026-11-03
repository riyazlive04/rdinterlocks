/**
 * Permission center — build-docs/features/permission-center.md
 *
 * Two halves, the same split as run-actions.ts: the refusal rules are pure
 * functions (`canSetUserAreas`, `canAdministerUser`, `canConferRole`) and are
 * tested directly, and the grant arithmetic is tested against real rows
 * because its whole job is to write `User.permissions` correctly.
 *
 * SAFETY: writes and deletes its own fixtures; refuses a non-local database.
 *
 * Run: npx tsx scripts/e2e/run-permissions.ts
 */

import { randomUUID } from "crypto";
import { tc, eq, ok, run } from "./harness";
import { prisma } from "@/lib/db";
import {
  ACCESS_AREAS,
  AREA_GROUPS,
  can,
  groupedAreas,
  isAdmin,
  isAreaKey,
} from "@/lib/access";
import {
  canAdministerUser,
  canConferRole,
  canSetUserAreas,
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

const TAG = "E2E_PERM";
const uniq = () => `${TAG}_${randomUUID().slice(0, 8)}`;

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  for (const u of users) {
    await prisma.dutySession.deleteMany({ where: { userId: u.id } });
    await prisma.task.deleteMany({ where: { OR: [{ assignedToId: u.id }, { createdById: u.id }] } });
    await prisma.leadActivity.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
  }
}

const mkUser = (role: string, permissions: string[] = []) =>
  prisma.user.create({
    data: { name: uniq(), pinHash: "x", role, permissions, active: true },
  });

/**
 * The grant write, mirroring setUserArea's body.
 *
 * The action itself needs a request context (requireAdmin), so the suite
 * performs the same write and tests the refusals separately as decisions —
 * the same split used for the task and stage rules.
 */
async function setArea(userId: string, area: string, granted: boolean) {
  if (!isAreaKey(area)) throw new Error(`"${area}" is not an access area.`);
  const subject = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { permissions: true },
  });
  const next = new Set(subject.permissions);
  if (granted) next.add(area);
  else next.delete(area);
  await prisma.user.update({ where: { id: userId }, data: { permissions: [...next] } });
}

// ──────────────────────── the area/group mapping ─────────────────────────

/**
 * AC PERM-01: every area is in exactly one group.
 *
 * The failure this catches is silent and nasty: an area missing from the
 * group map simply does not render on either permission screen, which looks
 * identical to a revoked grant — so nobody can grant it and nobody can see
 * that they cannot.
 */
const coverage = tc("PERM-01", "every area is in exactly one group", () => {
  const groups = groupedAreas();
  const grouped = groups.flatMap((g) => g.areas.map((a) => a.key));

  eq("no area is listed twice", grouped.length, new Set(grouped).size);
  eq("every area is grouped", grouped.length, ACCESS_AREAS.length);

  const missing = ACCESS_AREAS.filter((a) => !grouped.includes(a.key)).map((a) => a.key);
  eq(`nothing ungrouped (got ${missing.join(", ") || "none"})`, missing.length, 0);

  // And nothing invented: a group naming an area that does not exist would
  // render a checkbox that can never be granted.
  const unknown = grouped.filter((k) => !isAreaKey(k));
  eq(`no phantom areas (got ${unknown.join(", ") || "none"})`, unknown.length, 0);

  for (const g of groups) {
    ok(`${g.key}: has areas`, g.areas.length > 0);
    ok(`${g.key}: is a declared group`, AREA_GROUPS.some((x) => x.key === g.key));
  }

  // The money gate is the one people get wrong, so it is pinned by name.
  const money = groups.find((g) => g.key === "money");
  ok("revenue is filed under Money", !!money?.areas.some((a) => a.key === "revenue"));
  ok("cash is filed under Money", !!money?.areas.some((a) => a.key === "cash"));
  const admin = groups.find((g) => g.key === "admin");
  ok("payroll is filed under Admin", !!admin?.areas.some((a) => a.key === "payroll"));
});

/** `isAreaKey` is the guard on the only write, so it is tested on its own. */
const areaKeyGuard = tc("PERM-05", "only real area keys are accepted", () => {
  ok("a real area", isAreaKey("cash"));
  ok("another", isAreaKey("die"));
  ok("not an empty string", !isAreaKey(""));
  ok("not a typo", !isAreaKey("cashh"));
  ok("not a role", !isAreaKey("manager"));
  ok("not a prototype key", !isAreaKey("__proto__"));
  ok("not a nav id that is not an area", !isAreaKey("collections"));
});

// ───────────────────────── the refusal rules ─────────────────────────────

const OWNER = { userId: "u-owner", role: "owner" };
const MANAGER = { userId: "u-manager", role: "manager" };

/** AC PERM-06: rank, in both directions. */
const rank = tc("PERM-06", "only an owner administers an owner", () => {
  ok("owner -> manager", canAdministerUser("owner", "manager"));
  ok("owner -> supervisor", canAdministerUser("owner", "supervisor"));
  ok("owner -> owner", canAdministerUser("owner", "owner"));
  ok("admin -> owner (same rank, legacy spelling)", canAdministerUser("admin", "owner"));
  ok("manager -> supervisor", canAdministerUser("manager", "supervisor"));
  ok("manager !-> owner", !canAdministerUser("manager", "owner"));
  ok("manager !-> admin", !canAdministerUser("manager", "admin"));
  // Nobody without Settings access administers anyone, whatever the subject.
  ok("supervisor !-> telecaller", !canAdministerUser("supervisor", "telecaller"));
  ok("telecaller !-> staff", !canAdministerUser("telecaller", "staff"));
});

/** AC PERM-09: owner rank is owner-only to confer. */
const conferral = tc("PERM-09", "only an owner grants owner rank", () => {
  ok("owner may mint an owner", canConferRole("owner", "owner"));
  ok("admin may mint an owner", canConferRole("admin", "admin"));
  ok("manager !-> owner", !canConferRole("manager", "owner"));
  ok("manager !-> admin", !canConferRole("manager", "admin"));
  // A manager CAN still create the roles the factory actually needs, which is
  // the point of the asymmetry costing them nothing operational.
  ok("manager -> manager", canConferRole("manager", "manager"));
  ok("manager -> supervisor", canConferRole("manager", "supervisor"));
  ok("manager -> telecaller", canConferRole("manager", "telecaller"));
  ok("a supervisor confers nothing", !canConferRole("supervisor", "telecaller"));
});

/** AC PERM-07 / PERM-08: self-edit, and full-access subjects. */
const setAreasRules = tc("PERM-07", "you cannot edit your own access, or a full-access user's", () => {
  // PERM-07 — self.
  const self = canSetUserAreas(OWNER, { id: OWNER.userId, role: "owner" });
  eq("an owner cannot edit their own areas", self.allowed, false);
  ok(
    "and is told to ask someone else",
    !self.allowed && /your own access/i.test(self.reason),
    !self.allowed ? self.reason : ""
  );

  // PERM-08 — a full-access subject stores no per-area grants.
  for (const role of ["owner", "admin", "manager"]) {
    const d = canSetUserAreas(OWNER, { id: "someone", role });
    eq(`${role}: areas are not settable`, d.allowed, false);
    ok(
      `${role}: the reason says change the role instead`,
      !d.allowed && /already see everything|change their role/i.test(d.reason),
      !d.allowed ? d.reason : ""
    );
  }

  // The ordinary case must still work.
  for (const role of ["supervisor", "telecaller", "staff"]) {
    ok(`${role}: an owner may set their areas`, canSetUserAreas(OWNER, { id: "x", role }).allowed);
    ok(`${role}: a manager may too`, canSetUserAreas(MANAGER, { id: "x", role }).allowed);
  }

  // Rank still applies through this path.
  eq(
    "a manager cannot reach an owner's areas",
    canSetUserAreas(MANAGER, { id: "o", role: "owner" }).allowed,
    false
  );
  // And nobody outside Settings reaches anyone's.
  eq(
    "a supervisor cannot set areas",
    canSetUserAreas({ userId: "s", role: "supervisor" }, { id: "t", role: "telecaller" }).allowed,
    false
  );
});

/** Every role against the rule, so none is left to inference. */
const everyRole = tc("PERM-11", "every role is covered by the grant rule", () => {
  for (const role of ROLES) {
    const d = canSetUserAreas(OWNER, { id: "subject", role });
    eq(
      `owner may set a ${role}'s areas iff they are not full access`,
      d.allowed,
      !isAdmin(role)
    );
  }
});

// ───────────────────────── against real rows ─────────────────────────────

/** AC PERM-02 / PERM-03 / PERM-04 / PERM-10. */
const grantWrites = tc("PERM-02", "granting and revoking an area", async () => {
  const u = await mkUser("telecaller", ["leads"]);

  // PERM-02 — grant.
  await setArea(u.id, "cash", true);
  let after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
  ok("the area is stored", after.permissions.includes("cash"));
  ok("and can() agrees", can({ role: after.role, permissions: after.permissions }, "cash"));
  ok("the area they already had is untouched", after.permissions.includes("leads"));

  // PERM-03 — granting twice does not duplicate.
  await setArea(u.id, "cash", true);
  after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
  eq("no duplicate grant", after.permissions.filter((p) => p === "cash").length, 1);

  // PERM-02 — revoke.
  await setArea(u.id, "cash", false);
  after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
  ok("the area is gone", !after.permissions.includes("cash"));
  ok("and can() agrees", !can({ role: after.role, permissions: after.permissions }, "cash"));
  ok("the unrelated grant survived", after.permissions.includes("leads"));

  // PERM-04 — revoking what they never had.
  const before = after.permissions.length;
  await setArea(u.id, "payroll", false);
  after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
  eq("revoking an ungranted area changes nothing", after.permissions.length, before);

  // PERM-10 — nothing else moved.
  eq("name unchanged", after.name, u.name);
  eq("role unchanged", after.role, u.role);
  eq("active unchanged", after.active, u.active);
});

/** AC PERM-05, at the write: a bad key must not reach the column. */
const badKeyRejected = tc("PERM-05b", "a bad area key writes nothing", async () => {
  const u = await mkUser("supervisor", ["production"]);
  let threw = false;
  try {
    await setArea(u.id, "not_an_area", true);
  } catch {
    threw = true;
  }
  ok("refused", threw);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
  eq("permissions untouched", after.permissions, ["production"]);
});

/**
 * A revoked area takes effect on the next request, not in 30 days.
 *
 * This is only true because the security review made sessions revocable —
 * role and permissions used to live in a 30-day JWT, so a grant change did
 * nothing to an open tab. Pinned here because the permission center is the
 * screen that makes the promise.
 */
const takesEffect = tc("PERM-12", "a revoked grant binds on the next read", async () => {
  const u = await mkUser("telecaller", ["leads", "cash"]);
  const stale = { role: u.role, permissions: u.permissions }; // what a cookie held
  ok("the old session claimed cash", can(stale, "cash"));

  await setArea(u.id, "cash", false);

  // What requireArea does: re-read the subject from the database.
  const fresh = await prisma.user.findUniqueOrThrow({
    where: { id: u.id },
    select: { role: true, permissions: true },
  });
  ok("the stored truth refuses it", !can(fresh, "cash"));
  ok("while the rest still works", can(fresh, "leads"));
});

(async () => {
  await cleanup();
  try {
    await run("Permission center", [
      coverage,
      areaKeyGuard,
      rank,
      conferral,
      setAreasRules,
      everyRole,
      grantWrites,
      badKeyRejected,
      takesEffect,
    ]);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})();
