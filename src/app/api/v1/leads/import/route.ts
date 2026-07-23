import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { authenticateApiRequest } from "@/lib/api-auth";
import { importLead, normalizeLeadPayload, recordImport } from "@/lib/leads-import";
import {
  FIFTEEN_MIN_MS,
  LEAD_IMPORT_LIMITS,
  MINUTE_MS,
  RateLimitResult,
  clientIp,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";

// POST /api/v1/leads/import
//
// Ingest one structured lead extracted from a recorded call by the Transcriber.
//
// Auth        : Authorization: Bearer <key>   (or X-API-Key: <key>)
// Idempotency : keyed on callId — re-sending the same call updates, never duplicates
// Versioning  : the path is the contract. Additive changes ship in v1; anything
//               that would break an existing caller ships as /api/v2/… instead.
//
//   201 created   — first time this callId was seen
//   200 updated   — callId already known, record merged
//   400 bad input — unparseable body, or no callId to key on
//   401 no auth   — missing or invalid API key
//   409 conflict  — the lead was already converted to a client; import refused
//   413 too large — body over the size cap
//   429 throttled — rate limit exceeded; see Retry-After
//   500 error     — unexpected server failure (or missing key configuration)
//
// Partial extractions are expected and accepted: any of the ten fields may be
// absent, and are stored as "" / null with the names listed back in
// `missingFields`. Unknown fields are preserved in the lead's `extra` object,
// so the Transcriber can start sending a new field before this app models it.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_VERSION = "v1";
const MAX_BODY_BYTES = 1_000_000; // 1 MB — a transcript summary is a few KB

type ErrorCode =
  | "unauthorized"
  | "server_not_configured"
  | "rate_limited"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_payload"
  | "missing_call_id"
  | "already_converted"
  | "internal_error";

function fail(
  status: number,
  code: ErrorCode,
  message: string,
  requestId: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {}
) {
  return NextResponse.json(
    { ok: false, apiVersion: API_VERSION, requestId, error: { code, message, ...extra } },
    { status, headers: { "X-Request-Id": requestId, ...headers } }
  );
}

function throttled(requestId: string, scope: string, r: RateLimitResult) {
  return fail(
    429,
    "rate_limited",
    `Rate limit exceeded (${scope}): more than ${r.limit} requests in the window. Retry after ${r.retryAfterSec}s. Imports are idempotent, so re-sending the same callId is safe.`,
    requestId,
    { retryAfterSeconds: r.retryAfterSec },
    rateLimitHeaders(r)
  );
}

export async function POST(req: NextRequest) {
  // Echo the caller's correlation id when they set one, so a failed import can
  // be traced across both systems from a single value.
  const requestId = req.headers.get("x-request-id")?.trim() || randomUUID();

  const ip = clientIp(req.headers);
  const failureKey = `leads:authfail:${ip}`;

  // ─── 1. Throttle before doing any work ──────────────────────────────
  // Cheapest possible rejection path: no body read, no auth, no DB.
  const ipLimit = rateLimit(`leads:ip:${ip}`, LEAD_IMPORT_LIMITS.perIpPerMinute(), MINUTE_MS);
  if (!ipLimit.ok) {
    console.warn(`[leads/import] ${requestId} ip rate limit hit for ${ip}`);
    return throttled(requestId, "per IP", ipLimit);
  }

  // ─── 2. Authenticate before touching the body ───────────────────────
  // Note the failure counter is consumed only AFTER a credential is rejected,
  // never as a pre-emptive gate. Blocking before the auth check would cap an
  // attacker no harder — a wrong key still gets 429 past the threshold — while
  // locking out a valid caller that shares the IP, or one that just fixed a
  // stale key, for the rest of the window.
  const auth = authenticateApiRequest(req.headers);
  if (!auth.ok) {
    if (auth.code === "not_configured") {
      console.error(`[leads/import] ${requestId} INTEGRATION_API_KEYS is not set`);
      return fail(500, "server_not_configured", auth.message, requestId);
    }
    // Count the failure, so repeated key guessing from one source gets cut off
    // rather than being allowed to run at the full per-IP request budget.
    const failures = rateLimit(
      failureKey,
      LEAD_IMPORT_LIMITS.authFailuresPer15Min(),
      FIFTEEN_MIN_MS
    );
    if (!failures.ok) {
      console.warn(`[leads/import] ${requestId} auth-failure limit hit for ${ip}`);
      return throttled(requestId, "failed authentication attempts", failures);
    }
    return fail(401, "unauthorized", auth.message, requestId);
  }
  const apiKeyLabel = auth.identity.label;

  // The failure counter is deliberately NOT cleared on success. Since a valid
  // credential is never gated on it, clearing would only hand an attacker
  // sharing this IP a fresh budget of guesses on every legitimate request.

  // ─── 3. Per-credential limit ────────────────────────────────────────
  const keyLimit = rateLimit(
    `leads:key:${apiKeyLabel}`,
    LEAD_IMPORT_LIMITS.perKeyPerMinute(),
    MINUTE_MS
  );
  if (!keyLimit.ok) {
    console.warn(`[leads/import] ${requestId} key rate limit hit for "${apiKeyLabel}"`);
    return throttled(requestId, "per API key", keyLimit);
  }
  // Throttled responses are deliberately NOT audited: writing a row per blocked
  // request would hand an attacker a way to flood the table we use for audit.
  const limitHeaders = rateLimitHeaders(keyLimit);

  const audit = (row: {
    callId: string | null;
    leadId: string | null;
    payload: unknown;
    outcome: string;
    statusCode: number;
    message: string;
  }) => recordImport({ ...row, apiKeyLabel, requestId });

  try {
    // ─── 4. Read and parse the body ───────────────────────────────────
    const text = await req.text();

    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
      const message = `Request body exceeds the ${MAX_BODY_BYTES} byte limit.`;
      await audit({
        callId: null,
        leadId: null,
        payload: { _truncatedBody: text.slice(0, 2000) },
        outcome: "rejected",
        statusCode: 413,
        message,
      });
      return fail(413, "payload_too_large", message, requestId, {}, limitHeaders);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const message = "Request body is not valid JSON.";
      // Still audited — an integration sending malformed JSON needs the evidence.
      await audit({
        callId: null,
        leadId: null,
        payload: { _unparsedBody: text.slice(0, 4000) },
        outcome: "rejected",
        statusCode: 400,
        message,
      });
      return fail(400, "invalid_json", message, requestId, {}, limitHeaders);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      const message =
        "Request body must be a JSON object describing one lead. Batch arrays are not accepted on this endpoint.";
      await audit({
        callId: null,
        leadId: null,
        payload: { _rejectedBody: parsed },
        outcome: "rejected",
        statusCode: 400,
        message,
      });
      return fail(400, "invalid_payload", message, requestId, {}, limitHeaders);
    }

    const body = parsed as Record<string, unknown>;

    // ─── 5. Normalise ─────────────────────────────────────────────────
    const { values, missingFields, warnings, extra } = normalizeLeadPayload(body);

    // The one genuinely required field. Without it there is no idempotency key,
    // so every retry would create a duplicate — the exact thing this endpoint
    // exists to prevent. Everything else may be blank.
    if (!values.callId) {
      const message =
        "Field 'callId' is required — it is the idempotency key for the call. Accepted aliases: callId, call_id, recordingId, conversationId, sessionId, id.";
      await audit({
        callId: null,
        leadId: null,
        payload: body,
        outcome: "rejected",
        statusCode: 400,
        message,
      });
      return fail(400, "missing_call_id", message, requestId, { field: "callId" }, limitHeaders);
    }

    // ?mode=replace overwrites every field, including with blanks. The default
    // merge keeps values an earlier, richer extraction already established.
    const mode = req.nextUrl.searchParams.get("mode") === "replace" ? "replace" : "merge";

    // ─── 6. Idempotent upsert ─────────────────────────────────────────
    const result = await importLead(values, extra, mode);

    if (result.outcome === "conflict") {
      await audit({
        callId: values.callId,
        leadId: result.lead.id,
        payload: body,
        outcome: "conflict",
        statusCode: 409,
        message: result.message,
      });
      return fail(
        409,
        "already_converted",
        result.message,
        requestId,
        { leadId: result.lead.id, callId: result.lead.callId },
        limitHeaders
      );
    }

    const status = result.outcome === "created" ? 201 : 200;
    await audit({
      callId: values.callId,
      leadId: result.lead.id,
      payload: body,
      outcome: result.outcome,
      statusCode: status,
      message: warnings.join("; "),
    });

    return NextResponse.json(
      {
        ok: true,
        apiVersion: API_VERSION,
        requestId,
        outcome: result.outcome,
        // The stored record, not the request. On a merge these differ: fields
        // absent from this payload keep the values an earlier import set.
        lead: {
          ...result.lead,
          followUpDate: result.lead.followUpDate?.toISOString() ?? null,
        },
        // Advisory, not errors: what THIS payload didn't carry, and what
        // couldn't be coerced. The record was still saved.
        missingFields,
        warnings,
        extraFields: Object.keys(extra),
      },
      { status, headers: { "X-Request-Id": requestId, ...limitHeaders } }
    );
  } catch (e) {
    // Never leak a stack trace or a driver message to the caller.
    console.error(`[leads/import] ${requestId} unhandled error`, e);
    await audit({
      callId: null,
      leadId: null,
      payload: { _error: true },
      outcome: "error",
      statusCode: 500,
      message: e instanceof Error ? e.message : String(e),
    });
    return fail(
      500,
      "internal_error",
      `The lead could not be saved due to a server error. Retry with the same callId — the import is idempotent. Quote request id ${requestId} when reporting this.`,
      requestId,
      {},
      limitHeaders
    );
  }
}
