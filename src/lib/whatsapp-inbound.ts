// Inbound-reply classification for the WhatsApp Cloud API webhook.
//
// Extracted out of api/v1/whatsapp/webhook/route.ts because a Next.js route
// module may only export the route contract itself (GET/POST/runtime/
// dynamic/...) — any other export is a build error — so this logic could not
// otherwise be unit-tested. See scripts/e2e/run-offline.ts (TC-WA-05).

// English + the Tamil equivalent, matched case- and whitespace-insensitively.
export const STOP_KEYWORDS = ["stop", "unsubscribe", "cancel", "நிறுத்து", "வேண்டாம்"];

/**
 * True when a customer's reply is an opt-out request.
 *
 * Matched as the WHOLE message or as a standalone word inside it — never as a
 * bare substring. A substring test (`text.includes("stop")`) silently opts out
 * any lead who writes "non-stop", "stopper", or "cancellation", which is a
 * permanent, customer-visible mistake: `whatsappOptOut` is never automatically
 * cleared, so the factory loses the ability to message that lead at all.
 *
 * Word boundaries are computed with a Unicode-aware split rather than `\b`,
 * which is ASCII-only in JavaScript regex and would never match the Tamil
 * keywords.
 */
export function isStopMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  // Whole message is the keyword (possibly with trailing punctuation).
  if (STOP_KEYWORDS.some((k) => normalized === k)) return true;

  // Otherwise split into words on anything that isn't a letter or digit in any
  // script, so "stop." / "STOP!" / "please stop" match while "stopper" and
  // "cancellation" — the cases a substring test got wrong — do not.
  //
  // A hyphenated "non-stop" still matches, since the hyphen is a word
  // separator. That is the deliberate trade-off: keyword opt-out cannot
  // distinguish intent ("I'll stop by tomorrow" matches too), and under-
  // detecting a genuine opt-out is the worse failure of the two.
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.some((w) => STOP_KEYWORDS.includes(w));
}
