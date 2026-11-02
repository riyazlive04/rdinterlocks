# Flow test plan — the five uncommitted features

Covers the work that is in the working tree but not yet committed: quotations
(+ delivery zones + the PDF), WhatsApp nurturing, Meta/Facebook lead
ingestion, the lead-stage pipeline, and the lead-ingestion normalizers they all
share.

The repo has no test runner. These suites are plain `tsx` scripts in the style
of the existing `scripts/check-archive-order.ts` and `scripts/probe-routes.mjs`,
with a dependency-free assertion harness in `harness.ts`.

Expectations are written against each function's **documented contract** and
against what the feature must do to be correct for the factory — not against
current behaviour. A failing assertion is therefore a bug in the feature.

## Suites

| Suite | Needs | What it drives |
|---|---|---|
| `run-offline.ts` | nothing | pure decision logic: FY numbering, item naming, UPI links, webhook auth, send gates, stage ageing, ingestion normalizers |
| `run-pdf.ts` | local Chrome/Edge | the real `buildQuotationHtml -> headless Chromium -> PDF` pipeline, including page-overflow measurement |
| `run-db.ts` | local PostgreSQL | pricing/numbering/acceptance/expiry, send gates against real rows, the cron claim protocol, both webhooks, stage sequencing, Meta ingestion |
| `check-action-auth.ts` | nothing | static invariant: every exported Server Action performs an authorization check |
| `check-page-auth.ts` | nothing | static invariant: every route page gates its own read access, and no page is a client component |

## Running them

```bash
# 0. authorization invariants — static, no setup
npx tsx scripts/e2e/check-action-auth.ts
npx tsx scripts/e2e/check-page-auth.ts

# 1. offline — no setup
npx tsx scripts/e2e/run-offline.ts

# Run it under a non-IST zone too. The server runs in UTC on Vercel, and
# several of these assertions only fail there.
TZ=UTC npx tsx scripts/e2e/run-offline.ts

# 2. PDF — finds an installed Edge/Chrome automatically
npx tsx scripts/e2e/run-pdf.ts

# 3. database — throwaway Postgres, NEVER the hosted one
docker run -d --name rd-e2e-pg -e POSTGRES_PASSWORD=e2epass \
  -e POSTGRES_DB=rdtest -p 55432:5432 postgres:16-alpine

export DATABASE_URL=postgresql://postgres:e2epass@127.0.0.1:55432/rdtest
export DIRECT_URL=$DATABASE_URL

npx prisma db push --skip-generate
npx tsx prisma/seed.ts
npx tsx prisma/seed-quote-settings.ts --apply
npx tsx prisma/seed-delivery-zones.ts --apply

npx tsx scripts/e2e/run-db.ts

# teardown
docker rm -f rd-e2e-pg
```

`run-db.ts` **writes and deletes rows**, so it refuses to start unless
`DATABASE_URL` points at a local host. Override only deliberately, with
`E2E_ALLOW_REMOTE_DB=yes`. It tags every fixture it creates and cleans up in a
`finally`, so it is safe to re-run.

No suite ever reaches a real external API: `run-db.ts` stubs `fetch` for
`graph.facebook.com`, so no WhatsApp message is ever actually sent and no
Graph call is ever actually made.

## Test cases

### Feature 1 — Quotations

| ID | Case | Suite |
|---|---|---|
| TC-Q01 | Financial-year label is the Indian FY, read in IST, at both boundaries and across a century rollover | offline |
| TC-Q02 | Line-item naming matches the reference letterhead; blank dimensions omit `()`; Tamil and transport-only variants; a null dimension does not throw | offline |
| TC-Q03 | UPI deep link is a valid `upi://pay` URI: two-decimal amount, INR, percent-encoded (not `+`), trimmed VPA, QR omitted when no UPI id is set | offline |
| TC-Q04 | Expiry is derived from `validUntil`: only a `sent` quotation expires; draft/accepted/rejected never do; a quotation with no validity date never expires | offline |
| TC-DBQ-01 | A picked zone's `ZonePrice` overrides the flat `BrickPrice` matrix; the flat matrix is the fallback | db |
| TC-DBQ-02 | A typed price is frozen verbatim and flagged `manualOverride`; an explicit ₹0 is honoured | db |
| TC-DBQ-03 | A line with no configured price refuses to become a ₹0 quotation, and the error names the brick size and where to fix it | db |
| TC-DBQ-04 | Transport-only lines price from `ZoneBrickRule.transportOnly`; a missing row *and* a null rate are both refused | db |
| TC-DBQ-05 | Quotation numbers are sequential, FY-scoped, and 10 concurrent reservations yield 10 distinct numbers | db |
| TC-DBQ-06 | Acceptance: a draft is refused; a sent quotation converts once, copying frozen prices; a client is created from a lead-only quote; the lead moves to a won stage with history; nurturing stops; a second acceptance is refused and creates no second order | db |
| TC-DBQ-07 | An expired quotation is refused conversion and told to revise; an in-date one and one with no validity date both convert | db |
| TC-PDF-01 | A typical 3-line quotation renders to a valid 2-page PDF | pdf |
| TC-PDF-02 | Neither page clips its content | pdf |
| TC-PDF-03 | An 18-line quotation renders **every** row on both pages and paginates rather than clipping | pdf |
| TC-PDF-04 | Customer-supplied text is escaped; a `<script>` tag never reaches the markup | pdf |
| TC-PDF-05 | Tamil is shaped by the browser and occupies real measured width (not tofu) | pdf |

### Feature 2 — WhatsApp nurturing

| ID | Case | Suite |
|---|---|---|
| TC-WA-01 | Quiet-hours arithmetic: wrapping (21→9) and non-wrapping windows, exclusive end, `start == end` disables | offline |
| TC-WA-02 | A quiet-hours deferral retries in the future, at the window's end, in IST | offline |
| TC-WA-03 | The daily-cap window is an IST calendar day starting at midnight IST | offline |
| TC-WA-04 | Recipient is only ever a sendable MSISDN; a masked phone, free text, or a short fragment yields none | offline |
| TC-WA-05 | STOP detection fires on the real keywords (English + Tamil, any casing/punctuation) but not on `stopper` / `cancellation` / ordinary questions | offline |
| TC-DBW-01 | Gates 1–2: an opted-out lead and a lead in a won/lost stage are stopped, writing no message row | db |
| TC-DBW-02 | Gate 3: unapproved, inactive and missing templates are refused; nothing reaches the API | db |
| TC-DBW-03 | A lead with only a masked phone is never messaged | db |
| TC-DBW-04 | Gates 4–5: quiet hours and the per-lead daily cap defer (with a retry time) instead of dropping; the cap is enforced exactly | db |
| TC-DBW-05 | A send is audited with the provider id and verbatim response; a Graph error is recorded as `failed` with no `sentAt` | db |
| TC-DBW-06 | Inbound: an ordinary reply stops nurturing (`replied`) without opting out; STOP opts out; `stopper` does not; a redelivered message id records once; a forged signature changes nothing | db |
| TC-DBW-07 | Two overlapping cron ticks process three due enrollments exactly three times total; claims are always released; an unauthenticated tick is 401 | db |

### Feature 3 — Meta / Facebook lead ingestion

| ID | Case | Suite |
|---|---|---|
| TC-M01 | GET challenge: a valid subscribe echoes `hub.challenge`; wrong token, wrong mode, missing challenge and an unconfigured token all fail closed | offline |
| TC-M02 | `X-Hub-Signature-256`: genuine and uppercase-hex signatures pass; tampered body, wrong secret, missing header, bad prefix, malformed/non-hex all fail; an unconfigured secret fails closed; a UTF-8 body verifies | offline |
| TC-LI-01 | Phone normalization collapses every spelling of one person — including `091-…`, `0091…`, `+91…` — to one `contactKey` | offline |
| TC-LI-02 | Indian money shorthand: `₹1,20,000`, `2 lakh`, `1.5L`, `5k`, `1.2 crore`; free text and NaN rejected | offline |
| TC-LI-03 | Dates are day-first and a bare ISO date does not drift a day in IST | offline |
| TC-LI-04 | Stage synonyms normalize; an unknown stage is passed through, not discarded | offline |
| TC-LI-05 | A Meta-shaped payload normalizes without loss, and unmodelled keys are preserved | offline |
| TC-DBM-01 | A signed Lead Ads webhook creates a lead from Graph `field_data`; a replayed delivery does not duplicate it; a forged delivery creates nothing | db |

### Feature 4 — Lead-stage pipeline

| ID | Case | Suite |
|---|---|---|
| TC-LS-01 | Days-in-stage ageing: null, same-day, 3 days, 3.9 days, and a future timestamp clamped to 0 | offline |
| TC-DBL-01 | Entering a stage auto-enrolls the lead into sequences triggered by it, scheduled by the step delay; an opted-out lead is never enrolled | db |

### Feature 5 — Delivery zones

Exercised through the quotation pricing cases (TC-DBQ-01, TC-DBQ-04), which is
where zones have their effect: zone price precedence and per-size transport
rates.

### Cross-cutting — authorization

| ID | Case | Suite |
|---|---|---|
| TC-AUTH-01 | Every exported Server Action calls `requireAdmin` / `requireArea` / `requireAnyArea` / `requireAdminOrManager` / `requireSession`. Next.js publishes each action as its own HTTP endpoint and `src/middleware.ts` checks only that a session is valid — it reads no role and no permission — so an ungated action is callable by every logged-in user regardless of their areas | check-action-auth |
| TC-AUTH-02 | Every route page gates its own read access. `(app)/layout.tsx` only proves a session exists, so an ungated page is readable by any logged-in user via its URL even though the nav hides the link | check-page-auth |
| TC-AUTH-03 | No `page.tsx` is a client component — a client component can neither be async nor call `requireArea` (`cookies()`/`redirect()` are server-only), so it cannot gate itself and must become a server page rendering a client form | check-page-auth |

Settings actions are `requireAdmin()`, which is what keeps the quotation UPI
id (`updateQuoteContent`) changeable by an admin alone. Three actions are
reachable from two areas' screens and use `requireAnyArea`:
`deleteLoadingCharge` (loading + sales), `createDailyProduction`
(production + day), `setDeliveryDone` (sales + deliveries).

## Not covered

- **Server Actions over HTTP.** `revalidatePath`/`redirect` need a request
  scope, so the actions are covered at the layer beneath them
  (`resolveQuotationItems`, `convertQuotationToOrder`, `nextQuotationNumber`)
  rather than through a running server. `scripts/probe-routes.mjs` covers page
  reachability.
- **Real Graph API traffic.** Deliberately stubbed. Sending a real WhatsApp
  template to a real customer is not something a test suite should do.
- **`facebook-feed.ts` relay backfill**, which needs the upstream relay's
  cursored export to assert anything meaningful.
- **`VendorPayment`**, which is in the schema with no code using it yet — an
  unimplemented feature rather than a defect, so there is nothing to assert.
- **API route authentication** is covered only by inspection, not assertions.
  All eleven `route.ts` handlers authenticate — session cookie
  (`export`, `archive/download`, `quote/pdf`), a static API key
  (`v1/leads`, `v1/leads/import`, `v1/leads/meta/sync` via
  `authenticateApiRequest`), a Meta signature (both webhooks), or
  `CRON_API_KEY` (`v1/whatsapp/tick`). Only `api/login` and `logout` are
  public, by design.
