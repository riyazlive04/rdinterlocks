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
