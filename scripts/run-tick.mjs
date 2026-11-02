#!/usr/bin/env node
// Fires the WhatsApp nurturing tick once, authenticating with CRON_API_KEY.
//
// api/v1/whatsapp/tick is the only place scheduled sends happen, and it has
// to be invoked by something. On Vercel that is a cron entry in vercel.json;
// running locally or on a VPS there is no such thing, so this script is the
// invoker and you point whatever scheduler you have at it:
//
//   Windows Task Scheduler : node C:\path\to\scripts\run-tick.mjs
//   Linux/VPS crontab      : */15 * * * * cd /srv/app && npm run cron:tick
//   systemd                : a .timer unit calling the same command
//
// The endpoint is safe to call more often than needed: it claims due rows with
// a guarded updateMany, so two overlapping invocations cannot both process the
// same enrollment, and a tick with nothing due is a cheap no-op. Quiet hours
// and the per-lead daily cap are enforced inside the send, not by the
// schedule — so running every 15 minutes does not mean messaging anyone at
// 2am.

import { readFileSync } from "node:fs";

const baseUrl = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

function readEnvFile(path) {
  const out = {};
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

const env = { ...readEnvFile(".env"), ...process.env };
const key = env.CRON_API_KEY;

if (!key) {
  // The endpoint fails closed without this key, so a missing one means every
  // scheduled run silently does nothing — worth saying out loud rather than
  // letting the scheduler log a tidy 401 forever.
  console.error(
    "CRON_API_KEY is not set, so /api/v1/whatsapp/tick will reject this call and\n" +
      "no nurturing message will ever be sent. Generate one with:\n" +
      "  openssl rand -hex 32\n" +
      "and add it to .env as CRON_API_KEY."
  );
  process.exit(1);
}

const url = `${baseUrl}/api/v1/whatsapp/tick`;
const startedAt = Date.now();

let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
  });
} catch (e) {
  console.error(`[cron:tick] could not reach ${url}: ${e.message}`);
  process.exit(1);
}

const text = await res.text();
const elapsed = Date.now() - startedAt;

if (!res.ok) {
  console.error(`[cron:tick] HTTP ${res.status} after ${elapsed}ms: ${text.slice(0, 500)}`);
  process.exit(1);
}

try {
  const json = JSON.parse(text);
  const r = json.results ?? {};
  const detail = Object.entries(r)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(
    `[cron:tick] ok in ${elapsed}ms — claimed=${json.claimed ?? 0} processed=${json.processed ?? 0}` +
      (detail ? ` (${detail})` : "")
  );
} catch {
  console.log(`[cron:tick] ok in ${elapsed}ms: ${text.slice(0, 300)}`);
}
