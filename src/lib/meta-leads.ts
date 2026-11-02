import {
  importLead,
  normalizeLeadPayload,
  recordImport,
  type SourceMeta,
} from "./leads-import";

// Shared plumbing for Meta Lead Ads ingestion — used by both the webhook
// (api/v1/leads/meta/webhook) and the admin backfill (api/v1/leads/meta/sync)
// so there's exactly one place that turns a Graph API lead into a Lead row.
//
// The actual upsert/merge/idempotency logic is NOT reimplemented here — every
// Meta lead is normalized into the same shape leads-import.ts already
// understands and passed straight to importLead(), with leadgen_id standing
// in for callId (Meta's equivalent idempotency token: a retried delivery of
// the same leadgen_id updates without bumping callSequence, exactly like a
// retried Transcriber callId).

const GRAPH_VERSION = "v21.0";

export type GraphFieldDatum = { name: string; values?: string[] };

export type GraphLead = {
  id?: string;
  form_id?: string;
  ad_id?: string;
  field_data?: GraphFieldDatum[];
};

function graphAccessToken(): string {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("META_PAGE_ACCESS_TOKEN is not configured");
  return token;
}

async function graphErrorMessage(res: Response): Promise<string> {
  const json = await res.json().catch(() => null);
  return (json as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
}

/** Fetch field_data for a single lead by its leadgen_id. */
export async function fetchLeadFieldData(leadgenId: string): Promise<GraphLead> {
  const token = graphAccessToken();
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(leadgenId)}?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Graph API fetch failed for leadgen_id ${leadgenId}: ${await graphErrorMessage(res)}`);
  }
  return (await res.json()) as GraphLead;
}

/**
 * List leads for a form, newest first, paged through automatically (capped —
 * this is a manual/catch-up backfill, not a full export tool). Used by the
 * sync endpoint; the webhook never calls this, it only ever fetches one
 * leadgen_id at a time as deliveries arrive.
 */
export async function listFormLeads(
  formId: string,
  opts: { since?: Date; until?: Date; limit?: number } = {}
): Promise<GraphLead[]> {
  const token = graphAccessToken();
  const filtering: Array<{ field: string; operator: string; value: number }> = [];
  if (opts.since) {
    filtering.push({ field: "time_created", operator: "GREATER_THAN", value: Math.floor(opts.since.getTime() / 1000) });
  }
  if (opts.until) {
    filtering.push({ field: "time_created", operator: "LESS_THAN", value: Math.floor(opts.until.getTime() / 1000) });
  }
  const params = new URLSearchParams({ access_token: token, fields: "id,ad_id,form_id,field_data" });
  if (filtering.length) params.set("filtering", JSON.stringify(filtering));
  params.set("limit", String(Math.min(opts.limit ?? 100, 100)));

  const out: GraphLead[] = [];
  let url: string | null = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(formId)}/leads?${params.toString()}`;
  const MAX_PAGES = 20; // hard cap — this is a catch-up tool, not a full export
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res: Response = await fetch(url);
    if (!res.ok) throw new Error(`Graph API list failed for form ${formId}: ${await graphErrorMessage(res)}`);
    const json = (await res.json()) as { data?: GraphLead[]; paging?: { next?: string } };
    out.push(...(json.data ?? []));
    url = json.paging?.next ?? null;
  }
  return out;
}

function flattenFieldData(fieldData: GraphFieldDatum[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fieldData ?? []) out[f.name] = f.values?.[0] ?? "";
  return out;
}

export type MetaLeadTracking = Omit<SourceMeta, "source">;

export type ImportMetaLeadResult = { outcome: "created" | "updated" | "conflict" | "error"; leadId: string | null };

/**
 * The single choke point every Meta-sourced lead passes through: fetch
 * field_data if not already known, normalize with the same tolerant parser
 * the Transcriber uses, upsert via importLead (leadgen_id as the idempotency
 * token), and audit every outcome — including a Graph fetch failure or a
 * refused (already-converted) lead — exactly like leads-import.ts does for
 * the Transcriber. Never throws; the caller always gets an outcome back.
 */
export async function importMetaLead(opts: {
  leadgenId: string;
  fieldData?: GraphFieldDatum[];
  tracking: MetaLeadTracking;
  mode: "merge" | "replace";
  requestId: string;
  apiKeyLabel: string;
  rawContext?: unknown;
}): Promise<ImportMetaLeadResult> {
  let fieldData = opts.fieldData;
  let graphLead: GraphLead | null = null;

  if (!fieldData) {
    try {
      graphLead = await fetchLeadFieldData(opts.leadgenId);
      fieldData = graphLead.field_data;
    } catch (e) {
      await recordImport({
        callId: opts.leadgenId,
        leadId: null,
        payload: { context: opts.rawContext, fetchError: e instanceof Error ? e.message : String(e) },
        outcome: "error",
        statusCode: 502,
        message: e instanceof Error ? e.message : String(e),
        apiKeyLabel: opts.apiKeyLabel,
        requestId: opts.requestId,
        channel: "meta",
      });
      return { outcome: "error", leadId: null };
    }
  }

  const flat = flattenFieldData(fieldData);
  const { values, extra } = normalizeLeadPayload(flat);
  // leadgen_id is Meta's equivalent of a Transcriber callId — the token that
  // makes a retried delivery an idempotent update instead of a double count.
  values.callId = opts.leadgenId;

  const sourceMeta: SourceMeta = { source: "meta", ...opts.tracking };
  const payload = { context: opts.rawContext, graphLead: graphLead ?? { field_data: fieldData } };

  try {
    const result = await importLead(values, extra, opts.mode, sourceMeta);

    if (result.outcome === "conflict") {
      await recordImport({
        callId: opts.leadgenId,
        leadId: result.lead.id,
        payload,
        outcome: "conflict",
        statusCode: 409,
        message: result.message,
        apiKeyLabel: opts.apiKeyLabel,
        requestId: opts.requestId,
        channel: "meta",
      });
      return { outcome: "conflict", leadId: result.lead.id };
    }

    await recordImport({
      callId: opts.leadgenId,
      leadId: result.lead.id,
      payload,
      outcome: result.outcome,
      statusCode: result.outcome === "created" ? 201 : 200,
      message: "",
      apiKeyLabel: opts.apiKeyLabel,
      requestId: opts.requestId,
      channel: "meta",
    });
    return { outcome: result.outcome, leadId: result.lead.id };
  } catch (e) {
    console.error(`[meta-leads] ${opts.requestId} failed for leadgen_id ${opts.leadgenId}`, e);
    await recordImport({
      callId: opts.leadgenId,
      leadId: null,
      payload,
      outcome: "error",
      statusCode: 500,
      message: e instanceof Error ? e.message : String(e),
      apiKeyLabel: opts.apiKeyLabel,
      requestId: opts.requestId,
      channel: "meta",
    });
    return { outcome: "error", leadId: null };
  }
}
