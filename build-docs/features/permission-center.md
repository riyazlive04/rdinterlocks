# Permission center

Phase 11. One screen to see and change who can open what.

## Purpose

**What already exists, so this does not rebuild it.** Settings → Users &
access (`/settings/users`) already creates logins, sets a role, disables an
account and grants areas with a checkbox each. Both an owner and a manager can
use it, and only an owner can grant owner rank or edit an owner. That editor
stays exactly as it is.

**What is missing.** It edits **one user at a time**, so there is no way to
answer the question that actually gets asked: *who can see the cashbook?*
Finding out means opening each of the logins in turn and remembering what you
saw. And the grant list is 22 flat checkboxes in declaration order — the same
undifferentiated wall that phase 6 fixed for the navigation, in the one place
where a mis-click hands someone the payroll.

So: a matrix. Users down the side, areas across the top, grouped the way the
app is grouped, every cell a toggle.

## Architecture

**Areas gain a group**, reusing the phase 6 vocabulary so the permission
screen reads in the same order as the menu the grant controls:

| Group | Areas |
|---|---|
| Sell | leads, leadIntake, sales, quotations, quoteReview, quoteSend, whatsapp |
| Make | production, die, day, mason, loading |
| Move | deliveries, tipper, vehicles |
| Money | cash, expense, reports, revenue |
| Admin | employees, leave, payroll |

All 22 areas, each in exactly one group — asserted by PERM-01, because an
area missing from the map would simply not render and would look like a
revoked grant.

**`setUserArea(userId, area, granted)`** — one narrow action, not a reuse of
`updateUser`. `updateUser` takes name, role, permissions and active together,
so driving a single checkbox through it means the client sends the whole user
back and a stale tab can silently revert a rename or re-enable a disabled
login. This action touches `permissions` and nothing else.

It re-reads the subject from the database and refuses when:

| Condition | Why |
|---|---|
| Area not in `ACCESS_AREAS` | Otherwise any string lands in `permissions`, where it is dead weight that reads like a real grant. |
| Subject is an owner and actor is not | Existing rule (`assertMayAdministerUser`), unchanged. |
| Subject has full access | Owner/admin/manager have everything via `isAdmin`; per-area grants are not stored for them, so writing one would be a lie the UI then has to explain. |
| Subject is the actor | You do not edit your own access. Full-access users would be no-ops anyway, but the rule is stated rather than left to follow from that. |

The predicates move to `lib/roles.ts` as pure functions
(`canAdministerUser`, `canConferRole`) so they are testable without a request
context, exactly as the task and stage rules were. `settings/actions.ts` keeps
its existing asserts as thin wrappers over them, so nothing else changes.

**The matrix is read-only for a full-access row** — it shows "everything"
rather than 22 checked boxes nobody may uncheck.

## Impact map

| Touches | What could break |
|---|---|
| `src/lib/access.ts` | `ACCESS_AREAS` entries gain `group`; adds `AREA_GROUPS` and `groupedAreas()`. Adding a field cannot change `can()`, but an area left out of the group map would vanish from both permission screens — PERM-01 pins it. |
| `src/lib/roles.ts` | Two pure predicates added. No behaviour change. |
| `src/app/(app)/settings/actions.ts` | New `setUserArea`; the two private asserts now delegate. `createUser`/`updateUser`/`deleteUser` unchanged. |
| `src/app/(app)/settings/permissions/` (new) | New route under an existing `requireAdmin` hub. |
| `src/app/(app)/settings/users/manager.tsx` | Area checkboxes grouped instead of flat. Same grants, same action — presentation only. |
| `src/app/(app)/settings/page.tsx` | One hub entry. |
| `User.permissions` | **Written** — the one mutation in this feature, one area at a time. |
| `can()` / `isAdmin()` / `DEFAULT_AREAS_BY_ROLE` | Not modified. This feature changes who holds a grant, never what a grant means. |
| `run-rbac.ts`, `run-nav.ts` | Assert area defaults and nav groups exactly; both must stay green, which is the regression check that this changed no semantics. |

## Edge cases and failure modes

- **Toggling your own row** — refused with a reason, and the row is rendered
  disabled so it is not offered.
- **A manager opening an owner's row** — refused; rendered read-only.
- **Granting an area to a full-access user** — refused; the row shows
  "everything" instead of checkboxes.
- **An unknown area key** — refused before the write.
- **Revoking the area a user is currently inside** — allowed. The next request
  re-reads permissions and redirects them out; sessions are already revocable
  (security review `1c10fb0`), so this does not wait 30 days.
- **Duplicate grants** — `permissions` is a string array with no constraint, so
  granting twice is deduplicated on write rather than appending.
- **Revoking an area the user never had** — a no-op, not an error.
- **A disabled user** — permissions remain editable; they simply cannot sign
  in. Useful for preparing an account before someone starts.
- **Concurrency** — two owners toggling the same user: last write wins, and
  because the action writes one area it cannot clobber the other's unrelated
  change the way sending the whole array would.
- **Accessibility** — each cell is a real `<input type="checkbox">` with an
  `aria-label` naming both user and area ("Cashbook for Raj"), not a styled
  div; the header is a real `<th scope="col">` so a screen reader can place a
  cell in the grid.

## Acceptance criteria

- **PERM-01** Every area in `ACCESS_AREAS` appears in exactly one group, and
  the groups contain no area that does not exist.
- **PERM-02** Granting an area adds it to `permissions` and `can()` then
  returns true for it; revoking removes it and `can()` returns false.
- **PERM-03** Granting the same area twice does not duplicate it.
- **PERM-04** Revoking an area the user never held is a no-op.
- **PERM-05** An area key outside `ACCESS_AREAS` is refused and nothing is
  written.
- **PERM-06** A manager cannot change an owner's areas; an owner can.
- **PERM-07** Nobody can change their own areas.
- **PERM-08** A full-access subject's areas cannot be set, and `can()` still
  returns true for everything.
- **PERM-09** Only an owner can grant owner rank (existing rule, now pinned
  as a pure predicate).
- **PERM-10** A grant change does not alter the subject's name, role or active
  flag.
