import { Prisma } from "@prisma/client";
import { prisma } from "./db";

// The ONLY function allowed to call the WhatsApp Cloud API's send endpoint —
// every gate (opt-out, terminal stage, quiet hours, daily cap, approved
// template) lives here, not in the UI or the tick route, so there is no path
// that can send a message without going through all of them.
//
// This system only ever sends Meta-approved templates, never free-form text,
// which is what makes the 24-hour session-window rule moot — a template send
// is valid whether or not a session is open.

const GRAPH_VERSION = "v21.0";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// A Date whose UTC getters read as IST wall-clock time — a lightweight way
// to do IST calendar arithmetic without a timezone library dependency. Only
// ever read via getUTC*() accessors; never treat this as a real instant.
function nowIST(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

export function startOfTodayIST(): Date {
  const ist = nowIST();
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS);
}

export function startOfTomorrowIST(): Date {
  return new Date(startOfTodayIST().getTime() + 86400000);
}

// Quiet if start === end means "no window configured". When start < end the
// window doesn't wrap (e.g. 1..5); when start > end it wraps past midnight
// (e.g. 21..9 is quiet 21:00-23:59 and 00:00-08:59).
export function isQuietHour(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function nextQuietHoursEnd(quietEndHour: number): Date {
  const ist = nowIST();
  let target = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), quietEndHour) - IST_OFFSET_MS
  );
  if (target.getTime() <= Date.now()) target = new Date(target.getTime() + 86400000);
  return target;
}

// WhatsApp's Cloud API wants the full MSISDN with country code, no "+" — the
// contactKey normalization in leads-import.ts intentionally strips the
// country code instead (for dedup), so this is a deliberately separate,
// smaller helper: a bare 10-digit Indian mobile gets "91" prefixed, anything
// else is passed through digits-only on a best-effort basis.
// Returns "" when `raw` is not a plausible MSISDN, which the caller treats as
// "no usable phone number". Returning the leftover digits unconditionally was
// unsafe: sendWaMessage falls back to Lead.phoneMasked when phoneNumber is
// blank, and a mask like "98765*****" reduces to "98765" — a non-empty string
// that passes a truthiness check and gets handed to the Cloud API as a
// recipient. E.164 allows at most 15 digits and no national number is shorter
// than 8, so anything outside that is rejected rather than dialled.
export function toWhatsAppRecipient(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`; // bare Indian mobile
  if (digits.length >= 11 && digits.length <= 15) return digits; // already country-prefixed
  return "";
}

async function callGraphSend(
  phoneNumberId: string,
  token: string,
  payload: unknown
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export type SendOutcome =
  | { kind: "sent"; waMessageId: string | null }
  | { kind: "deferred"; reason: "quiet_hours" | "daily_cap"; retryAt: Date }
  | { kind: "stopped"; reason: "opt_out" | "stage" }
  | { kind: "refused"; reason: string }
  | { kind: "failed"; reason: string };

/**
 * Attempt one template send to one lead. Every gate is checked in order —
 * cheapest/most permanent first — and the first one that fires short-circuits
 * everything after it:
 *
 *   1. opt-out            -> stopped (and the enrollment, if any, is stopped)
 *   2. terminal stage      -> stopped (won/lost — nurturing's job is done)
 *   3. unapproved template -> refused (hard misconfiguration, not retried)
 *   4. quiet hours          -> deferred (retry after the window ends)
 *   5. per-lead daily cap   -> deferred (retry tomorrow)
 *
 * Only past all five gates does this ever call the Graph API. Every actual
 * API attempt — success or failure — writes one WaMessage row with the
 * verbatim response, in the spirit of LeadImport's audit trail. A refusal or
 * stop that never reached the API writes no WaMessage row; the outcome
 * itself (and, for enrollments, the stopReason) is that decision's record.
 */
export async function sendWaMessage(opts: {
  leadId: string;
  templateId: string;
  enrollmentId?: string | null;
  vars?: string[];
}): Promise<SendOutcome> {
  const lead = await prisma.lead.findUnique({ where: { id: opts.leadId }, include: { stage: true } });
  if (!lead) return { kind: "refused", reason: "Lead not found" };

  if (lead.whatsappOptOut) {
    if (opts.enrollmentId) {
      await prisma.waEnrollment.updateMany({
        where: { id: opts.enrollmentId, status: "active" },
        data: { status: "stopped", stopReason: "opt_out" },
      });
    }
    return { kind: "stopped", reason: "opt_out" };
  }

  if (lead.stage && (lead.stage.isWon || lead.stage.isLost)) {
    if (opts.enrollmentId) {
      await prisma.waEnrollment.updateMany({
        where: { id: opts.enrollmentId, status: "active" },
        data: { status: "stopped", stopReason: "stage" },
      });
    }
    return { kind: "stopped", reason: "stage" };
  }

  const template = await prisma.waTemplate.findUnique({ where: { id: opts.templateId } });
  if (!template || !template.active || !template.approved) {
    return { kind: "refused", reason: "Template is not an approved, active WhatsApp template" };
  }

  const recipient = toWhatsAppRecipient(lead.phoneNumber || lead.phoneMasked);
  if (!recipient) return { kind: "refused", reason: "Lead has no usable phone number" };

  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const quietStart = settings?.waQuietHoursStart ?? 21;
  const quietEnd = settings?.waQuietHoursEnd ?? 9;
  const dailyCap = settings?.waDailyCapPerLead ?? 3;

  const currentHourIST = nowIST().getUTCHours();
  if (isQuietHour(currentHourIST, quietStart, quietEnd)) {
    return { kind: "deferred", reason: "quiet_hours", retryAt: nextQuietHoursEnd(quietEnd) };
  }

  // Counts every outbound attempt today regardless of status, not just
  // successful ones — the cap is a guardrail on how much traffic this lead
  // is generating, not just on confirmed deliveries.
  const sentToday = await prisma.waMessage.count({
    where: { leadId: opts.leadId, direction: "out", createdAt: { gte: startOfTodayIST() } },
  });
  if (sentToday >= dailyCap) {
    return { kind: "deferred", reason: "daily_cap", retryAt: startOfTomorrowIST() };
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !token) {
    return { kind: "refused", reason: "WhatsApp Cloud API is not configured on the server" };
  }

  const payload = {
    messaging_product: "whatsapp",
    to: recipient,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      ...(opts.vars && opts.vars.length
        ? { components: [{ type: "body", parameters: opts.vars.map((v) => ({ type: "text", text: v })) }] }
        : {}),
    },
  };

  const result = await callGraphSend(phoneNumberId, token, payload);
  const waMessageId =
    (result.json as { messages?: Array<{ id?: string }> } | null)?.messages?.[0]?.id ?? null;
  const errorMessage = (result.json as { error?: { message?: string } } | null)?.error?.message;

  await prisma.waMessage.create({
    data: {
      leadId: opts.leadId,
      enrollmentId: opts.enrollmentId ?? null,
      templateId: template.id,
      direction: "out",
      waMessageId,
      status: result.ok ? "sent" : "failed",
      body: template.name,
      apiResponse: (result.json ?? {}) as Prisma.InputJsonValue,
      sentAt: result.ok ? new Date() : null,
    },
  });

  return result.ok
    ? { kind: "sent", waMessageId }
    : { kind: "failed", reason: errorMessage ?? `Graph API returned HTTP ${result.status}` };
}
