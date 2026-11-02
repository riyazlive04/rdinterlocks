#!/usr/bin/env node
// Fires the sales-desk automation sweep once, authenticating with CRON_API_KEY.
//
// api/v1/cron/sweep assigns unowned leads, auto-DRAFTS quotations for leads
// that have enough data to price, and marks stale sent quotations expired. It
// has to be invoked by something, and this app is not on Vercel — there is no
// platform cron — so this script is the invoker and you point whatever
// scheduler the machine has at it:
//
//   Windows Task Scheduler (local box, every 30 min):
//     schtasks /Create /TN "RD sweep" /SC MINUTE /MO 30 ^
//       /TR "node C:\path\to\rdinterlocks\scripts\run-sweep.mjs" ^
//       /SD 01/01/2026 /RL LIMITED
//     (or, in the GUI: Action = Start a program,
//      Program = node, Arguments = scripts\run-sweep.mjs,
//      Start in = C:\path\to\rdinterlocks  — "Start in" matters, the script
//      reads .env from the working directory)
//
//   Linux/VPS crontab (every 30 min):
//     */30 * * * * cd /srv/rdinterlocks && node scripts/run-sweep.mjs >> /var/log/rd-sweep.log 2>&1
//
//   systemd: a .timer unit calling the same command, WorkingDirectory=/srv/rdinterlocks
//
// Nothing this triggers reaches a customer: an auto-drafted quotation is a
// DRAFT in the review queue, and a human approves it before it can be sent.
// Running it more often than needed is harmless — a lead that already has a
// quotation is never re-drafted, an owned lead is never reassigned, and a
// sweep with nothing due is a cheap no-op.

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
    "CRON_API_KEY is not set, so /api/v1/cron/sweep will reject this call and\n" +
      "no lead will be assigned and no quotation will ever be auto-drafted.\n" +
      "Generate one with:\n" +
      "  openssl rand -hex 32\n" +
      "and add it to .env as CRON_API_KEY."
  );
  process.exit(1);
}

const url = `${baseUrl}/api/v1/cron/sweep`;
const startedAt = Date.now();

let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
  });
} catch (e) {
  console.error(`[cron:sweep] could not reach ${url}: ${e.message}`);
  process.exit(1);
}

const text = await res.text();
const elapsed = Date.now() - startedAt;

if (!res.ok) {
  console.error(`[cron:sweep] HTTP ${res.status} after ${elapsed}ms: ${text.slice(0, 500)}`);
  process.exit(1);
}

try {
  const json = JSON.parse(text);
  const draft = json.draft ?? {};
  // The skip reasons are the whole diagnostic story when "automation is on
  // but nothing happens", so they go in the one line the scheduler logs.
  const skipped = Object.entries(draft.skipped ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const stageErrors = Object.entries(json.errors ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  console.log(
    `[cron:sweep] ${json.ok ? "ok" : "partial"} in ${elapsed}ms — ` +
      `assigned=${json.assign?.assigned ?? 0} ` +
      `considered=${draft.considered ?? 0} drafted=${draft.drafted ?? 0} ` +
      `expired=${json.expiry?.expired ?? 0}` +
      (draft.errors ? ` draftErrors=${draft.errors}` : "") +
      (skipped ? ` (skipped ${skipped})` : "") +
      (stageErrors ? ` [${stageErrors}]` : "")
  );
  // A stage that blew up is a failure the scheduler should be able to notice,
  // even though the other stages still ran.
  if (!json.ok) process.exit(1);
} catch {
  console.log(`[cron:sweep] ok in ${elapsed}ms: ${text.slice(0, 300)}`);
}
