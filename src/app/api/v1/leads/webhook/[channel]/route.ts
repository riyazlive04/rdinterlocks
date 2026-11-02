import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { importLead, normalizeLeadPayload, recordImport, type SourceMeta } from "@/lib/leads-import";
import {
  applyFieldMap,
  extractTracking,
  findChannel,
  verifyDelivery,
  type LeadWebhookChannel,
} from "@/lib/lead-webhook";
import {
  LEAD_IMPORT_LIMITS,
  MINUTE_MS,
  clientIp,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";

// POST /api/v1/leads/webhook/[channel]
//
// Provider-agnostic inbound lead webhook. The contract served to providers is
// docs/lead-webhook-contract.md; the configuration model and signature
// schemes are in lib/lead-webhook.ts.
//
// How this differs from the two routes next to it, and why all three exist:
//
//   leads/import          API key in a header, Transcriber posts call extracts
//   leads/meta/webhook    Meta itself posts a leadgen_id, we fetch from Graph
//   leads/webhook/[ch]    anyone else posts field data inline, HMAC-signed
//
// The third is the one a relay or agency dashboard can actually use. It takes
// no Graph token, makes no outbound call, and adds a provider through one env
// entry rather than a deploy.
//
// Unlike the Meta route, this one answers with REAL status codes (401 on a bad
// signature, 400 on an unusable payload). Meta's retry storm is the reason
// that route lies with a 200; a provider we issue a contract to is told to
// retry only on 429/5xx, so honest codes are both safe and far more
// debuggable. Every delivery is persisted to LeadWebhookDelivery before it is
// interpreted, so a rejection is visible to the operator even though the
// sender is told nothing beyond the code.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_VERSION = "v1";
const MAX_BODY_BYTES = 1_000_000;
const MAX_BATCH = 100;

type ErrorCode =
  | "unknown_channel"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_payload"
  | "missing_phone"
  | "batch_too_large"
  | "rate_limited"
  | "invalid_signature"
  | "stale_timestamp"
  | "internal_error";

function fail(
  status: number,
  code: ErrorCode,
  message: string,
  requestId: string,
  headers: Record<string, string> = {}
) {
  return NextResponse.json(
    { ok: false, apiVersion: API_VERSION, requestId, error: { code, message } },
    { status, headers: { "X-Request-Id": requestId, ...headers } }
  );
}

/**
 * Only the headers that explain the delivery, and the signature never
 * verbatim.
 *
 * Storing the raw signature header looks harmless for the HMAC schemes, where
 * it is a digest, but under `scheme: "bearer"` that header value IS the shared
 * credential — so persisting it would turn every delivery row into a copy of
 * the secret, readable by anyone with DB access or an export of this table.
 * A truncated fingerprint is all the forensics actually need: enough to tell
 * two deliveries apart and to confirm the sender changed what it presented,
 * never enough to replay it.
 */
function auditHeaders(req: NextRequest, channel: LeadWebhookChannel) {
  const presented = req.headers.get(channel.signatureHeader);
  return {
    [channel.signatureHeader]: presented
      ? `redacted:sha256:${createHash("sha256").update(presented).digest("hex").slice(0, 12)}`
      : null,
    [channel.timestampHeader]: req.headers.get(channel.timestampHeader) ?? null,
    "content-type": req.headers.get("content-type") ?? null,
    "user-agent": req.headers.get("user-agent") ?? null,
  };
}

function externalIdOf(payload: Record<string, unknown>): string | null {
  for (const key of ["leadId", "lead_id", "leadgenId", "leadgen_id", "id"]) {
    const v = payload[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

type OneResult = {
  externalId: string | null;
  outcome: "created" | "updated" | "conflict" | "rejected" | "error";
  statusCode: number;
  leadRef: string | null;
  missingFields: string[];
  message: string;
};

/**
 * Import one submission. Never throws — a bad entry in a batch must not stop
 * the rest, and the caller needs a per-lead outcome either way.
 */
async function importOne(
  channel: LeadWebhookChannel,
  payload: Record<string, unknown>,
  deliveryId: string,
  requestId: string
): Promise<OneResult> {
  const externalId = externalIdOf(payload);
  const mapped = applyFieldMap(payload, channel.fieldMap);
  const { values, extra, missingFields } = normalizeLeadPayload(mapped);

  // The provider's submission id is this channel's idempotency token, exactly
  // as leadgen_id is for the Meta route and callId is for the Transcriber:
  // re-delivering it merges into the same lead instead of counting a new
  // touchpoint. Without one we fall back to whatever callId the payload
  // carried, which may be nothing — an unidentified submission still imports,
  // it just cannot be deduplicated on replay.
  if (externalId) values.callId = externalId;

  // contactKey is derived from the phone number by normalizeLeadPayload. With
  // no phone at all there is nothing to group on and nobody to call, so this
  // is the one field whose absence is fatal.
  if (!values.contactKey) {
    return {
      externalId,
      outcome: "rejected",
      statusCode: 400,
      leadRef: null,
      missingFields,
      message: "No phone number — the submission cannot be grouped or acted on.",
    };
  }

  const sourceMeta: SourceMeta = { source: channel.source, ...extractTracking(payload) };

  try {
    const result = await importLead(values, extra, "merge", sourceMeta);
    const statusCode = result.outcome === "created" ? 201 : result.outcome === "conflict" ? 409 : 200;

    await recordImport({
      callId: values.callId || externalId,
      leadId: result.lead.id,
      payload: { delivery: deliveryId, payload },
      outcome: result.outcome,
      statusCode,
      message: result.outcome === "conflict" ? result.message : "",
      apiKeyLabel: `webhook:${channel.channel}`,
      requestId,
      channel: channel.channel,
    });

    return {
      externalId,
      outcome: result.outcome,
      statusCode,
      leadRef: result.lead.id,
      missingFields,
      message: result.outcome === "conflict" ? result.message : "",
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[leads/webhook/${channel.channel}] ${requestId} import failed`, e);
    await recordImport({
      callId: values.callId || externalId,
      leadId: null,
      payload: { delivery: deliveryId, payload },
      outcome: "error",
      statusCode: 500,
      message,
      apiKeyLabel: `webhook:${channel.channel}`,
      requestId,
      channel: channel.channel,
    });
    return { externalId, outcome: "error", statusCode: 500, leadRef: null, missingFields, message };
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ channel: string }> }) {
  const requestId = req.headers.get("x-request-id")?.trim() || randomUUID();
  const { channel: channelName } = await ctx.params;

  const channel = findChannel(channelName);
  if (!channel) {
    // Deliberately the same shape of answer as a bad signature: an unknown
    // channel name must not be distinguishable from a known one with the
    // wrong secret, or the endpoint becomes a channel-name oracle.
    console.warn(`[leads/webhook] ${requestId} unknown or unconfigured channel ${JSON.stringify(channelName)}`);
    return fail(401, "unknown_channel", "Unknown channel or invalid credentials.", requestId);
  }

  // Rate limiting before the body is read, so a flood cannot be amplified
  // into a megabyte of reads each. Reuses the leads/import limiter so one
  // misbehaving provider cannot exhaust the Transcriber's budget.
  const ip = clientIp(req.headers);
  const ipLimit = rateLimit(`webhook-ip:${ip}`, LEAD_IMPORT_LIMITS.perIpPerMinute(), MINUTE_MS);
  if (!ipLimit.ok) {
    return fail(429, "rate_limited", "Too many requests.", requestId, rateLimitHeaders(ipLimit));
  }
  const chLimit = rateLimit(`webhook-ch:${channel.channel}`, LEAD_IMPORT_LIMITS.perKeyPerMinute(), MINUTE_MS);
  if (!chLimit.ok) {
    return fail(429, "rate_limited", "Too many requests for this channel.", requestId, rateLimitHeaders(chLimit));
  }

  // Refuse an oversized body from its declared length BEFORE reading it.
  // Checking only after req.text() means a 50MB post is fully buffered into
  // this process before being rejected, which is the cheap way to exhaust a
  // small VPS. Content-Length is attacker-controlled, so the post-read check
  // below still stands as the real enforcement — this is just the early out.
  const declaredLength = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return fail(413, "payload_too_large", `Body exceeds ${MAX_BODY_BYTES} bytes.`, requestId);
  }

  // Raw bytes, because that is what was signed. Parsing first and
  // re-serialising would break verification for any provider whose key order
  // or whitespace differs from ours.
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return fail(413, "payload_too_large", `Body exceeds ${MAX_BODY_BYTES} bytes.`, requestId);
  }

  const verdict = verifyDelivery(channel, rawBody, req.headers);

  // Persist the delivery before acting on it — including a rejected one. This
  // row is the only place an operator can see that a provider is signing
  // wrongly, since the response tells them nothing specific.
  const delivery = await prisma.leadWebhookDelivery.create({
    data: {
      channel: channel.channel,
      headers: auditHeaders(req, channel),
      body: rawBody.slice(0, MAX_BODY_BYTES),
      requestId,
      status: verdict.ok ? "pending" : "rejected",
      message: verdict.ok ? "" : `${verdict.reason}: ${verdict.detail}`,
      // The code we actually answered with, not a blanket 401 — a clock-skew
      // rejection (408) and a wrong-secret rejection (401) call for opposite
      // responses from the provider, so the audit row has to tell them apart.
      statusCode: verdict.ok ? 0 : verdict.reason === "stale_timestamp" ? 408 : 401,
      attempts: 1,
      lastAttempt: new Date(),
    },
    select: { id: true },
  });

  if (!verdict.ok) {
    console.warn(`[leads/webhook/${channel.channel}] ${requestId} rejected: ${verdict.reason}`);
    const stale = verdict.reason === "stale_timestamp";
    return fail(
      stale ? 408 : 401,
      stale ? "stale_timestamp" : "invalid_signature",
      stale ? verdict.detail : "Unknown channel or invalid credentials.",
      requestId
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    await prisma.leadWebhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "rejected", statusCode: 400, message: "Body is not valid JSON." },
    });
    return fail(400, "invalid_json", "Request body is not valid JSON.", requestId);
  }

  if (typeof body !== "object" || body === null) {
    await prisma.leadWebhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "rejected", statusCode: 400, message: "Body is not a JSON object." },
    });
    return fail(400, "invalid_payload", "Request body must be a JSON object.", requestId);
  }

  const envelope = body as Record<string, unknown>;
  const batch = Array.isArray(envelope.leads) ? (envelope.leads as unknown[]) : null;

  if (batch && batch.length > MAX_BATCH) {
    await prisma.leadWebhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "rejected", statusCode: 400, message: `Batch of ${batch.length} exceeds ${MAX_BATCH}.` },
    });
    return fail(400, "batch_too_large", `Send at most ${MAX_BATCH} leads per request.`, requestId);
  }

  // ─── Single submission ───────────────────────────────────────────
  if (!batch) {
    const result = await importOne(channel, envelope, delivery.id, requestId);
    await prisma.leadWebhookDelivery.update({
      where: { id: delivery.id },
      data: {
        externalId: result.externalId,
        status:
          result.outcome === "created" || result.outcome === "updated"
            ? "imported"
            : result.outcome === "conflict"
              ? "duplicate"
              : result.outcome === "rejected"
                ? "rejected"
                : "failed",
        outcome: result.outcome,
        statusCode: result.statusCode,
        message: result.message,
        leadId: result.leadRef,
      },
    });

    if (result.outcome === "rejected") {
      return fail(400, "missing_phone", result.message, requestId);
    }
    if (result.outcome === "error") {
      return fail(500, "internal_error", "The lead could not be stored; please retry.", requestId);
    }

    return NextResponse.json(
      {
        ok: true,
        apiVersion: API_VERSION,
        requestId,
        outcome: result.outcome,
        leadRef: result.leadRef,
        missingFields: result.missingFields,
      },
      { status: result.statusCode, headers: { "X-Request-Id": requestId } }
    );
  }

  // ─── Batch ───────────────────────────────────────────────────────
  const results: OneResult[] = [];
  for (const entry of batch) {
    if (typeof entry !== "object" || entry === null) {
      results.push({
        externalId: null,
        outcome: "rejected",
        statusCode: 400,
        leadRef: null,
        missingFields: [],
        message: "Entry is not a JSON object.",
      });
      continue;
    }
    results.push(await importOne(channel, entry as Record<string, unknown>, delivery.id, requestId));
  }

  const accepted = results.filter((r) => r.outcome === "created" || r.outcome === "updated").length;
  const anyFailed = results.some((r) => r.outcome === "rejected" || r.outcome === "error");

  await prisma.leadWebhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: anyFailed ? (accepted > 0 ? "failed" : "rejected") : "imported",
      outcome: `batch:${accepted}/${results.length}`,
      statusCode: anyFailed ? 207 : 200,
      message: anyFailed
        ? results
            .filter((r) => r.message)
            .map((r) => `${r.externalId ?? "?"}: ${r.message}`)
            .join("; ")
            .slice(0, 2000)
        : "",
    },
  });

  return NextResponse.json(
    {
      ok: !anyFailed,
      apiVersion: API_VERSION,
      requestId,
      accepted,
      total: results.length,
      results: results.map((r) => ({
        leadId: r.externalId,
        outcome: r.outcome,
        leadRef: r.leadRef,
        missingFields: r.missingFields,
        ...(r.message ? { message: r.message } : {}),
      })),
    },
    { status: anyFailed ? 207 : 200, headers: { "X-Request-Id": requestId } }
  );
}

/**
 * Some provider platforms verify an endpoint with a GET before they will let
 * you save it. Answering with a 200 and nothing else satisfies that probe
 * without disclosing whether the channel name is real — findChannel is
 * deliberately not consulted here.
 */
export async function GET() {
  return NextResponse.json({ ok: true, apiVersion: API_VERSION });
}
