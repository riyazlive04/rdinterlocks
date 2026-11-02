import { randomUUID } from "crypto";
import { prisma } from "./db";
import { importMetaLead, type GraphFieldDatum } from "./meta-leads";
import { normalizeLeadPayload, normalizePhoneKey } from "./leads-import";

// Backfill ingestion for Meta Lead Ads submissions that were captured by an
// UPSTREAM relay rather than by this CRM's own webhook.
//
// Why this exists alongside api/v1/leads/meta/*: the Lead Ads form for the RD
// Interlock Bricks page has been collecting submissions into another system
// (the "Sirah CRM" relay) since well before this CRM's webhook was
// subscribed. Those leads will never arrive as webhook deliveries — Meta only
// pushes a leadgen event once — and they can't be recovered with the Graph
// API catch-up either, because `/{form_id}/leads` needs a page access token
// for a form whose history predates the one we hold. The relay exposes them
// as a cursored JSON export, so that export becomes a third inbound channel.
//
// What it deliberately does NOT do: reimplement any of the upsert, merge,
// idempotency or audit logic. Every row is reshaped into the same
// `field_data` array a Graph API lead would have and handed to
// importMetaLead(), so a relay-sourced lead and a webhook-sourced lead are
// the same thing by the time they reach the database — including the
// leadgen_id idempotency token that makes re-running this a no-op update
// instead of a duplicate.

const DEFAULT_PAGE_SIZE = 500; // what the relay returns when `limit` is unset
const MAX_PAGES = 50; // guard against a cursor that never advances

/** One row of the relay's export. Every field is optional on purpose — this
 *  is someone else's payload and a missing key must not throw. */
export type FeedLead = {
  /** The relay's own row id. NOT the Meta lead id — see leadgen_id. */
  id?: string | null;
  /** Meta's leadgen_id: the idempotency token this whole path hangs on. */
  leadgen_id?: string | null;
  /** When the relay captured the row (what the `since` cursor pages on). */
  created_at?: string | null;
  /** When the customer actually submitted the form, per Meta. */
  submitted_at?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  source?: string | null;
  platform?: string | null;
  page_id?: string | null;
  page_name?: string | null;
  form_id?: string | null;
  ad_id?: string | null;
  /** The form's question/answer pairs, keyed by the question's field name. */
  answers?: Record<string, string | null> | null;
};

export type FeedPage = {
  leads: FeedLead[];
  /** Cursor to pass back as `since` for the next page; null when absent. */
  nextSince: string | null;
  tenant: string | null;
};

function squash(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function feedConfig(): { url: string; token: string } {
  const url = process.env.FACEBOOK_FEED_URL;
  const token = process.env.FACEBOOK_FEED_TOKEN;
  if (!url) throw new Error("FACEBOOK_FEED_URL is not configured");
  if (!token) throw new Error("FACEBOOK_FEED_TOKEN is not configured");
  return { url, token };
}

/** Fetch one page of the relay's export, newest-last (it orders by capture time). */
export async function fetchFeedPage(
  opts: { since?: string | null; limit?: number } = {}
): Promise<FeedPage> {
  const { url, token } = feedConfig();
  const params = new URLSearchParams({ token, format: "json" });
  if (opts.since) params.set("since", opts.since);
  if (opts.limit) params.set("limit", String(opts.limit));

  const res = await fetch(`${url}?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    // Deliberately does not echo the body: the token travels in the query
    // string, and an error page from the relay may quote the whole URL back.
    throw new Error(`Facebook lead feed returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    leads?: FeedLead[];
    next_since?: string | null;
    tenant?: string | null;
  };
  return {
    leads: Array.isArray(json.leads) ? json.leads : [],
    nextSince: json.next_since ?? null,
    tenant: json.tenant ?? null,
  };
}

// ─── Mapping ──────────────────────────────────────────────────────────

/** First answer whose field name matches, compared on the squashed key so
 *  "when_are_you_going_start_to_construction?" is reachable without hardcoding
 *  the exact punctuation the form happens to use today. */
function answerOf(lead: FeedLead, match: RegExp): string {
  for (const [k, v] of Object.entries(lead.answers ?? {})) {
    if (typeof v !== "string" || !v.trim()) continue;
    if (match.test(squash(k))) return v.trim();
  }
  return "";
}

// Lead Ads multiple-choice answers arrive as the option's slug, sometimes with
// a leading underscore Meta adds to options that begin with a digit or that
// collide with a reserved word: "_budget_home", "_warehouse/_godown",
// "1_month_later". Rendered verbatim they look like a bug to the office.
export function prettyOption(raw: string): string {
  const s = raw
    .trim()
    .replace(/^_+/, "")
    .replace(/_*\/_*/g, " / ")
    .replace(/_+/g, " ")
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

// Meta sends a synthetic submission through every form when it is created or
// tested, with every value set to a "<test lead: dummy data for X>" string.
// It has no phone number and no customer behind it.
const TEST_MARKER = /^<test lead:/i;

export function isTestLead(lead: FeedLead): boolean {
  const candidates = [lead.name, lead.first_name, lead.last_name, ...Object.values(lead.answers ?? {})];
  return candidates.some((v) => typeof v === "string" && TEST_MARKER.test(v.trim()));
}

/** fb/ig as the relay reports it → the facebook|instagram the Lead row stores. */
function platformOf(lead: FeedLead): string | null {
  const p = (lead.platform ?? "").toLowerCase();
  if (p === "fb" || p === "facebook") return "facebook";
  if (p === "ig" || p === "instagram") return "instagram";
  // Fall back to the human label ("Instagram Lead Ads") when platform is null,
  // which the relay leaves unset on some older rows.
  const s = (lead.source ?? "").toLowerCase();
  if (s.includes("instagram")) return "instagram";
  if (s.includes("facebook")) return "facebook";
  return null;
}

/**
 * Reshape a relay row into the `field_data` array importMetaLead expects.
 *
 * Field NAMES matter: they are matched against leads-import.ts' alias table,
 * so "full_name" → customerName, "city" → place and
 * "type_of_construction" → constructionType without anything extra here.
 * Names that are deliberately NOT aliases ("timeline", "fbSubmittedAt", …)
 * fall through to the Lead's `extra` JSON, which the lead detail page renders
 * as a key/value list — that's where the form's own questions stay readable
 * without overwriting `notes`, which belongs to whoever actually spoke to the
 * customer.
 */
export function feedLeadToFieldData(lead: FeedLead): GraphFieldDatum[] {
  const out: GraphFieldDatum[] = [];
  const push = (name: string, value: string | null | undefined) => {
    const v = (value ?? "").trim();
    if (v) out.push({ name, values: [v] });
  };

  const name = (lead.name ?? "").trim() || [lead.first_name, lead.last_name].filter(Boolean).join(" ");
  push("full_name", name);
  // Top-level phone first; the form's own phone answer is the fallback.
  push("phone", lead.phone ?? answerOf(lead, /phone|mobile/));
  push("email", lead.email);
  push("city", answerOf(lead, /^city$|town|location|place/));

  // "What are you going to build?" is the closest thing this form has to a
  // construction type — except for the "not_now" option, which answers
  // "nothing yet". Mapping that to constructionType would put the literal
  // text "Not now" in the field the quotation reads for the type of work, so
  // it's kept as context instead.
  const build = prettyOption(answerOf(lead, /build/));
  if (build && !/^not now$/i.test(build)) push("type_of_construction", build);
  else if (build) push("buildAnswer", build);

  push("timeline", prettyOption(answerOf(lead, /when|start/)));
  push("fbSubmittedAt", lead.submitted_at);
  push("fbPlatform", lead.platform);
  push("fbSourceLabel", lead.source);
  push("fbPageName", lead.page_name);
  push("fbRelayId", lead.id);
  return out;
}

function flatten(fieldData: GraphFieldDatum[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fieldData) out[f.name] = f.values?.[0] ?? "";
  return out;
}

/** The contactKey this row would upsert on, or "" when it has no usable phone. */
export function feedContactKey(lead: FeedLead): string {
  const phone = (lead.phone ?? answerOf(lead, /phone|mobile/)) || "";
  return normalizePhoneKey(phone);
}

// ─── Sync ─────────────────────────────────────────────────────────────

export type FeedSyncReport = {
  pages: number;
  fetched: number;
  skippedTest: number;
  skippedNoPhone: number;
  skippedNoLeadgenId: number;
  created: number;
  updated: number;
  conflict: number;
  error: number;
  backdated: number;
  /** Cursor to persist and pass as `since` on the next run. */
  nextSince: string | null;
  requestId: string;
};

export type FeedSyncOptions = {
  /** Relay capture-time cursor; omit for "everything the relay has". */
  since?: string | null;
  pageSize?: number;
  maxPages?: number;
  mode?: "merge" | "replace";
  /** Plan only: fetch and map, touch nothing. */
  dryRun?: boolean;
  /**
   * Set a newly created lead's createdAt/stageEnteredAt to the customer's
   * actual submission time instead of "now". These are months of backlog —
   * left at now(), 700+ leads would all read as having arrived today, which
   * is both wrong on the lead list (ordered by createdAt) and wrong in
   * reports (which bucket by createdAt). Only ever applied to rows this run
   * CREATED; an existing lead's history is never rewritten.
   */
  backdate?: boolean;
  apiKeyLabel?: string;
  onProgress?: (done: number, report: FeedSyncReport) => void;
};

export async function syncFacebookFeed(opts: FeedSyncOptions = {}): Promise<FeedSyncReport> {
  const mode = opts.mode ?? "merge";
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = Math.min(opts.maxPages ?? MAX_PAGES, MAX_PAGES);
  const requestId = randomUUID();

  const report: FeedSyncReport = {
    pages: 0,
    fetched: 0,
    skippedTest: 0,
    skippedNoPhone: 0,
    skippedNoLeadgenId: 0,
    created: 0,
    updated: 0,
    conflict: 0,
    error: 0,
    backdated: 0,
    nextSince: opts.since ?? null,
    requestId,
  };

  let since = opts.since ?? null;

  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchFeedPage({ since, limit: pageSize });
    report.pages++;
    report.fetched += batch.leads.length;
    if (!batch.leads.length) break;

    for (const lead of batch.leads) {
      if (isTestLead(lead)) {
        report.skippedTest++;
        continue;
      }
      if (!lead.leadgen_id) {
        // Without Meta's id there is no idempotency token, so a re-run would
        // re-import the row as another touchpoint. Skip rather than guess.
        report.skippedNoLeadgenId++;
        continue;
      }
      const fieldData = feedLeadToFieldData(lead);
      // contactKey is the upsert key and it is derived from the phone. An
      // empty one would make every phone-less row collide on the same ""
      // key, collapsing them into a single lead — refuse instead.
      const { values } = normalizeLeadPayload(flatten(fieldData));
      if (!values.contactKey) {
        report.skippedNoPhone++;
        continue;
      }

      if (opts.dryRun) {
        const exists = await prisma.lead.findUnique({
          where: { contactKey: values.contactKey },
          select: { id: true, convertedAt: true },
        });
        if (!exists) report.created++;
        else if (exists.convertedAt) report.conflict++;
        else report.updated++;
        opts.onProgress?.(report.fetched, report);
        continue;
      }

      const { outcome, leadId } = await importMetaLead({
        leadgenId: lead.leadgen_id,
        fieldData,
        tracking: {
          formId: lead.form_id ?? null,
          adId: lead.ad_id ?? null,
          // The relay does not carry campaign/adset, and there is no ad_id to
          // look them up from. Left null rather than invented.
          campaignId: null,
          adsetId: null,
          platform: platformOf(lead),
        },
        mode,
        requestId,
        apiKeyLabel: opts.apiKeyLabel ?? "facebook-feed",
        rawContext: { channel: "facebook-feed", relayId: lead.id, submittedAt: lead.submitted_at },
      });
      report[outcome]++;

      if (opts.backdate && outcome === "created" && leadId && lead.submitted_at) {
        const submitted = new Date(lead.submitted_at);
        if (!Number.isNaN(submitted.getTime())) {
          await prisma.lead.update({
            where: { id: leadId },
            data: { createdAt: submitted, stageEnteredAt: submitted },
          });
          report.backdated++;
        }
      }

      opts.onProgress?.(report.fetched, report);
    }

    // The relay advances the cursor by capture time. A page shorter than the
    // page size is the last one; a cursor that doesn't move would loop.
    if (!batch.nextSince || batch.nextSince === since) {
      report.nextSince = batch.nextSince ?? since;
      break;
    }
    since = batch.nextSince;
    report.nextSince = since;
    if (batch.leads.length < pageSize) break;
  }

  return report;
}
