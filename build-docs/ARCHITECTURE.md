# Architecture

Next.js 15 (App Router, server components + server actions) · Prisma ·
PostgreSQL on Supabase · Tailwind. No API layer between the UI and the
database: pages read through Prisma directly, writes go through server
actions that own their own authorization.

The pre-existing module-by-module description is at [`../ARCHITECTURE.md`](../ARCHITECTURE.md).
This file covers the structure added on `feat/lead-intake-quote-review`.

## The spine

The sequence the business runs on. Everything else supports it.

```
lead arrives ─> routed to an on-duty telecaller ─> called and qualified
     ─> quoted (zone sets the rate) ─> reviewed ─> sent
     ─> payment recorded ─> MANAGER APPROVES ─> order created
     ─> produced ─> dispatched from the godown ─> [balance collected: not built]
```

The one hard boundary: **manager approval of a payment is what creates the
Order.** Nothing reaches production unpaid and unchecked.

## Authorization: two separate questions

| Module | Question | Shape |
|---|---|---|
| `src/lib/access.ts` | May this user open this screen? | Areas, granted per user. `can(user, area)`. `isAdmin()` covers owner, admin and manager. |
| `src/lib/roles.ts` | Where do they sit in the chain of command? | `canAssignTo`, `isFullAccess`, `isOwner`. Strictly downward. |

Keeping them apart matters: a telecaller holds `quoteReview` (an area) but
delegates to nobody (a rank). Conflating the two produced the bug where the
review queue existed with nobody able to staff it.

**Every authorization decision re-reads the subject from the database.** Never
the role or id that arrived with the request. `getSession` itself re-reads the
user each request, so demotion and deactivation take effect immediately.

## Data model additions

| Model | Role |
|---|---|
| `LeadWebhookDelivery` | Raw inbound deliveries, stored before interpretation. Dead-letter and replay. |
| `LeadActivity` | Append-only call log: kind, outcome, note, next action. |
| `DutySession` | Who is on the phone, since when, from where. Open session = routable. |
| `QuotationDocument` | The PDF bytes frozen at submission, plus SHA-256. |
| `QuotationPayment` | A payment *claim* awaiting manager verification. Not money. |
| `Lead.ownerUserId`, `Lead.zoneId` | Who works it; which price band applies. |
| `Order.approvedBy/At`, `fulfilmentStage` | Who released it to production, and where it is. |

`fulfilmentStage` is deliberately separate from `Order.status`: that one is
driven by delivery progress and is not the supervisor's to move.

## Inbound channels

Three, converging on one importer (`lib/leads-import.ts`):

| Route | Auth | Payload |
|---|---|---|
| `/api/v1/leads/import` | API key header | Transcriber call extracts |
| `/api/v1/leads/meta/webhook` | `X-Hub-Signature-256` + Graph fetch | Meta itself |
| `/api/v1/leads/webhook/[channel]` | HMAC over `<timestamp>.<raw body>` | Anyone else, inline |

All three key idempotency on the sender's own id, so a retry or a backfill
merges rather than duplicating.

## Scheduled work

Not Vercel Cron — the target is local, then a VPS. Each job is an
authenticated endpoint plus a dependency-free invoker under `scripts/`:

| Endpoint | Invoker | Does |
|---|---|---|
| `/api/v1/whatsapp/tick` | `npm run cron:tick` | Drains the nurture queue |
| `/api/v1/cron/sweep` | `npm run cron:sweep` | Auto-assign, auto-draft, expiry |

Both authenticate with `CRON_API_KEY`, constant-time, failing closed when
unset. Both accept GET and POST, since some schedulers only issue GET.

## Conventions

- New behaviour ships **off by default** behind a Settings flag.
- Refusals name the reason and a route out.
- Money is gated on the `revenue` area throughout; the quotation PDF is the
  one deliberate exception, scoped to the queues that need it.
