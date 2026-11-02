#!/usr/bin/env node
// Signs and posts a lead payload to /api/v1/leads/webhook/<channel>, the way
// a provider following docs/lead-webhook-contract.md would.
//
// Two jobs: it proves the endpoint works end to end without waiting on the
// provider, and it is the reference implementation to point them at when they
// say their signature is being rejected.
//
//   node scripts/post-lead-webhook.mjs devtest
//   node scripts/post-lead-webhook.mjs devtest ./some-payload.json
//   BASE_URL=https://crm.example.com node scripts/post-lead-webhook.mjs metarelay
//
// The secret is read from LEAD_WEBHOOK_CHANNELS in .env — the same value the
// server reads, so a mismatch here is a real mismatch, not a transcription
// slip.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const channelName = process.argv[2];
const payloadPath = process.argv[3];
const baseUrl = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

if (!channelName) {
  console.error("usage: node scripts/post-lead-webhook.mjs <channel> [payload.json]");
  process.exit(1);
}

// Minimal .env reader — this script must run before anything is installed or
// built, so it deliberately pulls in no dependencies.
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

let channels;
try {
  channels = JSON.parse(env.LEAD_WEBHOOK_CHANNELS || "[]");
} catch (e) {
  console.error(`LEAD_WEBHOOK_CHANNELS is not valid JSON: ${e.message}`);
  process.exit(1);
}

const channel = channels.find((c) => c && c.channel === channelName);
if (!channel) {
  const names = channels.map((c) => c?.channel).filter(Boolean);
  console.error(
    `No channel ${JSON.stringify(channelName)} in LEAD_WEBHOOK_CHANNELS.` +
      (names.length ? ` Configured: ${names.join(", ")}` : " The list is empty.")
  );
  process.exit(1);
}

const DEFAULT_PAYLOAD = {
  leadId: `test-${Date.now()}`,
  submittedAt: new Date().toISOString(),
  fullName: "Webhook Test Caller",
  phoneNumber: "+919000000001",
  city: "Salem",
  typeOfBricks: "8 inch",
  typeOfConstruction: "compound wall",
  numberOfBricks: 4000,
  notes: "Posted by scripts/post-lead-webhook.mjs",
  platform: "instagram",
};

const payload = payloadPath ? JSON.parse(readFileSync(payloadPath, "utf8")) : DEFAULT_PAYLOAD;

// Sign the exact bytes that go on the wire. Serialising once and reusing the
// string is the whole trick — re-stringifying for the request would be a
// different byte sequence the moment key order or spacing differed.
const rawBody = JSON.stringify(payload);
const timestamp = String(Math.floor(Date.now() / 1000));

const scheme = channel.scheme || "hmac-sha256-hex";
const signatureHeader = channel.signatureHeader || "x-rd-signature";
const timestampHeader = channel.timestampHeader || "x-rd-timestamp";
const prefix = channel.signaturePrefix === undefined ? "sha256=" : channel.signaturePrefix;

function sign() {
  switch (scheme) {
    case "bearer":
      return channel.secret;
    case "hmac-sha256-base64":
      return createHmac("sha256", channel.secret).update(`${timestamp}.${rawBody}`).digest("base64");
    case "hmac-sha256-hex-body":
      return createHmac("sha256", channel.secret).update(rawBody).digest("hex");
    default:
      return createHmac("sha256", channel.secret).update(`${timestamp}.${rawBody}`).digest("hex");
  }
}

const url = `${baseUrl}/api/v1/leads/webhook/${encodeURIComponent(channelName)}`;
const headers = {
  "content-type": "application/json",
  [signatureHeader]: `${prefix}${sign()}`,
};
if (scheme === "hmac-sha256-hex" || scheme === "hmac-sha256-base64") {
  headers[timestampHeader] = timestamp;
}

console.log(`POST ${url}`);
console.log(`  scheme     ${scheme}`);
console.log(`  signing    "${timestamp}.<${Buffer.byteLength(rawBody)} bytes of body>"`);
console.log(`  payload    ${rawBody.slice(0, 160)}${rawBody.length > 160 ? "…" : ""}`);

const res = await fetch(url, { method: "POST", headers, body: rawBody });
const text = await res.text();

console.log(`\nHTTP ${res.status} ${res.statusText}`);
console.log(`X-Request-Id: ${res.headers.get("x-request-id") ?? "(none)"}`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text.slice(0, 2000));
}

// Non-zero exit on a non-2xx so this is usable as a smoke check in a script.
process.exit(res.ok ? 0 : 1);
