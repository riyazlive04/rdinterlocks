import { createHash, timingSafeEqual } from "crypto";

// Shared CRON_API_KEY check for every scheduled endpoint.
//
// Lifted verbatim from api/v1/whatsapp/tick's own authenticate()/keyMatches()
// so the two cannot drift: one key, one comparison, one failure mode. A
// scheduled job is a privileged, unattended caller — it drafts quotations and
// reassigns leads with no human in the loop — so this is deliberately a
// DEDICATED key, not INTEGRATION_API_KEYS: a leaked Transcriber/Meta key must
// not be able to trigger it.
//
// Digest-then-compare rather than comparing the raw strings, because
// timingSafeEqual throws on length mismatch — hashing first makes both sides
// 32 bytes, so the comparison is constant-time AND cannot throw, and the
// length of the presented key leaks nothing.

function keyMatches(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * True only when the caller presented the configured CRON_API_KEY, as either
 * `Authorization: Bearer <key>` or `X-API-Key: <key>`.
 *
 * Fails CLOSED when CRON_API_KEY is unset: an unconfigured deployment refuses
 * every scheduled call rather than running them unauthenticated. That is the
 * safe direction — a 401 in the scheduler's log is visible, an open automation
 * endpoint is not.
 */
export function authenticateCron(headers: Headers): boolean {
  const expected = process.env.CRON_API_KEY;
  if (!expected) return false; // fail closed — no key configured, no automation
  const auth = headers.get("authorization")?.trim();
  const presented = auth ? auth.replace(/^Bearer\s+/i, "").trim() : headers.get("x-api-key")?.trim();
  if (!presented) return false;
  return keyMatches(presented, expected);
}
