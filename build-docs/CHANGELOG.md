# Changelog

Branch `feat/lead-intake-quote-review`, 2026-11-02.

Commits predate the `feat(<name>):` convention, which applies from here on.
They are grouped by feature rather than renamed — rewriting verified history
to fix commit titles is not worth the risk.

## Built

### Lead intake webhook — `554eb21`
Provider-agnostic HMAC-signed endpoint at `/api/v1/leads/webhook/[channel]`,
configured entirely through `LEAD_WEBHOOK_CHANNELS`. `LeadWebhookDelivery`
stores every delivery before interpretation, which makes replay possible —
previously a lead lost to a transient Graph error was lost for good.
Leads → Intake shows the log, channel config and per-row replay. Provider
contract written to `docs/lead-webhook-contract.md`.

### Zone pricing — `554eb21`
8 zones, 32 zone prices, 16 minimum-order rules and a base matrix seeded from
the owner's district rate chart. The seeder had never run because it looked up
BrickSize `6"` while the database stores `6`. Added `Lead.zoneId` and a picker.

### Quotation review gate — `554eb21`
`draft → in_review → changes_requested → approved → sent`, off by default.
The PDF is frozen into `QuotationDocument` at submission, so the approved
document is provably the sent one. New `quoteReview` / `quoteSend` areas.

### Role hierarchy, duty presence, payment gate — `e0873ab`
Four roles with strictly downward task delegation. Duty presence replaced the
"rotate every 15 calls" idea after the owner clarified the requirement.
Manager approval of a payment now creates the Order. Per-role dashboards and
the supervisor fulfilment queue.

### Migration and verification — `de3954c`
Schema pushed; spine verified end to end (24/24) and every route exercised as
every role. Telecallers were being redirected from the review queue they were
built to staff — `quoteReview` added to their defaults.

## Fixed

### Found while building
- `resolveQuotationItems` ignored `ZoneBrickRule.minBricks` entirely, so a
  500-brick order to a 60–90 km site quoted at the full delivered rate.
- `convertQuotationToOrder` could accept an expired quotation at stale
  prices: `isQuotationExpired` returns false once the status is no longer
  `sent`, so the guard stopped firing exactly when the row was marked stale.
- The expiry sweep and the printed `validUntil` disagreed; `validUntil` now
  wins, so the system never contradicts the customer's own document.
- A UPI id without an `@handle` rendered an unscannable QR on every
  quotation. Validated on input, refused at render.
- Vercel Cron issues GET; the WhatsApp tick exported only POST.
- `.gitignore` covered `.env` but not `.env.*`, so a backup would have been
  committed with the database password.
- `prisma/seed.ts` wipes 34 tables and the README listed it as a setup step;
  it now refuses to run against a database holding data.
- The role enum in settings named four roles while the form offered six, so
  saving a supervisor threw — the whole new role was unusable.
- The last-owner guard compared against the literal `"admin"` while the count
  covered admin and owner.

### Login names must be unique — `fc775fd`
The name IS the login. Nothing stopped two accounts called "Raj", and
resolution came down to table order — at worst one user lands in the other's
account with nothing on screen to show it.

### Security review — `1c10fb0`
A review of the branch found six issues; all fixed and verified 9/9.
- **Login worked without a username.** An empty name made it a password-only
  match against every active user, owner included.
- **`/api/export` had no area check** — a telecaller could download the whole
  cashbook or the payroll from the URL.
- **Signature-rejected deliveries could be replayed**, laundering a forged
  lead into the system as a genuine provider submission.
- **Sessions could not be revoked** — role and permissions lived in a 30-day
  JWT, so demoting or deactivating someone did nothing to an open tab.
- **A telecaller could take any colleague's lead**, which also defeated
  review routing.
- **The quotation PDF** opened any quotation to any `quoteReview`/`quoteSend`
  holder, unscoped.

Clean on the review: HMAC verification, JWT handling, XSS (every DB-derived
string escaped in the PDF template), SQL/command/path injection, manager →
owner escalation, secret logging, and the task hierarchy.

## Tooling

- ESLint installed for the first time with a flat config — `npx eslint` had
  been fetching a throwaway copy, which is why it never worked.
- npm scripts: `cron:tick`, `cron:sweep`, `webhook:test`, `db:zones`,
  `db:prices`, `db:quote-settings`.
- `scripts/post-lead-webhook.mjs` (reference signer), `run-tick.mjs`,
  `run-sweep.mjs` (scheduler-agnostic invokers for VPS/Task Scheduler).

### Navigation grouped by role — phase 6
33 flat entries over 79 routes, with nothing to tell a new telecaller which
three were theirs. The sidebar and the mobile "More" sheet now group into
Sell / Make / Move / Money / Admin, and a group a role has no business in is
absent entirely — heading and all.

- `groupedNav` is a VIEW over `visibleNav`, never a second filter, so grouping
  cannot grant or withhold a route. `run-nav.ts` NAV-01 asserts set equality
  between flat and grouped output for all six roles, which is what makes the
  change safe.
- A telecaller's sidebar: 6 entries under one heading, down from 29.
- The plan's acceptance said a supervisor sees "only Make and Move". That was
  wrong — `sales` is in their default areas, so hiding it would have been an
  access change and left a page they can open with no link to it. Recorded in
  the feature doc and pinned by NAV-04.
- An item filed under no group falls to the footer rather than vanishing;
  NAV-07 asserts nothing is actually unfiled.
