# Feature 4 — Four roles, task delegation, duty presence

## Purpose

Roles were `admin`/`owner`, `manager`, `telecaller`, `staff` — no supervisor,
no hierarchy, one shared dashboard branching only on `revenue`. Tasks could be
assigned by any admin to any non-admin, with no chain of command.

## Architecture

**`src/lib/roles.ts`** holds the chain of command, kept separate from
`access.ts` (which answers "may this user open this screen"). Owner →
Manager, Supervisor, Telecaller, Staff. Manager → Supervisor, Telecaller,
Staff. Supervisor → Telecaller, Staff. Telecaller/Staff → nobody. Strictly
downward: a role never appears in its own list, so nobody assigns sideways to
a peer or upward to their own manager.

Manager carries the same **access** as owner (`isAdmin` includes it) but stays
a distinct role string, because the hierarchy must tell them apart. Only an
owner may confer owner rank or edit an owner.

**Duty presence, not a call counter.** The brief said "rotate every 15 calls";
the owner corrected it — the number is not fixed. What matters is seeing who
is speaking, since when, and from where, so leads reach the right person. An
open `DutySession` is what makes a telecaller routable;
`nextOnDutyTelecaller()` picks by fewest open leads, then longest since last
assigned, then stable id order — round-robin by load, with no stored cursor to
go stale.

**Per-role dashboards**: owner and manager share one panel; supervisor gets
the production queue and stock readiness; telecaller gets their own leads,
shift and calls. `/fulfilment` moves an order through the four stages.

## Impact map

| Touches | What could break |
|---|---|
| `isAdmin()` | Now true for `manager`, so every `requireAdmin` call site admits managers — including Settings → Users. Mitigated by making rank owner-only rather than locking them out. |
| `tasks/actions.ts` | Every action re-reads the assignee's role from the DB. Trusting the request would let a supervisor assign to a manager. |
| `autoAssignLeads` | Assigns only to on-duty telecallers; with nobody on duty it assigns nothing and reports the reason. |
| `settings/actions.ts` roleEnum | Had four roles while the form offered six, so saving a supervisor threw. Now derived from `ROLES`. |
| `getSession` | Re-reads the user each request, so demotion and deactivation take effect immediately. Costs one indexed lookup per request. |
| `assignLead` | Restricted to self-claim of unassigned leads for non-managers, because review routing depends on `ownerUserId`. |

## Edge cases and failure modes

- **Double clock-in.** Closing any open session and opening the new one share
  one transaction. It never throws: a telecaller whose browser crashed must be
  able to clock back in, because the failure that matters is the board showing
  nobody on duty while someone is on the phone.
- **Nobody on duty** → routing returns null, leads stay unassigned, and the
  board states that consequence rather than guessing.
- **Self-administration** is blocked: nobody changes their own role,
  deactivates themselves, or deletes their own account.
- **Deleting a user cascades** `Task.assignedTo` and `DutySession`, so it is
  refused outright when the user has history. Deactivate instead.
- **Login names must be unique** case-insensitively — the name IS the login.
- **Fulfilment stages** cannot skip forward or move backwards unless the
  mover has full access.

## Acceptance criteria

1. Tasks travel strictly downward. ✅ `RBAC-01`
2. Default areas open each role's screens and no more. ✅ `RBAC-02`
3. Double clock-in leaves one open session, the later one. ✅ `DUTY-01`
4. Routing picks an on-duty telecaller; null when none. ✅ `DUTY-01`
5. A deactivated account cannot authenticate. ✅ `SEC-02`
6. Login requires a username. ✅ `SEC-01`
7. Zero server errors across 19 routes × 4 roles. ✅ role probe

Tests: `scripts/e2e/run-rbac.ts` — `RBAC-01`, `RBAC-02`, `DUTY-01`, `SEC-01`, `SEC-02`.
