/**
 * Offline flow suite — every assertion that can be made without a database.
 *
 * Covers the pure decision logic at the heart of the five uncommitted
 * features: quotation numbering/naming, UPI link building, Meta webhook
 * authentication, the WhatsApp send gates, lead-stage ageing, and the lead
 * ingestion normalizers.
 *
 * Expectations here are written against each function's DOCUMENTED contract
 * (its own docstring) and against what the feature must do to be correct for
 * the factory — not against current behaviour. A failure is therefore a bug
 * in the feature, not in the test.
 *
 * Run: npx tsx scripts/e2e/run-offline.ts
 * See: scripts/e2e/TEST-PLAN.md for the test-case catalogue.
 */

import { tc, eq, ok, run } from "./harness";

import {
  financialYearLabel,
  quoteItemName,
  isQuotationExpired,
  effectiveQuotationStatus,
} from "@/lib/quote";
import { buildUpiLink, upiQrDataUrl } from "@/lib/upi-qr";
import { verifyChallenge, verifySignature } from "@/lib/meta-webhook";
import {
  isQuietHour,
  toWhatsAppRecipient,
  nextQuietHoursEnd,
  startOfTodayIST,
} from "@/lib/whatsapp-send";
import { isStopMessage } from "@/lib/whatsapp-inbound";
import { daysInStage } from "@/lib/lead-stage";
import {
  normalizePhoneKey,
  coerceNumber,
  coerceDate,
  normalizeStage,
  normalizeLeadPayload,
} from "@/lib/leads-import";
import { createHmac } from "crypto";

const IST = 5.5 * 60 * 60 * 1000;
/** A real instant corresponding to the given IST wall-clock time. */
const istInstant = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, min) - IST);

// ───────────────────────── Feature 1: Quotations ─────────────────────────

const TC_Q01 = tc("TC-Q01", "Financial year label follows the Indian FY in IST", () => {
  eq("mid-FY (Aug 2026 IST)", financialYearLabel(istInstant(2026, 8, 17, 12)), "2026-27");
  eq("first instant of FY (1 Apr 2026 00:00 IST)", financialYearLabel(istInstant(2026, 4, 1, 0, 0)), "2026-27");
  eq("last instant of FY (31 Mar 2026 23:59 IST)", financialYearLabel(istInstant(2026, 3, 31, 23, 59)), "2025-26");
  eq("Jan belongs to the FY that began last April", financialYearLabel(istInstant(2027, 1, 9, 12)), "2026-27");
  // 1 Apr 02:00 IST is still 31 Mar in UTC — a server running in UTC must not
  // bill this quotation into the previous financial year.
  eq("early-morning IST on 1 Apr is the NEW FY", financialYearLabel(istInstant(2026, 4, 1, 2, 0)), "2026-27");
  eq("century rollover pads correctly", financialYearLabel(istInstant(2099, 5, 1, 12)), "2099-00");
});

const TC_Q02 = tc("TC-Q02", "Quotation line-item naming matches the reference letterhead", () => {
  eq(
    "english with dimensions",
    quoteItemName({ label: "8 Inch", dimensions: "10.5*5*6" }, "en"),
    "8 Inch Interlock Bricks(10.5*5*6)"
  );
  eq(
    "blank dimensions omit the parentheses entirely",
    quoteItemName({ label: "8 Inch", dimensions: "" }, "en"),
    "8 Inch Interlock Bricks"
  );
  eq(
    "whitespace-only dimensions also omit them",
    quoteItemName({ label: "8 Inch", dimensions: "   " }, "en"),
    "8 Inch Interlock Bricks"
  );
  ok(
    "tamil name uses the Tamil product word",
    quoteItemName({ label: "8 Inch", dimensions: "" }, "ta").includes("இன்டர்லாக்"),
    "Tamil product noun missing"
  );
  ok(
    "transport-only english line is suffixed",
    quoteItemName({ label: "8 Inch", dimensions: "" }, "en", true).includes("Transport only")
  );
  ok(
    "transport-only tamil line is suffixed in Tamil",
    quoteItemName({ label: "8 Inch", dimensions: "" }, "ta", true).includes("போக்குவரத்து")
  );
  // BrickSize.dimensions is admin-typed master data. A null/undefined slipping
  // through from the DB must not take the whole PDF route down with a
  // TypeError — the name should simply omit the dimension suffix.
  ok("a null dimensions value does not throw", (() => {
    try {
      quoteItemName({ label: "8 Inch", dimensions: null as unknown as string }, "en");
      return true;
    } catch {
      return false;
    }
  })());
});


const TC_Q04 = tc("TC-Q04", "Quotation expiry is derived from validUntil", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  const past = new Date("2026-10-01T00:00:00Z");
  const future = new Date("2026-12-01T00:00:00Z");

  ok("a sent quotation past its validity is expired", isQuotationExpired({ status: "sent", validUntil: past }, now));
  ok("a sent quotation still inside its validity is not", !isQuotationExpired({ status: "sent", validUntil: future }, now));
  ok("a sent quotation with no validity never expires", !isQuotationExpired({ status: "sent", validUntil: null }, now));

  // Only a sent quotation can expire: a draft was never given to the customer,
  // and accepted/rejected are settled outcomes a passing date must not relabel.
  ok("a draft does not expire", !isQuotationExpired({ status: "draft", validUntil: past }, now));
  ok("an accepted quotation does not expire", !isQuotationExpired({ status: "accepted", validUntil: past }, now));
  ok("a rejected quotation does not expire", !isQuotationExpired({ status: "rejected", validUntil: past }, now));

  eq("the displayed status becomes 'expired'", effectiveQuotationStatus({ status: "sent", validUntil: past }, now), "expired");
  eq("an unexpired sent quotation still shows 'sent'", effectiveQuotationStatus({ status: "sent", validUntil: future }, now), "sent");
  eq("an accepted quotation still shows 'accepted'", effectiveQuotationStatus({ status: "accepted", validUntil: past }, now), "accepted");
});

// ───────────────────── Feature 1b: UPI payment QR ────────────────────────

const TC_Q03 = tc("TC-Q03", "UPI deep link is a valid, scannable upi://pay URI", async () => {
  const link = buildUpiLink({ vpa: "rdinterlock@okhdfcbank", payeeName: "RD Interlock Bricks", amount: 125000 });
  ok("scheme is upi://pay", link.startsWith("upi://pay?"), link);
  ok("amount carries two decimals", link.includes("am=125000.00"), link);
  ok("currency is INR", link.includes("cu=INR"), link);

  // UPI apps parse the query per RFC 3986, where "+" is a literal plus, not a
  // space. URLSearchParams serializes spaces as "+", which makes the payee
  // name render as "RD+Interlock+Bricks" in the payer's app.
  ok("spaces are percent-encoded, not turned into '+'", !link.includes("+"), link);

  // A VPA with stray whitespace from a settings paste must not reach the QR.
  const padded = buildUpiLink({ vpa: "  rdinterlock@okhdfcbank  ", payeeName: "RD", amount: 10 });
  ok("the VPA is trimmed before encoding", padded.includes("pa=rdinterlock%40okhdfcbank"), padded);

  const qr = await upiQrDataUrl({ vpa: "rdinterlock@okhdfcbank", payeeName: "RD", amount: 500 });
  ok("QR is a PNG data URL", !!qr && qr.startsWith("data:image/png;base64,"), String(qr).slice(0, 40));
  ok("QR payload is a plausible size", !!qr && qr.length > 500, `len=${qr?.length}`);

  eq("no UPI id configured yields no QR", await upiQrDataUrl({ vpa: "   ", payeeName: "RD", amount: 5 }), null);
});

// ──────────────── Feature 3: Meta webhook authentication ─────────────────

const TC_M01 = tc("TC-M01", "Meta GET challenge handshake", () => {
  const sp = (o: Record<string, string>) => new URLSearchParams(o);
  eq(
    "valid subscribe challenge is echoed",
    verifyChallenge(sp({ "hub.mode": "subscribe", "hub.verify_token": "secret", "hub.challenge": "42" }), "secret"),
    { ok: true, challenge: "42" }
  );
  ok(
    "wrong verify token is rejected",
    verifyChallenge(sp({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "42" }), "secret").ok === false
  );
  ok(
    "non-subscribe mode is rejected",
    verifyChallenge(sp({ "hub.mode": "unsubscribe", "hub.verify_token": "secret", "hub.challenge": "42" }), "secret").ok === false
  );
  ok(
    "missing challenge is rejected",
    verifyChallenge(sp({ "hub.mode": "subscribe", "hub.verify_token": "secret" }), "secret").ok === false
  );
  ok(
    "FAILS CLOSED when no verify token is configured",
    verifyChallenge(sp({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "42" }), undefined).ok === false
  );
});

const TC_M02 = tc("TC-M02", "X-Hub-Signature-256 verification", () => {
  const secret = "app-secret-value";
  const body = JSON.stringify({ object: "page", entry: [{ id: "1" }] });
  const sign = (b: string, s: string) => "sha256=" + createHmac("sha256", s).update(b, "utf8").digest("hex");

  ok("a genuine signature passes", verifySignature(body, sign(body, secret), secret).ok === true);
  ok(
    "an uppercase hex signature still passes",
    verifySignature(body, sign(body, secret).toUpperCase().replace("SHA256=", "sha256="), secret).ok === true
  );
  ok("a tampered body fails", verifySignature(body + " ", sign(body, secret), secret).ok === false);
  ok("a signature from the wrong secret fails", verifySignature(body, sign(body, "other"), secret).ok === false);
  ok("a missing header fails", verifySignature(body, null, secret).ok === false);
  ok("an unprefixed signature fails", verifySignature(body, "deadbeef", secret).ok === false);
  ok("a short/malformed hex signature fails", verifySignature(body, "sha256=abc", secret).ok === false);
  ok("a non-hex signature fails", verifySignature(body, "sha256=" + "z".repeat(64), secret).ok === false);
  ok("FAILS CLOSED when no app secret is configured", verifySignature(body, sign(body, secret), undefined).ok === false);
  // A unicode body must hash over the same bytes Meta signed.
  const uni = JSON.stringify({ name: "ராம்" });
  ok("a UTF-8 body verifies", verifySignature(uni, sign(uni, secret), secret).ok === true);
});

// ───────────────── Feature 2: WhatsApp nurturing gates ───────────────────

const TC_WA01 = tc("TC-WA-01", "Quiet-hours window arithmetic", () => {
  // Default configured window is 21:00 -> 09:00, which wraps midnight.
  for (const h of [21, 22, 23, 0, 3, 8]) ok(`hour ${h} is quiet (21->9)`, isQuietHour(h, 21, 9));
  for (const h of [9, 10, 14, 20]) ok(`hour ${h} is NOT quiet (21->9)`, !isQuietHour(h, 21, 9));
  // Non-wrapping window.
  ok("hour 13 is quiet (13->15)", isQuietHour(13, 13, 15));
  ok("hour 15 is not quiet (13->15), end is exclusive", !isQuietHour(15, 13, 15));
  // Disabled window.
  for (const h of [0, 9, 21]) ok(`hour ${h} with start==end means no window`, !isQuietHour(h, 9, 9));
});

const TC_WA02 = tc("TC-WA-02", "Quiet-hours deferral lands in the future at the window's end", () => {
  const retry = nextQuietHoursEnd(9);
  ok("retryAt is strictly in the future", retry.getTime() > Date.now(), retry.toISOString());
  ok("retryAt is within the next 24h", retry.getTime() - Date.now() <= 86400000 + 1000);
  const istHour = new Date(retry.getTime() + IST).getUTCHours();
  eq("retryAt is at 09:00 IST", istHour, 9);
});

const TC_WA03 = tc("TC-WA-03", "Daily-cap window is an IST calendar day", () => {
  const start = startOfTodayIST();
  ok("start of today is in the past", start.getTime() <= Date.now());
  ok("start of today is within the last 24h", Date.now() - start.getTime() < 86400000);
  const asIst = new Date(start.getTime() + IST);
  eq("it is exactly midnight IST", [asIst.getUTCHours(), asIst.getUTCMinutes()], [0, 0]);
});

const TC_WA04 = tc("TC-WA-04", "Recipient MSISDN is only ever a sendable number", () => {
  eq("bare 10-digit mobile gets 91", toWhatsAppRecipient("9876543210"), "919876543210");
  eq("already-prefixed number is unchanged", toWhatsAppRecipient("919876543210"), "919876543210");
  eq("+91 formatting is stripped", toWhatsAppRecipient("+91 98765 43210"), "919876543210");
  eq("punctuation is stripped", toWhatsAppRecipient("(+91) 98765-43210"), "919876543210");

  // Lead.phoneMasked is the *redacted* phone ("98765*****"). sendWaMessage
  // falls back to it when phoneNumber is blank, so this helper must not turn a
  // mask into something that looks sendable — otherwise the Cloud API is
  // billed for a message to a number that was never a real MSISDN.
  eq("a masked phone yields no recipient", toWhatsAppRecipient("98765*****"), "");
  eq("an empty phone yields no recipient", toWhatsAppRecipient(""), "");
  eq("free text yields no recipient", toWhatsAppRecipient("no number on file"), "");
  eq("a too-short fragment yields no recipient", toWhatsAppRecipient("12345"), "");
});

const TC_WA05 = tc("TC-WA-05", "Inbound STOP detection opts out only on a real request", () => {
  for (const s of ["STOP", "stop", " Stop ", "stop.", "STOP!", "please stop", "unsubscribe", "cancel"]) {
    ok(`"${s}" is an opt-out`, isStopMessage(s));
  }
  ok("Tamil நிறுத்து is an opt-out", isStopMessage("நிறுத்து"));
  ok("Tamil வேண்டாம் is an opt-out", isStopMessage("வேண்டாம்"));

  // A substring match opts the customer out permanently (whatsappOptOut is
  // never automatically cleared), so these ordinary replies must NOT match.
  for (const s of [
    "I need a stopper for the gate",
    "cancellation charges?",
    "send me the price list",
    "what is the cost of 5000 bricks",
    "",
    "   ",
  ]) {
    ok(`"${s}" is NOT an opt-out`, !isStopMessage(s));
  }
});

// ───────────────────── Feature 4: Lead stage pipeline ────────────────────

const TC_LS01 = tc("TC-LS-01", "Days-in-stage ageing", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  eq("a lead with no stage timestamp has no age", daysInStage(null, now), null);
  eq("entered 10 minutes ago is day 0", daysInStage(new Date("2026-11-01T09:50:00Z"), now), 0);
  eq("entered 3 days ago is day 3", daysInStage(new Date("2026-10-29T10:00:00Z"), now), 3);
  eq("entered 3.9 days ago still reads as day 3", daysInStage(new Date("2026-10-28T12:00:00Z"), now), 3);
  eq("a future timestamp clamps to 0, never negative", daysInStage(new Date("2026-11-05T10:00:00Z"), now), 0);
});

// ───────────────── Feature 3b: Lead ingestion normalizers ────────────────

const TC_LI01 = tc("TC-LI-01", "Phone normalization merges one person into one lead", () => {
  const expected = "9876543210";
  // Each of these is the SAME person; contactKey is what merges a phone call
  // and a Meta form submission into a single Lead, so every spelling must
  // collapse to the same key. The list is taken from normalizePhoneKey's own
  // docstring plus the formats Meta Lead Ads actually delivers.
  for (const raw of [
    "9876543210",
    "+91 98765 43210",
    "+919876543210",
    "91 9876543210",
    "091-98765-43210",
    "0919876543210",
    "00919876543210",
    "09876543210",
    "(+91) 98765-43210",
  ]) {
    eq(`"${raw}"`, normalizePhoneKey(raw), expected);
  }
});

const TC_LI02 = tc("TC-LI-02", "Indian money shorthand coercion", () => {
  eq("plain number", coerceNumber(12000), 12000);
  eq("rupee+lakh formatting", coerceNumber("₹1,20,000"), 120000);
  eq("'2 lakh'", coerceNumber("2 lakh"), 200000);
  eq("'1.5L'", coerceNumber("1.5L"), 150000);
  eq("'5k'", coerceNumber("5k"), 5000);
  eq("'1.2 crore'", coerceNumber("1.2 crore"), 12000000);
  eq("empty string is not a number", coerceNumber(""), null);
  eq("free text is not a number", coerceNumber("don't know yet"), null);
  eq("null is not a number", coerceNumber(null), null);
  eq("NaN is rejected", coerceNumber(Number.NaN), null);
});

const TC_LI03 = tc("TC-LI-03", "Date coercion is day-first and does not drift in IST", () => {
  const d1 = coerceDate("17/08/2026");
  eq("dd/mm/yyyy is read day-first", [d1?.getFullYear(), d1?.getMonth(), d1?.getDate()], [2026, 7, 17]);
  const d2 = coerceDate("2026-08-17");
  eq("a bare ISO date stays on that calendar day locally", [d2?.getFullYear(), d2?.getMonth(), d2?.getDate()], [2026, 7, 17]);
  eq("garbage is rejected", coerceDate("sometime next week"), null);
  eq("empty is rejected", coerceDate(""), null);
  ok("epoch millis are accepted", coerceDate(1760000000000) instanceof Date);
});

const TC_LI04 = tc("TC-LI-04", "Stage synonym normalization", () => {
  eq("blank defaults to new", normalizeStage(""), "new");
  eq("null defaults to new", normalizeStage(null), "new");
  ok("an unknown stage is passed through, not discarded", normalizeStage("site visit booked").length > 0);
});

const TC_LI05 = tc("TC-LI-05", "A Meta-shaped lead payload normalizes without loss", () => {
  const r = normalizeLeadPayload({
    call_id: "leadgen_123",
    customer_name: "Ramesh Kumar",
    phone_number: "+91 98765 43210",
    place: "Salem",
    brick_count: "2 lakh",
    quotation_stage: "quoted",
    some_future_field: "keep me",
  });
  eq("name is carried", r.values.customerName, "Ramesh Kumar");
  eq("contactKey is the merged 10-digit key", r.values.contactKey, "9876543210");
  eq("brick count understands '2 lakh'", r.values.brickCount, 200000);
  eq("stage is carried", r.values.quotationStage, "quoted");
  ok("an unmodelled key is preserved for forward compatibility", "some_future_field" in r.extra);
  ok("missingFields is reported, not fatal", Array.isArray(r.missingFields));
});

run("OFFLINE FLOW SUITE (features 1-5, no database required)", [
  TC_Q01,
  TC_Q02,
  TC_Q03,
  TC_Q04,
  TC_M01,
  TC_M02,
  TC_WA01,
  TC_WA02,
  TC_WA03,
  TC_WA04,
  TC_WA05,
  TC_LS01,
  TC_LI01,
  TC_LI02,
  TC_LI03,
  TC_LI04,
  TC_LI05,
]);
