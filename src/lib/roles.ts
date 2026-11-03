// The role hierarchy: who outranks whom, and who may hand work to whom.
//
// Kept separate from access.ts on purpose. That file answers "may this user
// open this screen" (areas, granted per user). This one answers "where does
// this user sit in the chain of command" — a different question with a
// different shape, and the only place the delegation rules are written down.

export const ROLES = ["owner", "admin", "manager", "supervisor", "telecaller", "staff"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Owner",
  manager: "Manager",
  supervisor: "Supervisor",
  telecaller: "Telecaller",
  staff: "Staff",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Roles with unrestricted visibility.
 *
 * `admin` and `owner` have always been the same thing in this codebase, and
 * `manager` now joins them: the factory runs with the owner and the manager
 * seeing the same system, so a manager who could not open Settings or price a
 * quotation could not actually cover for the owner.
 *
 * They remain DISTINCT ROLE STRINGS even though their access is identical,
 * because the delegation chain below still has to tell them apart — an owner
 * assigns work to a manager, and a manager must not assign work back.
 */
export function isFullAccess(role: string): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

/** Owner/admin proper — reserved for anything that must outrank a manager. */
export function isOwner(role: string): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Who each role may assign a task to.
 *
 * Owner    -> Manager, Supervisor, Telecaller, Staff
 * Manager  -> Supervisor, Telecaller, Staff
 * Supervisor -> Telecaller, Staff
 * Telecaller/Staff -> nobody
 *
 * Strictly downward: a role never appears in its own list, so nobody can
 * assign sideways to a peer or upward to their own manager. `staff` is folded
 * in at the bottom as the pre-existing catch-all role, so adding the
 * hierarchy does not strand the users who already hold it.
 */
const ASSIGNABLE: Record<string, readonly string[]> = {
  owner: ["manager", "supervisor", "telecaller", "staff"],
  admin: ["manager", "supervisor", "telecaller", "staff"],
  manager: ["supervisor", "telecaller", "staff"],
  supervisor: ["telecaller", "staff"],
  telecaller: [],
  staff: [],
};

export function assignableRoles(actorRole: string): readonly string[] {
  return ASSIGNABLE[actorRole] ?? [];
}

export function canAssignTo(actorRole: string, targetRole: string): boolean {
  return assignableRoles(actorRole).includes(targetRole);
}

/** Can this role hand work to anyone at all? Drives whether the UI offers it. */
export function canDelegate(actorRole: string): boolean {
  return assignableRoles(actorRole).length > 0;
}

/**
 * Whether `actorRole` may act on a task assigned to `assigneeRole` — complete
 * it, reword it, delete it. True for the assignee themselves (checked by id
 * at the call site) and for anyone above them in the chain.
 */
export function canManageTaskOf(actorRole: string, assigneeRole: string): boolean {
  return canAssignTo(actorRole, assigneeRole);
}

// ─── Password strength ────────────────────────────────────────────────
//
// The minimum was 4 everywhere, which looked intentional: the column is
// `pinHash` and there was once a PIN login path, so a 4-digit code on a
// shared floor terminal made sense. But the username bypass closed in the
// security review, and a password is now the ONLY factor protecting the
// account — and an owner or manager can see the cashbook, the payroll and
// every price, and can create logins.
//
// So the floor is raised where it matters and left alone where it does not:
// full-access accounts need 8, everyone else keeps 4. A supervisor tapping a
// short code into a machine-side tablet is not the account worth hardening,
// and raising theirs would push them to write it on the wall.

/** 8 for anyone with unrestricted access, 4 for the rest. */
export function minPasswordLength(role: string): number {
  return isFullAccess(role) ? 8 : 4;
}

/**
 * Why this password is not acceptable for this role, or null if it is.
 *
 * Returns the message rather than throwing, so the same rule can drive the
 * form's inline validation and the server action's refusal without the
 * two drifting apart.
 */
export function passwordProblem(role: string, password: string): string | null {
  const min = minPasswordLength(role);
  if (password.length < min) {
    return isFullAccess(role)
      ? `An ${roleLabel(role).toLowerCase()} password must be at least ${min} characters — this account can see the cashbook and payroll and can create logins.`
      : `Password must be at least ${min} characters.`;
  }
  return null;
}

// ─── Task authorization decisions ─────────────────────────────────────
//
// The rules the task server actions enforce, as pure functions. They live
// here rather than inside the actions so they can be tested without a request
// context — the actions keep what only they can do (authenticate, load the
// subject's role from the database, write). The security boundary is
// unchanged: every role passed in is still one the action read from the DB,
// never one that arrived with the request.

export type Actor = { userId: string; role: string };
/** The assignee, as loaded from the database. */
export type TaskSubject = {
  assignedToId: string;
  /** Nullable: the creator's account may since have been deleted. */
  createdById: string | null;
  assigneeRole: string;
};

export type Decision = { allowed: true } | { allowed: false; reason: string };

const allow: Decision = { allowed: true };
const deny = (reason: string): Decision => ({ allowed: false, reason });

/**
 * Hand a task to someone.
 *
 * Two gates, in order: can this role hand out work at all (a telecaller never
 * does), then may it hand work to THIS person. The assignee must also be
 * active — a disabled account cannot take new work, or the task lands on
 * somebody who can no longer sign in to see it.
 */
export function canCreateTaskFor(
  actorRole: string,
  assignee: { role: string; active: boolean }
): Decision {
  if (!canDelegate(actorRole)) {
    return deny(`A ${roleLabel(actorRole)} cannot assign tasks to anyone.`);
  }
  if (!assignee.active) return deny("That user is disabled and cannot take new work");
  if (!canAssignTo(actorRole, assignee.role)) {
    return deny(
      `A ${roleLabel(actorRole)} cannot assign work to a ${roleLabel(assignee.role)}. ` +
        "Tasks only travel down the chain of command."
    );
  }
  return allow;
}

/**
 * Flip a task done / open, or note why it is stuck.
 *
 * Completing your own work is yours by right, so the assignee passes on id.
 * Anyone else has to outrank them. A telecaller therefore updates their own
 * task and nothing else — not even another telecaller's, since the chain
 * never runs sideways.
 */
export function canUpdateTaskStatus(actor: Actor, task: TaskSubject): Decision {
  if (task.assignedToId === actor.userId) return allow;
  if (canManageTaskOf(actor.role, task.assigneeRole)) return allow;
  return deny("You can only update your own tasks, or your team's.");
}

/** Move a task to someone else: must outrank the current holder AND the new one. */
export function canReassignTask(
  actor: Actor,
  task: TaskSubject,
  next: { role: string; active: boolean }
): Decision {
  if (!canDelegate(actor.role)) {
    return deny(`A ${roleLabel(actor.role)} cannot reassign tasks.`);
  }
  const isCreator = task.createdById === actor.userId;
  if (!isCreator && !canManageTaskOf(actor.role, task.assigneeRole)) {
    return deny("You can only reassign tasks you created, or ones that sit under you.");
  }
  if (!next.active) return deny("That user is disabled and cannot take new work");
  if (!canAssignTo(actor.role, next.role)) {
    return deny(
      `A ${roleLabel(actor.role)} cannot assign work to a ${roleLabel(next.role)}. ` +
        "Tasks only travel down the chain of command."
    );
  }
  return allow;
}

/**
 * Remove a task altogether.
 *
 * The creator (it was their instruction to withdraw) or someone who outranks
 * the assignee. Pointedly NOT the assignee on their own strength: finishing
 * the work is theirs, deciding it never needed doing is not.
 */
export function canDeleteTask(actor: Actor, task: TaskSubject): Decision {
  if (task.createdById === actor.userId) return allow;
  if (canManageTaskOf(actor.role, task.assigneeRole)) return allow;
  return deny("Only whoever assigned this task — or their senior — can delete it.");
}
