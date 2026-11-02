# Feature 3 — Quotation review gate and frozen PDF

## Purpose

A quotation went draft → sent in one click, with no check by the person who
spoke to the customer. Worse, the PDF was composed from **current** Settings
on every request — terms, scope, UPI id, signature, logo — so a quotation
approved in November re-rendered with January's settings. The document
reviewed and the document sent were not provably the same file.

## Architecture

`Quotation.status`: `draft → in_review → changes_requested → approved → sent
→ accepted | rejected | expired`, gated on `Settings.quoteReviewRequired`
(**default false**, so nothing changes until it is switched on).

`QuotationDocument` stores the rendered PDF bytes, size and SHA-256, frozen at
submission. `getQuotationPdf` serves the frozen copy when one exists and adds
an ETag; an unfrozen draft still renders on demand.

Locking begins at **`approved`**, not `sent`: once a PDF is frozen and
approved, editing the quotation underneath invalidates the approval.

Two new access areas, `quoteReview` and `quoteSend`. Both only move a status
and write no amounts, so a telecaller holds them without `revenue` — the same
reasoning that already let `markQuotationSent` run without price access.

Screens: `/quotations/review` (inline PDF, Approve / Request changes) and
`/quotations/send` (phone, PDF, copy text, wa.me link, mark-as-sent).

## Impact map

| Touches | What could break |
|---|---|
| `api/quote/[id]/pdf` | Composition extracted so freeze and serve share one path. An unfrozen quotation must render byte-identically to before. |
| Access rule on that route | `quoteReview`/`quoteSend` each suffice alone — a reviewer must be able to read what they approve. Scoped after security review to quotations their queue covers plus their own drafts. |
| `updateQuotation` / `reviseQuotation` | Gate on `canEditDraft` / `isLockedStatus` instead of literal statuses. |
| `generateQuotation` | Advances the lead to `quoted`, which it never did — the pipeline used to lie. |
| Revisions | A revision is a separate row and gets its own document. |

## Edge cases and failure modes

- **Freeze happens before the status write**, so a Chromium failure leaves
  the quote editable rather than parked with no document.
- **Review is routed to the lead's owner** when `quoteReviewByOwner` is on.
  That rests on `Lead.ownerUserId`, so `assignLead` had to be restricted —
  otherwise a reviewer could reassign the lead to themselves and approve
  anyway. Found in security review.
- **Review off** keeps the old one-step path (`nextStatusOnSubmit` returns
  `approved` directly), so the desk is not disrupted by a deploy.
- **PDF rendering is Chromium**; locally it needs `CHROME_EXECUTABLE_PATH`.
- **A malformed UPI id** renders no QR rather than an unscannable one; the
  printed payment line still carries the number.
- **Every DB-derived string in the PDF is HTML-escaped**, which matters
  because lead data arrives from an external webhook.

## Acceptance criteria

1. Submitting freezes a PDF with a stable SHA-256. ✅ live
2. The frozen copy is served thereafter, not a re-render. ✅ live
3. With the flag off, behaviour is unchanged. ✅
4. `changes_requested` requires a note. ✅
5. A telecaller can open the review queue. ✅ role probe
6. A colleague's unsent draft PDF is not readable. ✅ post-review

Tests: PDF freeze/serve verified live (TESTING.md); access matrix by role probe.
