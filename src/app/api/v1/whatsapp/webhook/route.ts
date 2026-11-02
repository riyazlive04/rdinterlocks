import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { verifyChallenge, verifySignature } from "@/lib/meta-webhook";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/leads-import";
import { isStopMessage } from "@/lib/whatsapp-inbound";

// GET/POST /api/v1/whatsapp/webhook
//
// Inbound WhatsApp Cloud API webhook — customer replies and delivery/read/
// failed status callbacks for messages we sent. Same GET challenge and
// X-Hub-Signature-256 verification as the Meta Lead Ads webhook (both use
// Meta's identical subscription protocol — see lib/meta-webhook.ts).
//
// A reply is matched to a Lead via contactKey — the SAME digits-only phone
// normalization leads-import.ts uses for ingestion, so a WhatsApp number and
// a call/form phone number resolve to the same contact.
//
// Always returns 200 once persistence was attempted, so a transient failure
// (or a signature Meta itself won't retry successfully) never triggers a
// retry storm — matching the Lead Ads webhook's contract.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const result = verifyChallenge(req.nextUrl.searchParams, process.env.META_VERIFY_TOKEN);
  if (!result.ok) {
    console.warn(`[whatsapp/webhook] challenge rejected: ${result.reason}`);
    return NextResponse.json({ error: result.reason }, { status: 403 });
  }
  return new NextResponse(result.challenge, { status: 200 });
}

type WaMessageIn = { from?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string } };
type WaStatus = { id?: string; status?: string; timestamp?: string; errors?: unknown };
type WaChangeValue = { messages?: WaMessageIn[]; statuses?: WaStatus[] };
type WaWebhookBody = { object?: string; entry?: Array<{ changes?: Array<{ field?: string; value?: WaChangeValue }> }> };

async function handleInboundMessage(m: WaMessageIn) {
  if (!m.from || !m.id) return;
  const contactKey = normalizePhoneKey(m.from);
  if (!contactKey) return;

  const lead = await prisma.lead.findUnique({ where: { contactKey } });
  if (!lead) {
    console.warn(`[whatsapp/webhook] inbound message from unrecognised contact ${contactKey}`);
    return;
  }

  const text = m.type === "text" ? m.text?.body ?? "" : "";

  try {
    await prisma.waMessage.create({
      data: {
        leadId: lead.id,
        direction: "in",
        waMessageId: m.id,
        status: "received",
        body: text.slice(0, 1000),
        sentAt: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return; // redelivered message id — already recorded
    }
    console.error(`[whatsapp/webhook] failed to record inbound message ${m.id}`, e);
    return;
  }

  const stop = isStopMessage(text);
  await prisma.lead.update({
    where: { id: lead.id },
    data: { lastInboundAt: new Date(), ...(stop ? { whatsappOptOut: true } : {}) },
  });

  // Any reply — STOP or otherwise — means nurturing has done its job: the
  // lead is either engaged (a human should take it from here) or has
  // explicitly asked to be left alone.
  await prisma.waEnrollment.updateMany({
    where: { leadId: lead.id, status: "active" },
    data: { status: "stopped", stopReason: stop ? "opt_out" : "replied" },
  });
}

async function handleStatus(s: WaStatus) {
  if (!s.id || !s.status) return;
  await prisma.waMessage.updateMany({
    where: { waMessageId: s.id },
    data: {
      status: s.status,
      statusAt: s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date(),
      ...(s.errors ? { apiResponse: { statusCallback: s } as Prisma.InputJsonValue } : {}),
    },
  });
}

export async function POST(req: NextRequest) {
  // Raw body is mandatory — same reasoning as the Lead Ads webhook.
  const rawBody = await req.text();

  const sig = verifySignature(rawBody, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET);
  if (!sig.ok) {
    console.warn(`[whatsapp/webhook] signature rejected: ${sig.reason}`);
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  let body: WaWebhookBody;
  try {
    body = JSON.parse(rawBody) as WaWebhookBody;
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      for (const m of value?.messages ?? []) {
        try {
          await handleInboundMessage(m);
        } catch (e) {
          console.error("[whatsapp/webhook] inbound message handling failed", e);
        }
      }
      for (const s of value?.statuses ?? []) {
        try {
          await handleStatus(s);
        } catch (e) {
          console.error("[whatsapp/webhook] status handling failed", e);
        }
      }
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
