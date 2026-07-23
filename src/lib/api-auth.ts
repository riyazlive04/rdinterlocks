import { createHash, timingSafeEqual } from "crypto";

// Machine-to-machine auth for the /api/v1 integration endpoints.
//
// This is deliberately separate from the human session in lib/auth.ts: the
// Transcriber has no browser, no cookie and no user row. It presents a static
// API key on every request instead.
//
// Keys live in the INTEGRATION_API_KEYS env var as a comma-separated list.
// Each entry is either `key` or `label:key` — the label is recorded on the
// audit row so a leaked credential can be identified and revoked without
// storing the key itself:
//
//   INTEGRATION_API_KEYS="transcriber-prod:9f3c…,transcriber-staging:1a7b…"
//
// Listing several keys is how rotation works: issue the new one, wait for the
// caller to switch, then drop the old entry. Same idea as SESSION_SECRET_OLD.

const ENV_VARS = ["INTEGRATION_API_KEYS", "LEADS_API_KEY"] as const;

export type ApiKeyIdentity = { label: string };

export type ApiAuthResult =
  | { ok: true; identity: ApiKeyIdentity }
  | { ok: false; code: "not_configured" | "missing_credential" | "invalid_credential"; message: string };

type ParsedKey = { label: string; value: string };

function configuredKeys(): ParsedKey[] {
  const out: ParsedKey[] = [];
  for (const name of ENV_VARS) {
    const raw = process.env[name];
    if (!raw) continue;
    for (const part of raw.split(",")) {
      const entry = part.trim();
      if (!entry) continue;
      // Split on the FIRST colon only — keys may themselves contain colons.
      const idx = entry.indexOf(":");
      if (idx > 0) {
        out.push({ label: entry.slice(0, idx).trim(), value: entry.slice(idx + 1).trim() });
      } else {
        out.push({ label: name === "LEADS_API_KEY" ? "leads" : "default", value: entry });
      }
    }
  }
  return out.filter((k) => k.value.length > 0);
}

// Compare via fixed-length SHA-256 digests so timingSafeEqual never throws on a
// length mismatch — and so the comparison leaks neither the key nor its length.
function keyMatches(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Pull the credential from either `Authorization: Bearer <key>` or `X-API-Key`.
// Both are accepted so the caller can use whichever its HTTP client makes easy.
function extractCredential(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
    // A bare `Authorization: <key>` is tolerated; some senders omit the scheme.
    if (!auth.includes(" ")) return auth.trim();
  }
  const apiKey = headers.get("x-api-key");
  if (apiKey?.trim()) return apiKey.trim();
  return null;
}

export function authenticateApiRequest(headers: Headers): ApiAuthResult {
  const keys = configuredKeys();
  if (keys.length === 0) {
    // Fail CLOSED. Unlike the edge middleware — which lets requests through
    // when the secret is unreadable so the owner is never locked out of the UI
    // — an unconfigured ingest endpoint must reject, or a misconfigured deploy
    // would silently accept writes from anyone.
    return {
      ok: false,
      code: "not_configured",
      message: "Integration API keys are not configured on the server.",
    };
  }

  const presented = extractCredential(headers);
  if (!presented) {
    return {
      ok: false,
      code: "missing_credential",
      message:
        "Missing API credential. Send 'Authorization: Bearer <key>' or 'X-API-Key: <key>'.",
    };
  }

  for (const k of keys) {
    if (keyMatches(presented, k.value)) return { ok: true, identity: { label: k.label } };
  }

  return { ok: false, code: "invalid_credential", message: "Invalid API credential." };
}
