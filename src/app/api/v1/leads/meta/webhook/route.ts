import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { verifyChallenge, verifySignature } from "@/lib/meta-webhook";
import { importMetaLead } from "@/lib/meta-leads";
import { recordImport } from "@/lib/leads-import";

// GET/POST /api/v1/leads/meta/webhook
//
// Inbound Meta Lead Ads webhook. GET answers Meta's one-time subscription
// challenge; POST delivers a new leadgen event for each form submission.
//
// Auth: GET is verified by hub.verify_token === META_VERIFY_TOKEN. POST is
// verified by X-Hub-Signature-256 (HMAC-SHA256 over the RAW body) — see
// lib/meta-webhook.ts. Both fail closed when their secret isn't configured.
//
// Every leadgen_id in a delivery goes through lib/meta-leads.ts'
// importMetaLead(), which fetches field_data from the Graph API, normalizes
// it with the SAME tolerant parser leads-import.ts uses for the Transcriber,
// and upserts on contactKey (phone digits) with leadgen_id as the
// idempotency token — so a caller who also submitted a Meta form lands on
// one Lead, not two.
//
// This endpoint ALWAYS returns 200 once persistence was attempted for every
// leadgen_id in the payload (even a refused/errored one — it's still
// durably logged to LeadImport) so a refusal never triggers Meta's retry
// storm. Only a request that never reached the point of being handled at all
// (bad signature, unparseable body) fails to persist per-lead outcomes, and
// even those are audited before responding.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const result = verifyChallenge(req.nextUrl.searchParams, process.env.META_VERIFY_TOKEN);
  if (!result.ok) {
    console.warn(`[leads/meta/webhook] challenge rejected: ${result.reason}`);
    return NextResponse.json({ error: result.reason }, { status: 403 });
  }
  // Meta expects the raw challenge string as the response body, not JSON.
  return new NextResponse(result.challenge, { status: 200 });
}

type MetaChangeValue = {
  leadgen_id?: string;
  form_id?: string;
  ad_id?: string;
  adgroup_id?: string; // = adset id
  campaign_id?: string;
  page_id?: string;
  platform?: string; // "fb" | "ig" when Meta includes it
};

type MetaWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    changes?: Array<{ field?: string; value?: MetaChangeValue }>;
  }>;
};

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id")?.trim() || randomUUID();

  // Raw body is mandatory here — the signature is computed over the exact
  // bytes Meta sent. Using req.json() would re-serialize and silently break
  // verification (or invite skipping it altogether).
  const rawBody = await req.text();

  const sig = verifySignature(rawBody, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET);
  if (!sig.ok) {
    console.warn(`[leads/meta/webhook] ${requestId} signature rejected: ${sig.reason}`);
    await recordImport({
      callId: null,
      leadId: null,
      payload: { _rejectedRawBody: rawBody.slice(0, 4000) },
      outcome: "rejected",
      statusCode: 401,
      message: `Signature verification failed: ${sig.reason}`,
      apiKeyLabel: "meta-webhook",
      requestId,
      channel: "meta",
    });
    // Still 200: a bad signature won't fix itself on retry, and Meta's retry
    // storm on a non-2xx is worse than a silently dropped forged request.
    return NextResponse.json({ ok: false, requestId }, { status: 200 });
  }

  let body: MetaWebhookBody;
  try {
    body = JSON.parse(rawBody) as MetaWebhookBody;
  } catch {
    await recordImport({
      callId: null,
      leadId: null,
      payload: { _unparsedBody: rawBody.slice(0, 4000) },
      outcome: "rejected",
      statusCode: 400,
      message: "Request body is not valid JSON.",
      apiKeyLabel: "meta-webhook",
      requestId,
      channel: "meta",
    });
    return NextResponse.json({ ok: false, requestId }, { status: 200 });
  }

  const mode = req.nextUrl.searchParams.get("mode") === "replace" ? "replace" : "merge";

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (change.field !== "leadgen" || !value || !value.leadgen_id) continue;

      await importMetaLead({
        leadgenId: value.leadgen_id,
        tracking: {
          campaignId: value.campaign_id ?? null,
          adsetId: value.adgroup_id ?? null,
          adId: value.ad_id ?? null,
          formId: value.form_id ?? null,
          platform: value.platform ?? null,
        },
        mode,
        requestId,
        apiKeyLabel: "meta-webhook",
        rawContext: { webhookValue: value },
      });
      // importMetaLead never throws and always audits — a failure for one
      // leadgen_id must not stop the rest of this delivery from processing.
    }
  }

  return NextResponse.json({ ok: true, requestId }, { status: 200 });
}
