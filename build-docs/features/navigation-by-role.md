# Navigation grouped by role

Phase 6. Presentation only — **this feature grants and withdraws nothing.**

## Purpose

33 flat navigation entries over 79 routes. A new telecaller signs in and meets
all of it in one undifferentiated column, with no indication which three items
are theirs. The access rules already hide what they may not open; what is
missing is any shape to what remains.

## Architecture

**The one rule that governs the whole feature:** grouping is a view over
`visibleNav`, never a second filter. Whatever a role could reach before it can
reach after, by the same route, on the same screen. `visibleNav` keeps sole
authority over visibility; `groupedNav` only arranges what it returns.

- `NavItem` gains `group?: NavGroupKey`.
- `NAV_GROUPS` — ordered: `sell`, `make`, `move`, `money`, `admin`.
- `groupedNav(items, user)` = `visibleNav(items, user)` partitioned into those
  groups, **dropping every group that comes back empty**, with ungrouped items
  returned separately as `pinned` (top) and `footer` (bottom).
- `sidebar.tsx` and `menu/page.tsx` render the groups with a heading each.
  `bottom-nav.tsx` is untouched — five fixed items, no room to group.

**Group assignment**

| Group | Items |
|---|---|
| *pinned* (no heading) | Dashboard, Tasks |
| Sell | Leads, On duty, Clients & Sales, Quotations, Quote review, Send list, Lead intake, WhatsApp |
| Make | Production, Daily entry, Production queue, Mason, Loading |
| Move | Deliveries, Tipper, Vehicles & EMI |
| Money | Cashbook, Expense, Payment approvals, Collections, Reports |
| Admin | Employees, Leave, Payroll, Hide data & backups, Settings |
| *footer* (no heading) | App guide |

## Impact map

| Touches | What could break |
|---|---|
| `src/components/nav-config.ts` | Every nav consumer. An item given no `group` would silently vanish from a grouped render — guarded by GAP-01, which asserts set equality between flat and grouped output. |
| `src/components/sidebar.tsx` | Desktop nav. Pure render change. |
| `src/app/(app)/menu/page.tsx` | Mobile "More" sheet, the only way a phone reaches anything outside the five bottom items. If a group were dropped here a route would become unreachable on mobile. |
| `src/components/bottom-nav.tsx` | Not modified. |
| `visibleNav` / `can()` / `ACCESS_AREAS` | Not modified. Any change here would be an access change, which this feature is defined not to make. |
| Phase 7 | Adds the Collections entry to Money; listed above so the group exists before the page does. |

## Edge cases and failure modes

- **A role with nothing in a group** — the group and its heading are absent
  entirely, not rendered empty. A telecaller never sees a "Make" heading.
- **A new nav item with no `group`** — falls into `footer` rather than being
  dropped. Wrong place, still reachable; the test catches the omission.
- **A role with nothing in any group** (`staff`, no permissions) — pinned and
  footer still render, so Dashboard, Tasks and App guide remain reachable and
  the sidebar is never blank.
- **Settings** stays `isAdmin`-gated inside the Admin group; grouping an item
  does not loosen its own gate.
- **Accessibility** — each group heading is a real `<h2>` inside a labelled
  `<nav>`, so the groups are list landmarks to a screen reader rather than
  styled text. Keyboard order follows visual order.

## Acceptance criteria

- **NAV-01** For every role, the set of items in the grouped output equals the
  set from `visibleNav` — nothing gained, nothing lost.
- **NAV-02** A telecaller's sidebar shows the Sell group and no Make, Move,
  Money or Admin heading.
- **NAV-03** A supervisor sees Make and Move, plus the one Sell item they are
  actually granted (Clients & Sales), and no Money or Admin heading.
  *The plan said "only Make and Move". That was wrong: `sales` is in
  `DEFAULT_AREAS_BY_ROLE.supervisor`, so hiding it would be an access change.*
- **NAV-04** Owner and manager see all five groups.
- **NAV-05** Every route reachable before is reachable after: no item appears
  in zero groups for a role that could previously see it.
- **NAV-06** Empty groups are omitted, not rendered with a heading and no
  items.
