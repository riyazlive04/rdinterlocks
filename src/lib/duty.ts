import { prisma } from "./db";
import { can } from "./access";

// Telecaller duty presence: who is on the phone right now, since when, and
// from where — and which of them the next lead should go to.
//
// ─── What this is NOT ─────────────────────────────────────────────────
// The first version of the requirement said telecallers rotate "every 15
// calls". That number turned out not to exist: one telecaller takes twenty,
// the next thirty, and nobody counts. What the owner actually asked for is
// "before they speak, it must be shown in the webapp who is speaking, from
// when and from where, so we provide the leads correctly to them." So there
// is no call counter anywhere in this file. An OPEN DutySession — endedAt
// null — is the whole eligibility rule: on duty means you can be handed a
// lead, off duty means you cannot.
//
// Nothing here throws for a business reason. Starting a shift when one is
// already open is a normal event (see startDuty), and "nobody is on duty" is
// a legitimate answer to routing, not a fault — see nextOnDutyTelecaller.

/** A user as the board and the router need them — enough to run `can`. */
export type DutyUser = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  permissions: string[];
};

export type OnDutyEntry = {
  id: string;
  userId: string;
  startedAt: Date;
  location: string;
  note: string;
  user: DutyUser;
};

const DUTY_USER_SELECT = {
  id: true,
  name: true,
  role: true,
  active: true,
  permissions: true,
} as const;

/**
 * The user's current open shift, or null when they are off duty.
 *
 * Ordered newest-first and taking one rather than asserting uniqueness: the
 * "at most one open session" rule is enforced by startDuty (below), not by a
 * database constraint, so this reads as the latest truth even if a row from
 * before that enforcement ever slipped through.
 */
export async function getOpenSession(userId: string) {
  return prisma.dutySession.findFirst({
    where: { userId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
}

/**
 * Every open shift with its user, oldest start first.
 *
 * One query serves both readers — the board renders it in this order (longest
 * on duty at the top) and nextOnDutyTelecaller routes off it — so the screen
 * and the router can never disagree about who is working.
 *
 * Inactive users are NOT filtered out here: a deactivated account with a
 * session still open is exactly the kind of stale row the board should show
 * so somebody closes it. Routing filters them itself.
 */
export async function listOnDuty(): Promise<OnDutyEntry[]> {
  const rows = await prisma.dutySession.findMany({
    where: { endedAt: null },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      startedAt: true,
      location: true,
      note: true,
      user: { select: DUTY_USER_SELECT },
    },
  });
  return rows;
}

/**
 * Clock a user in.
 *
 * At most one open session per user is enforced HERE, because it cannot be
 * enforced where it belongs: the rule is "unique userId where endedAt is
 * null", a Postgres partial unique index, and Prisma's schema language cannot
 * express one (see the note on DutySession.endedAt in prisma/schema.prisma).
 *
 * So starting a shift first CLOSES anything already open for that user, and
 * deliberately does not throw while doing it. A telecaller whose browser
 * crashed, whose phone died, or who simply forgot to clock out at 8pm has to
 * be able to clock back in without an admin — refusing them would make the
 * board wrong in the one direction that matters, showing nobody on duty while
 * somebody is answering the phone.
 *
 * The close and the open share ONE transaction, which is what actually makes
 * the invariant hold: two tabs double-clicking Start cannot interleave into
 * two open rows, because the loser's close runs against the winner's row
 * before its own insert.
 */
export async function startDuty(userId: string, location: string, note = "") {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.dutySession.updateMany({
      where: { userId, endedAt: null },
      // Closed at the moment the new shift begins, not at "now" computed
      // twice — otherwise the day's coverage shows a sub-second gap that
      // never existed.
      data: { endedAt: now },
    });
    return tx.dutySession.create({
      data: { userId, startedAt: now, location: location.trim(), note: note.trim() },
    });
  });
}

/**
 * Clock a user out. Returns how many sessions were closed — 0 when they were
 * already off duty, which callers treat as a no-op rather than an error (two
 * people pressing "End shift" on the same stale row is not a conflict worth
 * surfacing).
 */
export async function endDuty(userId: string): Promise<{ closed: number }> {
  const res = await prisma.dutySession.updateMany({
    where: { userId, endedAt: null },
    data: { endedAt: new Date() },
  });
  return { closed: res.count };
}

/**
 * Who should receive the next lead, or null when nobody is on duty.
 *
 * Eligibility is presence plus access: an OPEN session, an ACTIVE user, and
 * the `leads` area (admins/managers pass via `can`). A deactivated account
 * with a forgotten open shift is therefore never handed work.
 *
 * The pick, in order:
 *   1. Fewest OPEN leads currently owned. This is round-robin BY LOAD rather
 *      than by a stored cursor — and that is the point. There is no rotation
 *      pointer to persist, so the rotation survives a process restart, a
 *      half-finished assignment batch, and a telecaller clocking in halfway
 *      through the day; the counts are read back from the leads themselves,
 *      so a crashed run simply resumes correctly on the next firing. It is
 *      the same reasoning autoAssignLeads already used, narrowed from "every
 *      user with the leads area" to "whoever is actually on the phone".
 *   2. Longest since they were last assigned one, so two people on equal load
 *      alternate instead of one of them always winning. The signal is the
 *      most recent `updatedAt` among the leads they own: an assignment always
 *      bumps it (the claim writes ownerUserId), and someone owning nothing at
 *      all counts as "never", which puts them first. It is a proxy — editing
 *      a lead bumps it too — but it is derived, not stored, which is worth
 *      more here than precision: a stale cursor would mis-route silently,
 *      whereas this is self-correcting on every call.
 *   3. A stable id order, so the choice is deterministic rather than whatever
 *      order Postgres felt like returning.
 *
 * Returning null is a normal outcome and MUST be read as "leave this lead
 * unassigned", never as an error. Nobody being on duty is an operational
 * fact — it is 6am, or everyone went home — and an unassigned lead is a
 * visible, recoverable state the leads queue already shows. Throwing here
 * would turn an empty shift board into failing intake.
 */
export async function nextOnDutyTelecaller(): Promise<DutyUser | null> {
  const onDuty = await listOnDuty();
  const candidates: DutyUser[] = [];
  const seen = new Set<string>();
  for (const s of onDuty) {
    if (!s.user.active) continue;
    if (!can(s.user, "leads")) continue;
    if (seen.has(s.user.id)) continue; // belt-and-braces against a stale double-open
    seen.add(s.user.id);
    candidates.push(s.user);
  }
  if (candidates.length === 0) return null;

  const [openCounts, lastTouched] = await Promise.all([
    prisma.lead.groupBy({
      by: ["ownerUserId"],
      where: { status: "open", ownerUserId: { in: candidates.map((u) => u.id) } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["ownerUserId"],
      where: { ownerUserId: { in: candidates.map((u) => u.id) } },
      _max: { updatedAt: true },
    }),
  ]);

  const load = new Map<string, number>();
  for (const row of openCounts) {
    if (row.ownerUserId) load.set(row.ownerUserId, row._count._all);
  }
  const last = new Map<string, number>();
  for (const row of lastTouched) {
    if (row.ownerUserId && row._max.updatedAt) {
      last.set(row.ownerUserId, row._max.updatedAt.getTime());
    }
  }

  const sorted = [...candidates].sort((a, b) => {
    const byLoad = (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0);
    if (byLoad !== 0) return byLoad;
    // 0 = never assigned anything, which sorts first: the longest wait.
    const byWait = (last.get(a.id) ?? 0) - (last.get(b.id) ?? 0);
    if (byWait !== 0) return byWait;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return sorted[0];
}

/**
 * How long a shift has been running: "2h 14m", "47m", "1d 3h".
 *
 * Derived purely from the two timestamps, exactly how lead-stage.ts derives
 * days-in-stage from stageEnteredAt — the board needs no ticking job to stay
 * honest, a refresh is enough. Clamped at zero so a clock skew between the
 * database and the server renders "0m" rather than a negative shift.
 */
export function dutyDurationLabel(startedAt: Date, now: Date = new Date()): string {
  const mins = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
