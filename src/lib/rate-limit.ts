// Fixed-window rate limiting for the /api/v1 integration endpoints.
//
// SCOPE — read this before trusting it as a security control.
// Counters live in the module scope of one server instance. On a single
// long-lived server (a VPS, a container, `next start`) that is a true global
// limit. On Vercel's serverless functions each concurrent instance keeps its
// own counters, so the effective ceiling is roughly `limit × live instances`.
//
// That is still worth having — it turns an unbounded flood into a bounded one
// and stops the common case of a stuck Transcriber retry loop hammering the
// endpoint — but it is NOT a hard guarantee. For a strict distributed limit,
// swap the two functions below for a Redis/Upstash INCR with the same
// signature; nothing else in the codebase needs to change.

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the current window ends. */
  resetAt: number;
  retryAfterSec: number;
};

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Bound memory: an attacker rotating IPs must not grow this map forever.
// Sweeping only when the map is large keeps the common path allocation-free.
const SWEEP_THRESHOLD = 10_000;

function sweep(now: number) {
  if (buckets.size < SWEEP_THRESHOLD) return;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
  // Still oversized after dropping expired entries — the map is under active
  // abuse. Drop everything rather than grow without bound; the worst case is
  // that some counters reset early, which fails open for one window only.
  if (buckets.size >= SWEEP_THRESHOLD) buckets.clear();
}

/**
 * Consume one unit against `key`. Call once per request you intend to count.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, limit, remaining: limit - 1, resetAt, retryAfterSec: 0 };
  }

  existing.count += 1;
  const over = existing.count > limit;
  return {
    ok: !over,
    limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSec: over ? Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) : 0,
  };
}

// Behind Vercel/Cloudflare the client address is the FIRST hop of
// x-forwarded-for; later hops are proxies and are trivially spoofable, so only
// the leftmost entry is used. Falls back to a shared bucket when absent, which
// is deliberately conservative: unattributable traffic shares one budget.
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(Math.ceil(r.resetAt / 1000)),
  };
  if (!r.ok) h["Retry-After"] = String(r.retryAfterSec);
  return h;
}

// Limits are env-tunable so a busy day doesn't need a redeploy.
function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const LEAD_IMPORT_LIMITS = {
  /** Per authenticated API key. Generous — a real integration posts a few per hour. */
  perKeyPerMinute: () => envInt("LEADS_RATE_LIMIT_PER_MINUTE", 60),
  /** Per IP, counted before auth, to cap raw request volume. */
  perIpPerMinute: () => envInt("LEADS_RATE_LIMIT_IP_PER_MINUTE", 120),
  /** Failed auth attempts per IP — the brute-force guard against key guessing. */
  authFailuresPer15Min: () => envInt("LEADS_AUTH_FAILURES_PER_15_MIN", 10),
};

export const MINUTE_MS = 60_000;
export const FIFTEEN_MIN_MS = 15 * 60_000;
