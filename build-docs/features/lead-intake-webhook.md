# Feature 1 — Provider-agnostic lead intake webhook

## Purpose

`/api/v1/leads/meta/webhook` can only ever serve Meta itself: it verifies
`X-Hub-Signature-256` with the app secret, then calls the Graph API for
`field_data`. So it needs custody of a page access token, and a lead only
arrives if the sender IS Facebook. A third-party relay or agency dashboard —
how Lead Ads submissions actually reach this factory — had no way in.

## Architecture

`POST /api/v1/leads/webhook/[channel]`. The provider posts field data inline
and signs it; we make no outbound call and hold no Graph token.

Everything that differs between providers is configuration:
`LEAD_WEBHOOK_CHANNELS` is a JSON array of `{channel, secret, scheme,
signatureHeader, signaturePrefix, timestampHeader, toleranceSeconds, source,
fieldMap}`. Only `channel` and `secret` are required. Onboarding a provider is
one env entry and no deploy.

Schemes: `hmac-sha256-hex` (default, over `<timestamp>.<raw body>`),
`hmac-sha256-base64`, `hmac-sha256-hex-body` (no replay window), `bearer`
(static token, last resort).

`LeadWebhookDelivery` stores every delivery **before** interpretation — raw
body, redacted headers, outcome. That row is the only place a bad signature is
visible, since the sender is told nothing specific, and it is what makes
replay possible.

Provider contract: `docs/lead-webhook-contract.md`.

## Impact map

| Touches | What could break |
|---|---|
| `lib/leads-import.ts` | Reused unchanged. A change to its alias table changes what every channel accepts. |
| `Lead.source` | Defaults to `"meta"` per channel, so UI testing `source === "meta"` keeps labelling correctly. |
| Rate limiter | Shares `LEAD_IMPORT_LIMITS` with the Transcriber endpoint, per channel and per IP, so one provider cannot exhaust another's budget. |
| Auto-assign / auto-quote | Imported leads flow straight into both, so a forged lead reaches real workflows — hence the replay guard. |

## Edge cases and failure modes

- **Raw bytes are signed.** The route reads `req.text()` and parses after, so
  a provider whose key order differs from ours still verifies.
- **Fails closed everywhere**: unknown channel, absent header, malformed or
  stale timestamp, wrong digest. An unknown channel returns the same 401 as a
  bad signature, so the endpoint is not a channel-name oracle.
- **Idempotency.** The provider's `leadId` becomes `callId`; a retry or a
  30-day backfill merges instead of duplicating.
- **A signature-rejected delivery cannot be replayed.** The body is stored
  before verification, so anyone guessing a channel slug can park a forgery in
  the table. Authentication is the one thing a replay cannot re-establish, so
  those rows are refused. Found in security review.
- **`bearer` secrets are never persisted.** The signature header is stored as
  a 12-char SHA-256 fingerprint; under that scheme the header IS the credential.
- **Malformed channel config is discarded, not defaulted** — a typo must not
  quietly become an unauthenticated endpoint. Surfaced on the intake page.
- **`toleranceSeconds` on a scheme that cannot enforce it** is a warning,
  separate from errors, so a working channel is never shown as dead.

## Acceptance criteria

1. A correctly signed delivery imports, returning 201 then 200. ✅
2. Re-delivering the same `leadId` updates, never duplicates. ✅
3. Forged, absent and stale signatures are refused (401 / 401 / 408). ✅
4. A payload with no phone is refused 400. ✅
5. A signature-rejected delivery cannot be replayed. ✅ `SEC-03`
6. Credentials never appear in `LeadWebhookDelivery.headers`. ✅

Tests: `scripts/e2e/run-rbac.ts` case `SEC-03`; live HTTP checks in TESTING.md.
