# Lead delivery webhook — integration contract

**Audience: the engineer at the lead provider who will configure the webhook.**

You are being asked to deliver Facebook/Instagram Lead Ads submissions to RD
Interlock's CRM in real time. This document is the complete contract. Nothing
here requires you to know anything about our internals.

---

## 1. Endpoint

```
POST https://<CRM_HOST>/api/v1/leads/webhook/<channel>
Content-Type: application/json
```

`<channel>` is a short label we issue you (for example `metarelay`). It selects
which credential and field mapping we apply. Use exactly the value we give you.

We will send you, over a channel you consider safe for sharing a secret:

| Value | Example | Notes |
|---|---|---|
| `CRM_HOST` | `crm.rdinterlocks.com` | HTTPS only; plain HTTP is rejected |
| `<channel>` | `metarelay` | fixed string in the path |
| `WEBHOOK_SECRET` | 64 hex characters | shared signing secret — never put it in a URL or query string |

---

## 2. Authentication — HMAC-SHA256 over the raw body

Every request must carry two headers:

```
X-RD-Timestamp: 1762070400
X-RD-Signature: sha256=<hex digest>
```

- `X-RD-Timestamp` — Unix epoch **seconds** at the moment you sign.
- `X-RD-Signature` — lowercase hex HMAC-SHA256, computed as:

```
signing_string = "<X-RD-Timestamp>" + "." + "<raw request body bytes>"
digest         = HMAC_SHA256(key = WEBHOOK_SECRET, message = signing_string)
header value   = "sha256=" + hex(digest)
```

Three rules that matter:

1. **Sign the exact bytes you put on the wire.** Do not re-serialise, re-order
   keys, or pretty-print after signing. We verify against the raw body.
2. **The timestamp is inside the signing string.** This is what stops a captured
   request from being replayed later. We reject a timestamp more than
   **5 minutes** from our clock in either direction, so keep your server on NTP.
3. **We compare in constant time and fail closed.** A missing, malformed or
   wrong signature is rejected — there is no "no auth" fallback.

### Test vector

Verify your implementation against this before pointing it at us:

```
WEBHOOK_SECRET = "test-secret"
X-RD-Timestamp = "1762070400"
body           = {"leadId":"1","fullName":"Test"}

signing_string = 1762070400.{"leadId":"1","fullName":"Test"}
```

A one-line check:

```bash
printf '%s' '1762070400.{"leadId":"1","fullName":"Test"}' | openssl dgst -sha256 -hmac "test-secret" -hex
```

Whatever hex digest that prints is what `X-RD-Signature` must carry, prefixed
with `sha256=`.

---

## 3. Payload

Send **one submission per request** (preferred), or a batch under `leads`.

Single:

```json
{
  "leadId": "1234567890123456",
  "submittedAt": "2026-11-02T09:14:22Z",
  "fullName": "Murugan S",
  "phoneNumber": "+919876543210",
  "city": "Salem",
  "typeOfBricks": "8 inch",
  "typeOfConstruction": "compound wall",
  "numberOfBricks": 4000,
  "notes": "Wants delivery before Pongal",
  "campaignId": "23859...",
  "adsetId": "23859...",
  "adId": "23859...",
  "formId": "10223...",
  "platform": "instagram"
}
```

Batch:

```json
{ "leads": [ { "...": "as above" }, { "...": "as above" } ] }
```

### Required fields — only two

| Field | Why it is required |
|---|---|
| `leadId` | Your stable, unique id for this submission. It is our **idempotency key**: re-delivering the same `leadId` updates the existing record instead of creating a duplicate. Never reuse one for a different submission. |
| `phoneNumber` | How the record is grouped and the only way the sales team can act on it. A submission with no phone number cannot be used. |

**Everything else is optional.** Send whatever the form captured. A partial
submission is accepted, and the fields we did not get are listed back to you in
the response — it is never rejected for being incomplete. Do not substitute
placeholder text (`"null"`, `"N/A"`, `"unknown"`) for a field you don't have;
omit the key instead.

### Field names are flexible

Our importer matches names case-insensitively and ignores separators, so
`fullName`, `full_name`, `Full Name` and `FULLNAME` are all the same field.
These aliases are all understood:

| We store | Accepted names |
|---|---|
| Customer name | `fullName`, `contactName`, `customerName`, `name` |
| Phone | `phoneNumber`, `phone`, `mobile`, `contactNumber` |
| Location | `city`, `place`, `town`, `area`, `location`, `address` |
| Brick size/type | `typeOfBricks`, `brickType`, `brickSize`, `product`, `size` |
| Construction type | `typeOfConstruction`, `constructionType`, `purpose`, `workType` |
| Quantity | `numberOfBricks`, `brickCount`, `quantity`, `qty` |
| Notes | `notes`, `remarks`, `summary`, `comments` |

If your form field names match none of these, **do not rename them** — send us
the list and we will map them in our configuration. Any field we don't
recognise is stored verbatim rather than discarded, so you can start sending a
new question's answer before we have modelled it.

Phone numbers may be sent in any format (`+91 98765 43210`, `09876543210`,
`9876543210`) — we normalise them.

---

## 4. Responses and your retry policy

| Status | `error.code` | Meaning | Retry? |
|---|---|---|---|
| `200` | — | Accepted; existing record updated | No |
| `201` | — | Accepted; new record created | No |
| `207` | — | Batch partially accepted — see `results[]` per lead | Only the failed `leadId`s |
| `400` | `invalid_json`, `missing_phone` | Payload is wrong and will not improve | **No** — fix and alert us |
| `401` | `invalid_signature`, `unknown_channel` | Bad secret, signature or channel | **No** — alert us |
| `408` | `stale_timestamp` | Your clock is more than 5 min off ours | No — fix NTP |
| `409` | `already_converted` | Customer is already a live client; we deliberately refuse to overwrite | No |
| `413` | `payload_too_large` | Body over 1 MB | No |
| `429` | `rate_limited` | Honour the `Retry-After` header | Yes, after that delay |
| `5xx` | — | Our fault | **Yes** |

Successful response shape:

```json
{
  "ok": true,
  "apiVersion": "v1",
  "requestId": "0f6c...",
  "outcome": "created",
  "leadRef": "clz...",
  "missingFields": ["place", "numberOfBricks"]
}
```

**Retry rules we ask you to follow:**

- Retry only on `429` and `5xx`. Everything else is permanent — retrying it
  just burns both our logs.
- Exponential backoff starting at 30 s, at least 6 attempts over roughly 6 hours.
- **Always retry with the same `leadId`.** The idempotency key is what makes a
  retry safe; it can never create a duplicate lead.
- Treat a network timeout as a `5xx` and retry. A request that timed out may
  still have been processed — again, the idempotency key makes that harmless.
- If you exhaust retries, hold the submission and alert us. Please do not drop it.

Echo our `requestId` into your own logs. It is how we trace one delivery end to
end when you report a problem.

---

## 5. Please do not

- Put the secret, an access token, or a phone number in the URL or query string.
  Those end up in access logs. Credentials go in the signature; data goes in the body.
- Send us a Graph API access token. We do not want custody of your token, and
  this endpoint never calls Facebook — you send the field data inline.
- Batch more than 100 leads in one request.
- Reuse one secret across your environments without telling us. We will issue
  separate `<channel>` values for staging and production; that is the clean way.

---

## 6. Going live

1. We issue `<channel>` and `WEBHOOK_SECRET`.
2. You verify your signing against the test vector in §2.
3. You send one real submission. We confirm the fields mapped correctly and
   tell you about anything we had to remap.
4. You replay the last 30 days of submissions through the same endpoint so the
   history lands in the CRM. The idempotency key makes this safe to run twice.
5. You enable live delivery.

Questions on anything here: raise them before you build, not after.
