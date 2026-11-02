import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { importMetaLead, listFormLeads } from "@/lib/meta-leads";

// POST /api/v1/leads/meta/sync
//
// Admin-triggered catch-up: lists recent leads for a Lead Ads form directly
// from the Graph API and imports each one through the same path the webhook
// uses (lib/meta-leads.ts' importMetaLead). For leads generated before the
// webhook was subscribed, or missed during any downtime.
//
// This is an internal admin action, not a machine-to-machine integration —
// auth is the session cookie + admin role (same as api/export/route.ts),
// not the /api/v1 API-key scheme used by external callers.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const syncSchema = z.object({
  formId: z.string().min(1),
  since: z.string().optional(),
  until: z.string().optional(),
  mode: z.enum(["merge", "replace"]).default("merge"),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(session.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const requestId = randomUUID();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, requestId, error: "Request body is not valid JSON." }, { status: 400 });
  }
  const parsed = syncSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, requestId, error: parsed.error.flatten() }, { status: 400 });
  }
  const { formId, mode } = parsed.data;
  const since = parsed.data.since ? new Date(parsed.data.since) : undefined;
  const until = parsed.data.until ? new Date(parsed.data.until) : undefined;

  let leads;
  try {
    leads = await listFormLeads(formId, { since, until });
  } catch (e) {
    return NextResponse.json(
      { ok: false, requestId, error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  const results = { total: leads.length, created: 0, updated: 0, conflict: 0, error: 0 };
  for (const lead of leads) {
    if (!lead.id) {
      results.error++;
      continue;
    }
    const { outcome } = await importMetaLead({
      leadgenId: lead.id,
      fieldData: lead.field_data,
      // The list endpoint doesn't return campaign/adset without a further
      // per-ad lookup — left null here rather than adding N extra Graph
      // calls to a catch-up tool; the webhook path (which does get them from
      // the change payload) is the primary source for that metadata.
      tracking: { formId: lead.form_id ?? formId, adId: lead.ad_id ?? null, campaignId: null, adsetId: null, platform: null },
      mode,
      requestId,
      apiKeyLabel: `sync:${session.name}`,
      rawContext: { syncFormId: formId },
    });
    results[outcome]++;
  }

  return NextResponse.json({ ok: true, requestId, ...results });
}
