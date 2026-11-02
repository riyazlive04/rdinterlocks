import { createHmac, timingSafeEqual } from "crypto";

// Shared verification for Meta's webhook subscription protocol — used by both
// the Lead Ads webhook (/api/v1/leads/meta/webhook) and the WhatsApp Cloud
// API webhook (/api/v1/whatsapp/webhook), since Meta uses the same
// hub.challenge handshake and X-Hub-Signature-256 scheme for both.
//
// Fails CLOSED like api-auth.ts: an unconfigured secret never lets a request
// through, it always rejects.
//
// IMPORTANT: verifySignature() must be called with the RAW request body
// (`await req.text()`), never `await req.json()` re-serialized. Meta signs
// the exact bytes it sent; JSON.stringify(JSON.parse(x)) can reorder keys or
// change whitespace, which would make a genuine request fail verification —
// or worse, invite a route handler to skip the raw-body step entirely and
// check nothing at all.

export type ChallengeResult = { ok: true; challenge: string } | { ok: false; reason: string };

export function verifyChallenge(
  searchParams: URLSearchParams,
  verifyToken: string | undefined
): ChallengeResult {
  if (!verifyToken) return { ok: false, reason: "verify token not configured" };
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !challenge) {
    return { ok: false, reason: "not a subscribe challenge" };
  }
  if (token !== verifyToken) return { ok: false, reason: "verify token mismatch" };
  return { ok: true, challenge };
}

export type SignatureResult = { ok: true } | { ok: false; reason: string };

/**
 * Verify X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(appSecret, rawBody)
 * (hex-encoded), constant-time compared so neither the secret nor the
 * signature can be inferred from response timing.
 */
export function verifySignature(
  rawBody: string,
  headerValue: string | null,
  appSecret: string | undefined
): SignatureResult {
  if (!appSecret) return { ok: false, reason: "app secret not configured" };
  if (!headerValue) return { ok: false, reason: "missing X-Hub-Signature-256 header" };

  const prefix = "sha256=";
  if (!headerValue.startsWith(prefix)) {
    return { ok: false, reason: "unexpected signature format" };
  }
  const presentedHex = headerValue.slice(prefix.length).trim();
  if (!/^[0-9a-f]{64}$/i.test(presentedHex)) {
    return { ok: false, reason: "malformed signature" };
  }

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const presented = Buffer.from(presentedHex, "hex");
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}
