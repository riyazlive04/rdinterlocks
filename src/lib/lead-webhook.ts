import { createHmac, createHash, timingSafeEqual } from "crypto";

// Provider-agnostic inbound lead webhooks.
//
// Why this exists alongside api/v1/leads/meta/webhook: that route can only
// ever serve Meta itself. It verifies X-Hub-Signature-256 with the app secret
// from the Meta App dashboard and then calls the Graph API to fetch
// field_data for a leadgen_id — so it needs custody of a page access token,
// and a lead can only reach it if the sender IS Facebook. A third-party relay
// or agency dashboard, which is how Lead Ads submissions actually arrive for
// this factory, has no way in at all.
//
// This module is the general case: a provider posts the field data inline and
// authenticates with a shared secret. Everything that differs between
// providers — the secret, which header carries the signature, how it is
// encoded, whether a replay window is enforced, what their field names are —
// is CONFIGURATION, not code, so onboarding a new provider is one env entry
// and no deploy. See docs/lead-webhook-contract.md for the contract issued to
// providers.

// ─── Channel configuration ────────────────────────────────────────────

export type SignatureScheme =
  // HMAC-SHA256 over `<timestamp>.<raw body>`, hex-encoded. The default, and
  // what the published contract asks for.
  | "hmac-sha256-hex"
  // Same signing string, base64-encoded. Some platforms only emit base64.
  | "hmac-sha256-base64"
  // HMAC over the raw body ALONE, no timestamp prefix. Weaker — a captured
  // request stays replayable forever — but it is what several relay products
  // implement, and refusing it would push the operator towards `bearer`.
  | "hmac-sha256-hex-body"
  // A static shared token presented in the signature header. No integrity
  // protection on the body at all: anyone who learns the token can post
  // whatever they like. Last resort, for a provider that cannot sign.
  | "bearer";

export type LeadWebhookChannel = {
  /** Path segment that selects this config: /api/v1/leads/webhook/<channel> */
  channel: string;
  secret: string;
  scheme: SignatureScheme;
  signatureHeader: string;
  /** Stripped before comparison, e.g. "sha256=". Empty string for none. */
  signaturePrefix: string;
  timestampHeader: string;
  /** Replay window in seconds. 0 disables the check — see validate(). */
  toleranceSeconds: number;
  /** Value written to Lead.source. Defaults to "meta" so existing UI that
   *  tests `source === "meta"` keeps labelling these leads correctly. */
  source: string;
  /** Provider field name -> one of leads-import.ts' canonical field names.
   *  Only needed when a provider's names match none of the built-in aliases. */
  fieldMap: Record<string, string>;
};

const DEFAULTS = {
  scheme: "hmac-sha256-hex" as SignatureScheme,
  signatureHeader: "x-rd-signature",
  signaturePrefix: "sha256=",
  timestampHeader: "x-rd-timestamp",
  toleranceSeconds: 300,
  source: "meta",
};

const VALID_SCHEMES: SignatureScheme[] = [
  "hmac-sha256-hex",
  "hmac-sha256-base64",
  "hmac-sha256-hex-body",
  "bearer",
];

export type ChannelConfigError = { channel: string | null; problem: string };

export type ParsedChannels = {
  channels: Map<string, LeadWebhookChannel>;
  /** Entries that were DISCARDED — the channel does not exist and intake for
   *  it is dead. */
  errors: ChannelConfigError[];
  /** Entries that WORK but are configured in a way worth knowing about, e.g.
   *  a replay window set on a scheme that cannot enforce one. Kept separate
   *  from `errors` so a live channel is never reported as disabled. */
  warnings: ChannelConfigError[];
};

/**
 * Parses LEAD_WEBHOOK_CHANNELS — a JSON array of channel objects. Only
 * `channel` and `secret` are required; everything else defaults to the
 * published contract:
 *
 *   LEAD_WEBHOOK_CHANNELS='[{"channel":"metarelay","secret":"<64 hex>"}]'
 *
 * A malformed entry is DISCARDED rather than defaulted into existence, and
 * the reason is returned for the admin screen to show. Silently falling back
 * would be the dangerous failure here: an entry with a typo'd scheme must not
 * quietly become an unauthenticated endpoint.
 */
export function parseChannelConfig(raw: string | undefined): ParsedChannels {
  const channels = new Map<string, LeadWebhookChannel>();
  const errors: ChannelConfigError[] = [];
  const warnings: ChannelConfigError[] = [];

  if (!raw || !raw.trim()) return { channels, errors, warnings };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    errors.push({
      channel: null,
      problem: `LEAD_WEBHOOK_CHANNELS is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    });
    return { channels, errors, warnings };
  }

  if (!Array.isArray(parsed)) {
    errors.push({ channel: null, problem: "LEAD_WEBHOOK_CHANNELS must be a JSON array of channel objects." });
    return { channels, errors, warnings };
  }

  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      errors.push({ channel: null, problem: "Entry is not an object." });
      continue;
    }
    const e = entry as Record<string, unknown>;
    const name = typeof e.channel === "string" ? e.channel.trim() : "";
    if (!name) {
      errors.push({ channel: null, problem: "Entry has no `channel` name." });
      continue;
    }
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(name)) {
      errors.push({
        channel: name,
        problem: "Channel name must be lowercase letters, digits and hyphens (max 32) — it appears in the URL path.",
      });
      continue;
    }
    if (channels.has(name)) {
      errors.push({ channel: name, problem: "Duplicate channel name — only the first is used." });
      continue;
    }

    const secret = typeof e.secret === "string" ? e.secret.trim() : "";
    if (!secret) {
      errors.push({ channel: name, problem: "Entry has no `secret`; the channel is disabled." });
      continue;
    }

    const scheme = typeof e.scheme === "string" ? (e.scheme as SignatureScheme) : DEFAULTS.scheme;
    if (!VALID_SCHEMES.includes(scheme)) {
      errors.push({
        channel: name,
        problem: `Unknown scheme ${JSON.stringify(scheme)}. Expected one of: ${VALID_SCHEMES.join(", ")}.`,
      });
      continue;
    }

    const tolerance =
      typeof e.toleranceSeconds === "number" && Number.isFinite(e.toleranceSeconds) && e.toleranceSeconds >= 0
        ? Math.floor(e.toleranceSeconds)
        : DEFAULTS.toleranceSeconds;

    // Only the timestamp-bound schemes can enforce a replay window, because
    // only they put the timestamp inside the signing string. Setting one on
    // the others is not an error we should reject the channel for — but left
    // silent it reads as protection that is not there, so it is surfaced.
    if (
      typeof e.toleranceSeconds === "number" &&
      e.toleranceSeconds > 0 &&
      scheme !== "hmac-sha256-hex" &&
      scheme !== "hmac-sha256-base64"
    ) {
      warnings.push({
        channel: name,
        problem:
          `toleranceSeconds is set but scheme "${scheme}" does not sign a timestamp, so there is NO ` +
          `replay protection — a captured request stays valid indefinitely. Use hmac-sha256-hex to get it.`,
      });
    }

    const fieldMap: Record<string, string> = {};
    if (typeof e.fieldMap === "object" && e.fieldMap !== null) {
      for (const [k, v] of Object.entries(e.fieldMap as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) fieldMap[k] = v.trim();
      }
    }

    channels.set(name, {
      channel: name,
      secret,
      scheme,
      signatureHeader: (typeof e.signatureHeader === "string" && e.signatureHeader.trim()
        ? e.signatureHeader
        : DEFAULTS.signatureHeader
      ).toLowerCase(),
      signaturePrefix:
        typeof e.signaturePrefix === "string" ? e.signaturePrefix : DEFAULTS.signaturePrefix,
      timestampHeader: (typeof e.timestampHeader === "string" && e.timestampHeader.trim()
        ? e.timestampHeader
        : DEFAULTS.timestampHeader
      ).toLowerCase(),
      toleranceSeconds: tolerance,
      source: typeof e.source === "string" && e.source.trim() ? e.source.trim() : DEFAULTS.source,
      fieldMap,
    });
  }

  return { channels, errors, warnings };
}

/** Channels configured in this environment. Read per call, not cached at
 *  module load, so a serverless instance started before an env change does
 *  not keep serving a stale channel list. */
export function configuredChannels(): ParsedChannels {
  return parseChannelConfig(process.env.LEAD_WEBHOOK_CHANNELS);
}

export function findChannel(name: string): LeadWebhookChannel | null {
  return configuredChannels().channels.get(name) ?? null;
}

// ─── Signature verification ───────────────────────────────────────────

export type VerifyFailure =
  | "not_configured"
  | "missing_signature"
  | "missing_timestamp"
  | "malformed_timestamp"
  | "stale_timestamp"
  | "invalid_signature";

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure; detail: string };

// Fixed-length digests so timingSafeEqual never throws on a length mismatch,
// and so the comparison leaks neither the expected value nor its length. Same
// approach as lib/api-auth.ts and lib/meta-webhook.ts.
function constantTimeEquals(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

export function expectedSignature(
  channel: LeadWebhookChannel,
  rawBody: string,
  timestamp: string
): string {
  switch (channel.scheme) {
    case "bearer":
      return channel.secret;
    case "hmac-sha256-base64":
      return createHmac("sha256", channel.secret).update(`${timestamp}.${rawBody}`).digest("base64");
    case "hmac-sha256-hex-body":
      return createHmac("sha256", channel.secret).update(rawBody).digest("hex");
    case "hmac-sha256-hex":
    default:
      return createHmac("sha256", channel.secret).update(`${timestamp}.${rawBody}`).digest("hex");
  }
}

/**
 * Verifies one delivery. Fails closed at every branch: an unconfigured
 * channel, an absent header and a wrong digest are all rejections, never a
 * pass-through.
 *
 * `rawBody` must be the exact bytes received. Re-serialising the parsed JSON
 * and signing that would break verification for any provider whose key order
 * or spacing differs from ours — which is why the route reads req.text() and
 * parses only afterwards.
 */
export function verifyDelivery(
  channel: LeadWebhookChannel,
  rawBody: string,
  headers: Headers,
  now: Date = new Date()
): VerifyResult {
  const presented = headers.get(channel.signatureHeader)?.trim();
  if (!presented) {
    return { ok: false, reason: "missing_signature", detail: `Header ${channel.signatureHeader} is absent.` };
  }

  const stripped = channel.signaturePrefix && presented.startsWith(channel.signaturePrefix)
    ? presented.slice(channel.signaturePrefix.length)
    : presented;

  // The timestamp is only part of the signing string for the schemes that say
  // so. Requiring it for the others would reject a correctly-signed request.
  const timestampSigned = channel.scheme === "hmac-sha256-hex" || channel.scheme === "hmac-sha256-base64";
  let timestamp = "";

  if (timestampSigned) {
    const rawTs = headers.get(channel.timestampHeader)?.trim();
    if (!rawTs) {
      return { ok: false, reason: "missing_timestamp", detail: `Header ${channel.timestampHeader} is absent.` };
    }
    if (!/^\d{1,15}$/.test(rawTs)) {
      return { ok: false, reason: "malformed_timestamp", detail: "Timestamp must be Unix epoch seconds." };
    }
    timestamp = rawTs;

    if (channel.toleranceSeconds > 0) {
      const skew = Math.abs(Math.floor(now.getTime() / 1000) - Number(rawTs));
      if (skew > channel.toleranceSeconds) {
        return {
          ok: false,
          reason: "stale_timestamp",
          detail: `Timestamp is ${skew}s from server time; tolerance is ${channel.toleranceSeconds}s.`,
        };
      }
    }
  }

  if (!constantTimeEquals(stripped, expectedSignature(channel, rawBody, timestamp))) {
    return { ok: false, reason: "invalid_signature", detail: "Signature does not match." };
  }

  return { ok: true };
}

// ─── Payload shaping ──────────────────────────────────────────────────

/**
 * Applies a channel's fieldMap before the payload reaches
 * normalizeLeadPayload, renaming provider-specific keys to names the
 * importer's alias table already understands.
 *
 * A mapped key wins over an unmapped one of the same canonical name, and the
 * original key is dropped so it does not also land in the lead's `extra`
 * object as a duplicate. Keys with no mapping pass through untouched — the
 * built-in alias table handles most providers without any fieldMap at all.
 */
export function applyFieldMap(
  payload: Record<string, unknown>,
  fieldMap: Record<string, string>
): Record<string, unknown> {
  if (Object.keys(fieldMap).length === 0) return payload;

  const out: Record<string, unknown> = {};
  const mappedTargets = new Set(Object.values(fieldMap));

  for (const [key, value] of Object.entries(payload)) {
    const target = fieldMap[key];
    if (target) {
      out[target] = value;
    } else if (!mappedTargets.has(key)) {
      out[key] = value;
    }
    // else: an unmapped key colliding with a mapping's target is skipped, so
    // the explicitly mapped value is the one that survives.
  }
  return out;
}

/** Tracking columns a provider may send alongside the lead fields. */
export function extractTracking(payload: Record<string, unknown>) {
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const p = payload as Record<string, unknown>;
  return {
    campaignId: str(p.campaignId ?? p.campaign_id),
    adsetId: str(p.adsetId ?? p.adset_id ?? p.adgroup_id),
    adId: str(p.adId ?? p.ad_id),
    formId: str(p.formId ?? p.form_id),
    platform: str(p.platform),
  };
}
