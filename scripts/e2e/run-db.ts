/**
 * Database-backed flow suite — drives each uncommitted feature against a real
 * PostgreSQL instance: quotation pricing/numbering/acceptance, the WhatsApp
 * send gates and cron claim protocol, the inbound webhook, lead-stage
 * sequencing, and Meta Lead Ads ingestion.
 *
 * SAFETY: this suite WRITES, and it deletes its own fixtures. It refuses to
 * run unless DATABASE_URL points at a local host, so it can never be aimed at
 * the hosted Supabase database by accident. Override only for a database you
 * are willing to have written to, with E2E_ALLOW_REMOTE_DB=yes.
 *
 * Setup (throwaway Postgres in Docker):
 *   docker run -d --name rd-e2e-pg -e POSTGRES_PASSWORD=e2epass \
 *     -e POSTGRES_DB=rdtest -p 55432:5432 postgres:16-alpine
 *   export DATABASE_URL=postgresql://postgres:e2epass@127.0.0.1:55432/rdtest
 *   export DIRECT_URL=$DATABASE_URL
 *   npx prisma db push --skip-generate
 *   npx tsx prisma/seed.ts
 *   npx tsx prisma/seed-quote-settings.ts --apply
 *   npx tsx prisma/seed-delivery-zones.ts --apply
 *
 * Run: npx tsx scripts/e2e/run-db.ts
 */

import { NextRequest } from "next/server";
import { createHmac, randomUUID } from "crypto";
import { tc, eq, ok, run } from "./harness";
import { prisma } from "@/lib/db";
import {
  resolveQuotationItems,
  nextQuotationNumber,
  convertQuotationToOrder,
  financialYearLabel,
} from "@/lib/quote";
import { sendWaMessage } from "@/lib/whatsapp-send";
import { triggerWaSequencesForStage } from "@/lib/lead-stage";

// ───────────────────────────── guard rails ───────────────────────────────

const url = process.env.DATABASE_URL ?? "";
const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);
if (!isLocal && process.env.E2E_ALLOW_REMOTE_DB !== "yes") {
  console.error(
    "REFUSING TO RUN: DATABASE_URL is not local.\n" +
      `  got: ${url.replace(/:[^:@/]*@/, ":***@") || "(unset)"}\n` +
      "This suite writes and deletes rows. Point it at a throwaway database\n" +
      "(see the header of this file), or set E2E_ALLOW_REMOTE_DB=yes if you\n" +
      "really mean to write to that one."
  );
  process.exit(2);
}

// Every fixture this suite creates is tagged so cleanup can find it even if a
// previous run died halfway.
const TAG = "E2E_FIXTURE";
const uniq = () => `${TAG}_${randomUUID().slice(0, 8)}`;

const APP_SECRET = "e2e-app-secret";
process.env.META_APP_SECRET = APP_SECRET;
process.env.META_VERIFY_TOKEN = "e2e-verify-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
process.env.WHATSAPP_ACCESS_TOKEN = "e2e-token";

// ───────────────────────── fetch stub (no real API calls) ────────────────

type FetchCall = { url: string; body: unknown };
let fetchCalls: FetchCall[] = [];
let fetchResponder: (url: string, init?: RequestInit) => { status: number; json: unknown } = () => ({
  status: 200,
  json: { messages: [{ id: `wamid.${randomUUID()}` }] },
});

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const u = String(input);
  // Only Graph API traffic is stubbed; anything else would be a real network
  // call this suite does not expect to make.
  if (!u.includes("graph.facebook.com")) return realFetch(input as string, init);
  let parsed: unknown = null;
  try {
    parsed = init?.body ? JSON.parse(String(init.body)) : null;
  } catch {
    parsed = String(init?.body);
  }
  fetchCalls.push({ url: u, body: parsed });
  const r = fetchResponder(u, init);
  return new Response(JSON.stringify(r.json), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

// ───────────────────────────── fixture helpers ───────────────────────────

async function makeLead(over: Partial<{ phoneNumber: string; phoneMasked: string; stageSlug: string | null }> = {}) {
  const stage = over.stageSlug === null ? null : await prisma.leadStage.findFirst({ where: { slug: over.stageSlug ?? "new" } });
  return prisma.lead.create({
    data: {
      callId: uniq(),
      contactKey: String(9000000000 + Math.floor(Math.random() * 999999999)),
      customerName: `${TAG} Customer`,
      phoneNumber: over.phoneNumber ?? "9876543210",
      phoneMasked: over.phoneMasked ?? "",
      notes: TAG,
      stageId: stage?.id ?? null,
      stageEnteredAt: stage ? new Date() : null,
    },
  });
}

async function makeTemplate(over: Partial<{ approved: boolean; active: boolean }> = {}) {
  return prisma.waTemplate.create({
    data: {
      name: `${TAG.toLowerCase()}_${randomUUID().slice(0, 8)}`,
      language: "en",
      approved: over.approved ?? true,
      active: over.active ?? true,
    },
  });
}

/** Put the configured quiet window where it either does or doesn't cover now. */
async function setQuietHours(mode: "open" | "closed") {
  const istHour = new Date(Date.now() + 5.5 * 3600_000).getUTCHours();
  const data =
    mode === "closed"
      ? { waQuietHoursStart: istHour, waQuietHoursEnd: (istHour + 2) % 24 }
      : { waQuietHoursStart: 9, waQuietHoursEnd: 9 }; // start==end disables it
  await prisma.settings.update({ where: { id: "default" }, data });
}

async function setDailyCap(n: number) {
  await prisma.settings.update({ where: { id: "default" }, data: { waDailyCapPerLead: n } });
}

function signedMetaRequest(path: string, body: unknown) {
  const raw = JSON.stringify(body);
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": "sha256=" + createHmac("sha256", APP_SECRET).update(raw, "utf8").digest("hex"),
    },
  });
}

// ─────────────────── Feature 1: quotation pricing & numbering ────────────

const TC_DBQ01 = tc("TC-DBQ-01", "Zone price overrides the flat matrix; flat matrix is the fallback", async () => {
  const size = await prisma.brickSize.findFirstOrThrow();
  const type = await prisma.constructionType.findFirstOrThrow();
  const flat = await prisma.brickPrice.findFirst({ where: { brickSizeId: size.id, constructionTypeId: type.id } });
  ok("the seed provides a flat price to compare against", !!flat);

  const noZone = await resolveQuotationItems([
    { brickSizeId: size.id, constructionTypeId: type.id, quantity: 100 },
  ]);
  eq("with no zone, the flat sellPrice is frozen onto the line", noZone[0].unitPrice, flat!.sellPrice);
  eq("line total is quantity x unit price", noZone[0].total, 100 * flat!.sellPrice);
  eq("it is not flagged as a manual override", noZone[0].manualOverride, false);

  const zone = await prisma.deliveryZone.create({ data: { name: uniq(), active: true } });
  await prisma.zonePrice.create({
    data: { zoneId: zone.id, brickSizeId: size.id, constructionTypeId: type.id, sellPrice: flat!.sellPrice + 7 },
  });
  const zoned = await resolveQuotationItems(
    [{ brickSizeId: size.id, constructionTypeId: type.id, quantity: 10 }],
    zone.id
  );
  eq("with a zone picked, the zone price wins", zoned[0].unitPrice, flat!.sellPrice + 7);
});

const TC_DBQ02 = tc("TC-DBQ-02", "A typed price is frozen verbatim and flagged as an override", async () => {
  const size = await prisma.brickSize.findFirstOrThrow();
  const type = await prisma.constructionType.findFirstOrThrow();
  const out = await resolveQuotationItems([
    { brickSizeId: size.id, constructionTypeId: type.id, quantity: 5, unitPrice: 99.5 },
  ]);
  eq("the typed price is used", out[0].unitPrice, 99.5);
  eq("it is flagged as a manual override", out[0].manualOverride, true);
  eq("the total follows the typed price", out[0].total, 5 * 99.5);

  // A deliberate zero is a choice the office is allowed to make.
  const free = await resolveQuotationItems([
    { brickSizeId: size.id, constructionTypeId: type.id, quantity: 5, unitPrice: 0 },
  ]);
  eq("an explicit zero is accepted, not treated as unpriced", free[0].unitPrice, 0);
});

const TC_DBQ03 = tc("TC-DBQ-03", "An unpriced line refuses to become a zero-rupee quotation", async () => {
  // A brick size with no BrickPrice row at all — the exact master-data gap
  // that used to produce a silent 0.00 line on a customer-facing document.
  const orphan = await prisma.brickSize.create({
    data: { label: `${TAG} Orphan`, dimensions: "9*9*9" },
  });
  const type = await prisma.constructionType.findFirstOrThrow();

  let message = "";
  try {
    await resolveQuotationItems([{ brickSizeId: orphan.id, constructionTypeId: type.id, quantity: 1000 }]);
  } catch (e) {
    message = (e as Error).message;
  }
  ok("it throws instead of pricing at zero", message.length > 0, "no error was raised");
  ok("the error names the brick size the office must configure", message.includes(`${TAG} Orphan`), message);
  ok("the error says where to fix it", /Settings/i.test(message), message);

  // Typing a price on the line is the documented escape hatch.
  const rescued = await resolveQuotationItems([
    { brickSizeId: orphan.id, constructionTypeId: type.id, quantity: 10, unitPrice: 40 },
  ]);
  eq("typing a price lets the same line through", rescued[0].unitPrice, 40);
});

const TC_DBQ04 = tc("TC-DBQ-04", "Transport-only lines price from the zone's transport rate", async () => {
  const size = await prisma.brickSize.findFirstOrThrow();
  const type = await prisma.constructionType.findFirstOrThrow();
  const zone = await prisma.deliveryZone.create({ data: { name: uniq(), active: true } });

  // No ZoneBrickRule yet -> the transport rate is unresolved.
  let message = "";
  try {
    await resolveQuotationItems(
      [{ brickSizeId: size.id, constructionTypeId: type.id, quantity: 100, transportOnly: true }],
      zone.id
    );
  } catch (e) {
    message = (e as Error).message;
  }
  ok("a missing transport rate is refused, not priced at zero", message.length > 0, "no error raised");
  ok("the message explains it is the zone's transport rate", /transport-only/i.test(message), message);

  // A rule row that exists but has a null rate is just as unresolved.
  const rule = await prisma.zoneBrickRule.create({
    data: { zoneId: zone.id, brickSizeId: size.id, transportOnly: null },
  });
  let nullMessage = "";
  try {
    await resolveQuotationItems(
      [{ brickSizeId: size.id, constructionTypeId: type.id, quantity: 100, transportOnly: true }],
      zone.id
    );
  } catch (e) {
    nullMessage = (e as Error).message;
  }
  ok("a rule row with no rate typed in is still unresolved", nullMessage.length > 0, "null rate was accepted");

  await prisma.zoneBrickRule.update({ where: { id: rule.id }, data: { transportOnly: 6.5 } });
  const out = await resolveQuotationItems(
    [{ brickSizeId: size.id, constructionTypeId: type.id, quantity: 100, transportOnly: true }],
    zone.id
  );
  eq("the zone's transport rate is used", out[0].unitPrice, 6.5);
  eq("the line is marked transport-only", out[0].transportOnly, true);
  eq("the total uses the transport rate", out[0].total, 650);
});

const TC_DBQ05 = tc("TC-DBQ-05", "Quotation numbers are sequential, FY-scoped and race-safe", async () => {
  const fy = `E2E-${randomUUID().slice(0, 6)}`;
  const first = await prisma.$transaction((tx) => nextQuotationNumber(tx, fy));
  const second = await prisma.$transaction((tx) => nextQuotationNumber(tx, fy));
  eq("the first number is 0001", first, `RD/Q/${fy}/0001`);
  eq("the second number is 0002", second, `RD/Q/${fy}/0002`);

  const otherFy = `E2E-${randomUUID().slice(0, 6)}`;
  eq("a different financial year restarts at 0001", await prisma.$transaction((tx) => nextQuotationNumber(tx, otherFy)), `RD/Q/${otherFy}/0001`);

  // Ten concurrent reservations must produce ten DISTINCT numbers — this is
  // the counter row's whole purpose versus a count()+1.
  const concurrent = await Promise.all(
    Array.from({ length: 10 }, () => prisma.$transaction((tx) => nextQuotationNumber(tx, fy)))
  );
  eq("ten concurrent reservations yield ten distinct numbers", new Set(concurrent).size, 10);

  await prisma.quotationCounter.deleteMany({ where: { id: { in: [fy, otherFy] } } });
});

const TC_DBQ06 = tc("TC-DBQ-06", "Quotation acceptance converts to an order exactly once", async () => {
  const size = await prisma.brickSize.findFirstOrThrow();
  const type = await prisma.constructionType.findFirstOrThrow();
  const lead = await makeLead({ stageSlug: "quoted" });
  const fy = financialYearLabel(new Date());

  const quotation = await prisma.$transaction(async (tx) => {
    const number = await nextQuotationNumber(tx, `E2E-${randomUUID().slice(0, 6)}`);
    return tx.quotation.create({
      data: {
        number,
        financialYear: fy,
        leadId: lead.id,
        customerName: `${TAG} Buyer`,
        customerPhone: "9876543210",
        place: "Salem",
        subtotal: 2500,
        total: 2500,
        items: {
          create: [
            {
              brickSizeId: size.id,
              constructionTypeId: type.id,
              quantity: 100,
              unitPrice: 25,
              total: 2500,
            },
          ],
        },
      },
    });
  });

  // A draft must be marked sent before it can be accepted.
  let draftError = "";
  try {
    await convertQuotationToOrder(quotation.id);
  } catch (e) {
    draftError = (e as Error).message;
  }
  ok("a draft quotation cannot be accepted", /sent/i.test(draftError), draftError);

  await prisma.quotation.update({ where: { id: quotation.id }, data: { status: "sent", sentAt: new Date() } });
  const clientId = await convertQuotationToOrder(quotation.id);
  ok("acceptance returns a client id", !!clientId);

  const after = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
  eq("the quotation is now accepted", after.status, "accepted");
  ok("it is linked to the created order", !!after.orderId);

  const order = await prisma.order.findUniqueOrThrow({ where: { id: after.orderId! }, include: { items: true } });
  eq("the order has one line", order.items.length, 1);
  eq("the FROZEN price was copied, not re-derived", order.items[0].pricePerBrick, 25);
  eq("the frozen quantity was copied", order.items[0].quantity, 100);

  // A client had to be created, since the quotation came from a lead only.
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  ok("the new client records its origin", client.notes?.includes(quotation.number) ?? false, String(client.notes));

  // The lead moves to the won stage, with history, and nurturing stops.
  const movedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { stage: true } });
  eq("the lead landed in a won stage", movedLead.stage?.isWon, true);
  eq("quotationStage was updated too", movedLead.quotationStage, "won");
  const history = await prisma.leadStageHistory.findMany({ where: { leadId: lead.id } });
  ok("a stage-history row was written", history.some((h) => h.note === "Quotation accepted"), JSON.stringify(history));

  // Second acceptance is refused and creates nothing.
  const ordersBefore = await prisma.order.count();
  let twiceError = "";
  try {
    await convertQuotationToOrder(quotation.id);
  } catch (e) {
    twiceError = (e as Error).message;
  }
  ok("accepting twice is refused", /already been accepted/i.test(twiceError), twiceError);
  eq("and no second order was created", await prisma.order.count(), ordersBefore);
});


const TC_DBQ07 = tc("TC-DBQ-07", "An expired quotation cannot be converted into an order", async () => {
  const size = await prisma.brickSize.findFirstOrThrow();
  const type = await prisma.constructionType.findFirstOrThrow();

  const make = async (validUntil: Date | null) =>
    prisma.quotation.create({
      data: {
        number: `RD/Q/E2E-${randomUUID().slice(0, 6)}/0001`,
        financialYear: financialYearLabel(new Date()),
        customerName: `${TAG} Expiry`,
        status: "sent",
        sentAt: new Date(),
        validUntil,
        subtotal: 1000,
        total: 1000,
        items: { create: [{ brickSizeId: size.id, constructionTypeId: type.id, quantity: 40, unitPrice: 25, total: 1000 }] },
      },
    });

  const expired = await make(new Date(Date.now() - 7 * 86400000));
  let message = "";
  try {
    await convertQuotationToOrder(expired.id);
  } catch (e) {
    message = (e as Error).message;
  }
  ok("acceptance is refused", /expired/i.test(message), message || "no error raised");
  ok("and the office is told to revise it", /revise/i.test(message), message);
  eq("the quotation was not accepted", (await prisma.quotation.findUniqueOrThrow({ where: { id: expired.id } })).status, "sent");
  eq("and no order was created for it", (await prisma.quotation.findUniqueOrThrow({ where: { id: expired.id } })).orderId, null);

  // Still inside its validity -> converts normally.
  const live = await make(new Date(Date.now() + 7 * 86400000));
  const clientId = await convertQuotationToOrder(live.id);
  ok("an in-date quotation still converts", !!clientId);
  eq("and is marked accepted", (await prisma.quotation.findUniqueOrThrow({ where: { id: live.id } })).status, "accepted");

  // No validity date printed -> never expires.
  const noExpiry = await make(null);
  ok("a quotation with no validity date still converts", !!(await convertQuotationToOrder(noExpiry.id)));
});

// ───────────────────── Feature 2: WhatsApp send gates ────────────────────

const TC_DBW01 = tc("TC-DBW-01", "Gate 1-2: opt-out and terminal stage stop the lead", async () => {
  const template = await makeTemplate();

  const optedOut = await makeLead();
  await prisma.lead.update({ where: { id: optedOut.id }, data: { whatsappOptOut: true } });
  const r1 = await sendWaMessage({ leadId: optedOut.id, templateId: template.id });
  eq("an opted-out lead is stopped", r1, { kind: "stopped", reason: "opt_out" });
  eq("and nothing was sent to the API", await prisma.waMessage.count({ where: { leadId: optedOut.id } }), 0);

  const won = await makeLead({ stageSlug: "won" });
  const r2 = await sendWaMessage({ leadId: won.id, templateId: template.id });
  eq("a lead in a won stage is stopped", r2, { kind: "stopped", reason: "stage" });

  const lost = await makeLead({ stageSlug: "lost" });
  eq("a lead in a lost stage is stopped", await sendWaMessage({ leadId: lost.id, templateId: template.id }), {
    kind: "stopped",
    reason: "stage",
  });
  eq("no WaMessage rows were written for any of them", await prisma.waMessage.count({ where: { leadId: { in: [won.id, lost.id] } } }), 0);
});

const TC_DBW02 = tc("TC-DBW-02", "Gate 3: only an approved, active template may be sent", async () => {
  const lead = await makeLead();
  const unapproved = await makeTemplate({ approved: false });
  const inactive = await makeTemplate({ active: false });

  const r1 = await sendWaMessage({ leadId: lead.id, templateId: unapproved.id });
  eq("an unapproved template is refused", r1.kind, "refused");
  const r2 = await sendWaMessage({ leadId: lead.id, templateId: inactive.id });
  eq("an inactive template is refused", r2.kind, "refused");
  eq("a missing template is refused", (await sendWaMessage({ leadId: lead.id, templateId: "does-not-exist" })).kind, "refused");
  eq("nothing reached the Graph API", await prisma.waMessage.count({ where: { leadId: lead.id } }), 0);
});

const TC_DBW03 = tc("TC-DBW-03", "A lead with only a masked phone is never messaged", async () => {
  // Lead.phoneMasked is redacted ("98765*****"). sendWaMessage falls back to
  // it when phoneNumber is blank, and the Cloud API must not be handed the
  // surviving digits as if they were a real MSISDN.
  const masked = await makeLead({ phoneNumber: "", phoneMasked: "98765*****" });
  const template = await makeTemplate();
  await setQuietHours("open");

  const r = await sendWaMessage({ leadId: masked.id, templateId: template.id });
  eq("the send is refused", r.kind, "refused");
  ok("because there is no usable phone number", /phone/i.test((r as { reason: string }).reason), JSON.stringify(r));
  eq("no message row was written", await prisma.waMessage.count({ where: { leadId: masked.id } }), 0);
  eq("and the Graph API was never called", fetchCalls.length, 0);
});

const TC_DBW04 = tc("TC-DBW-04", "Gate 4-5: quiet hours and the daily cap defer rather than drop", async () => {
  const lead = await makeLead();
  const template = await makeTemplate();

  await setQuietHours("closed");
  const quiet = await sendWaMessage({ leadId: lead.id, templateId: template.id });
  eq("inside quiet hours the send is deferred", quiet.kind, "deferred");
  eq("with the quiet-hours reason", (quiet as { reason: string }).reason, "quiet_hours");
  ok("and a future retry time", (quiet as { retryAt: Date }).retryAt.getTime() > Date.now());
  eq("nothing was sent", await prisma.waMessage.count({ where: { leadId: lead.id } }), 0);

  await setQuietHours("open");
  await setDailyCap(2);
  fetchCalls = [];
  const a = await sendWaMessage({ leadId: lead.id, templateId: template.id });
  const b = await sendWaMessage({ leadId: lead.id, templateId: template.id });
  eq("the first send goes out", a.kind, "sent");
  eq("the second send goes out", b.kind, "sent");
  const capped = await sendWaMessage({ leadId: lead.id, templateId: template.id });
  eq("the third is deferred by the daily cap", capped.kind, "deferred");
  eq("with the daily-cap reason", (capped as { reason: string }).reason, "daily_cap");
  eq("exactly two Graph API calls were made", fetchCalls.length, 2);
  eq("and exactly two outbound rows recorded", await prisma.waMessage.count({ where: { leadId: lead.id, direction: "out" } }), 2);
  await setDailyCap(3);
});

const TC_DBW05 = tc("TC-DBW-05", "A successful send is audited; a Graph failure is recorded, not lost", async () => {
  const lead = await makeLead();
  const template = await makeTemplate();
  await setQuietHours("open");
  await setDailyCap(10);

  fetchCalls = [];
  fetchResponder = () => ({ status: 200, json: { messages: [{ id: "wamid.HAPPY" }] } });
  const sent = await sendWaMessage({ leadId: lead.id, templateId: template.id, vars: ["Ramesh", "5000"] });
  eq("the outcome is sent", sent.kind, "sent");
  eq("the provider message id is captured", (sent as { waMessageId: string }).waMessageId, "wamid.HAPPY");
  eq("one Graph call was made", fetchCalls.length, 1);
  const payload = fetchCalls[0].body as { to: string; type: string; template: { name: string; components?: unknown[] } };
  eq("the recipient is a full MSISDN", payload.to, "919876543210");
  eq("it is a template send, never free text", payload.type, "template");
  eq("the template name is the Meta-approved one", payload.template.name, template.name);
  ok("body variables were passed through", Array.isArray(payload.template.components), JSON.stringify(payload.template));

  const row = await prisma.waMessage.findFirstOrThrow({ where: { leadId: lead.id, waMessageId: "wamid.HAPPY" } });
  eq("the audit row is marked sent", row.status, "sent");
  ok("with the verbatim API response stored", !!row.apiResponse);
  ok("and a sentAt timestamp", !!row.sentAt);

  fetchResponder = () => ({ status: 400, json: { error: { message: "Template not found" } } });
  const failed = await sendWaMessage({ leadId: lead.id, templateId: template.id });
  eq("a Graph error surfaces as failed", failed.kind, "failed");
  ok("carrying the provider's message", /Template not found/.test((failed as { reason: string }).reason), JSON.stringify(failed));
  const failedRow = await prisma.waMessage.findFirstOrThrow({
    where: { leadId: lead.id, status: "failed" },
    orderBy: { createdAt: "desc" },
  });
  eq("the failure is still audited", failedRow.status, "failed");
  eq("with no sentAt", failedRow.sentAt, null);
  fetchResponder = () => ({ status: 200, json: { messages: [{ id: `wamid.${randomUUID()}` }] } });
});

// ───────────── Feature 2b: inbound webhook + stage sequencing ────────────

const TC_DBW06 = tc("TC-DBW-06", "An inbound reply stops nurturing; STOP also opts the lead out", async () => {
  const { POST } = await import("@/app/api/v1/whatsapp/webhook/route");

  const seqLead = await makeLead();
  const template = await makeTemplate();
  const sequence = await prisma.waSequence.create({
    data: {
      name: uniq(),
      active: true,
      steps: { create: [{ stepOrder: 1, templateId: template.id, delayMinutes: 0 }] },
    },
  });
  const enrollment = await prisma.waEnrollment.create({
    data: { leadId: seqLead.id, sequenceId: sequence.id, status: "active", nextRunAt: new Date() },
  });

  const inbound = (from: string, text: string, id: string) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });

  // An ordinary question: nurturing stops (a human takes over) but the lead is
  // NOT opted out.
  const res = await POST(signedMetaRequest("/api/v1/whatsapp/webhook", inbound(seqLead.contactKey, "what is the price?", `wamid.in.${randomUUID()}`)));
  eq("the webhook acknowledges with 200", res.status, 200);
  const afterReply = await prisma.lead.findUniqueOrThrow({ where: { id: seqLead.id } });
  eq("the lead is NOT opted out by an ordinary reply", afterReply.whatsappOptOut, false);
  ok("lastInboundAt was recorded", !!afterReply.lastInboundAt);
  const e1 = await prisma.waEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
  eq("the enrollment was stopped", e1.status, "stopped");
  eq("with the 'replied' reason", e1.stopReason, "replied");
  eq("the inbound message was stored", await prisma.waMessage.count({ where: { leadId: seqLead.id, direction: "in" } }), 1);

  // A genuine STOP opts out permanently.
  const stopLead = await makeLead();
  await POST(signedMetaRequest("/api/v1/whatsapp/webhook", inbound(stopLead.contactKey, "STOP", `wamid.in.${randomUUID()}`)));
  eq("a STOP reply opts the lead out", (await prisma.lead.findUniqueOrThrow({ where: { id: stopLead.id } })).whatsappOptOut, true);

  // An ordinary message containing a stop-like substring must not opt out.
  const nearMiss = await makeLead();
  await POST(signedMetaRequest("/api/v1/whatsapp/webhook", inbound(nearMiss.contactKey, "do you have a stopper for the gate?", `wamid.in.${randomUUID()}`)));
  eq("'stopper' does not opt the lead out", (await prisma.lead.findUniqueOrThrow({ where: { id: nearMiss.id } })).whatsappOptOut, false);

  // Meta redelivers webhooks; the same message id must not double-record.
  const dupLead = await makeLead();
  const dupId = `wamid.in.${randomUUID()}`;
  await POST(signedMetaRequest("/api/v1/whatsapp/webhook", inbound(dupLead.contactKey, "hello", dupId)));
  await POST(signedMetaRequest("/api/v1/whatsapp/webhook", inbound(dupLead.contactKey, "hello", dupId)));
  eq("a redelivered message is recorded once", await prisma.waMessage.count({ where: { waMessageId: dupId } }), 1);

  // A forged request changes nothing.
  const forged = new NextRequest("http://localhost:3000/api/v1/whatsapp/webhook", {
    method: "POST",
    body: JSON.stringify(inbound(dupLead.contactKey, "STOP", `wamid.in.${randomUUID()}`)),
    headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "0".repeat(64) },
  });
  await POST(forged);
  eq("an unsigned/forged webhook cannot opt a lead out", (await prisma.lead.findUniqueOrThrow({ where: { id: dupLead.id } })).whatsappOptOut, false);
});

const TC_DBL01 = tc("TC-DBL-01", "Entering a stage auto-enrolls the lead into its sequences", async () => {
  const stage = await prisma.leadStage.findFirstOrThrow({ where: { slug: "quoted" } });
  const template = await makeTemplate();
  const sequence = await prisma.waSequence.create({
    data: {
      name: uniq(),
      active: true,
      triggerStageId: stage.id,
      steps: { create: [{ stepOrder: 1, templateId: template.id, delayMinutes: 60 }] },
    },
  });

  const lead = await makeLead({ stageSlug: "new" });
  await triggerWaSequencesForStage(prisma, lead.id, stage.id);
  const enrollment = await prisma.waEnrollment.findUnique({
    where: { leadId_sequenceId: { leadId: lead.id, sequenceId: sequence.id } },
  });
  ok("an enrollment was created", !!enrollment);
  eq("it is active", enrollment!.status, "active");
  ok("its first run is scheduled by the step delay", (enrollment!.nextRunAt?.getTime() ?? 0) > Date.now() + 30 * 60_000);

  // An opted-out lead is never enrolled.
  const optedOut = await makeLead({ stageSlug: "new" });
  await prisma.lead.update({ where: { id: optedOut.id }, data: { whatsappOptOut: true } });
  await triggerWaSequencesForStage(prisma, optedOut.id, stage.id);
  eq("an opted-out lead is not enrolled", await prisma.waEnrollment.count({ where: { leadId: optedOut.id } }), 0);
});

const TC_DBW07 = tc("TC-DBW-07", "Two overlapping cron ticks never process the same enrollment twice", async () => {
  const { POST } = await import("@/app/api/v1/whatsapp/tick/route");
  process.env.CRON_API_KEY = "e2e-cron-key";
  await setQuietHours("open");
  await setDailyCap(10);

  const template = await makeTemplate();
  const sequence = await prisma.waSequence.create({
    data: {
      name: uniq(),
      active: true,
      steps: { create: [{ stepOrder: 1, templateId: template.id, delayMinutes: 0 }] },
    },
  });
  const leads = await Promise.all([makeLead(), makeLead(), makeLead()]);
  for (const l of leads) {
    await prisma.waEnrollment.create({
      data: { leadId: l.id, sequenceId: sequence.id, status: "active", nextRunAt: new Date(Date.now() - 1000) },
    });
  }

  const tickReq = () =>
    new NextRequest("http://localhost:3000/api/v1/whatsapp/tick", {
      method: "POST",
      headers: { authorization: "Bearer e2e-cron-key" },
    });

  // Unauthenticated tick is rejected outright.
  const noAuth = await POST(new NextRequest("http://localhost:3000/api/v1/whatsapp/tick", { method: "POST" }));
  eq("an unauthenticated tick is 401", noAuth.status, 401);

  fetchCalls = [];
  const [r1, r2] = await Promise.all([POST(tickReq()), POST(tickReq())]);
  const [j1, j2] = [await r1.json(), await r2.json()];
  const totalSent = (j1.results?.sent ?? 0) + (j2.results?.sent ?? 0);
  eq("the three due enrollments are sent exactly three times in total", totalSent, 3);
  eq("and the Graph API was called exactly three times", fetchCalls.length, 3);

  const rows = await prisma.waEnrollment.findMany({ where: { sequenceId: sequence.id } });
  ok("every claim was released", rows.every((r) => r.claimedAt === null && r.claimToken === null), JSON.stringify(rows.map((r) => r.claimToken)));
  ok("a single-step sequence completes", rows.every((r) => r.status === "completed"), JSON.stringify(rows.map((r) => r.status)));
  eq("exactly three outbound messages were recorded", await prisma.waMessage.count({ where: { enrollmentId: { in: rows.map((r) => r.id) } } }), 3);
});

// ───────────────── Feature 3: Meta Lead Ads ingestion ────────────────────

const TC_DBM01 = tc("TC-DBM-01", "A signed Lead Ads webhook creates a lead; a replay does not duplicate", async () => {
  const { POST } = await import("@/app/api/v1/leads/meta/webhook/route");
  process.env.META_PAGE_ACCESS_TOKEN = "e2e-page-token";

  const leadgenId = `lg_${randomUUID().slice(0, 10)}`;
  const phone = "+91 98765 11111";
  fetchResponder = (u) => {
    if (u.includes(encodeURIComponent(leadgenId)) || u.includes(leadgenId)) {
      return {
        status: 200,
        json: {
          id: leadgenId,
          created_time: new Date().toISOString(),
          field_data: [
            { name: "full_name", values: [`${TAG} Meta Lead`] },
            { name: "phone_number", values: [phone] },
            { name: "city", values: ["Salem"] },
          ],
        },
      };
    }
    return { status: 200, json: { messages: [{ id: `wamid.${randomUUID()}` }] } };
  };

  const body = {
    object: "page",
    entry: [{ id: "page_1", time: Date.now(), changes: [{ field: "leadgen", value: { leadgen_id: leadgenId, form_id: "form_1", page_id: "page_1" } }] }],
  };

  const res = await POST(signedMetaRequest("/api/v1/leads/meta/webhook", body));
  eq("the webhook acknowledges with 200", res.status, 200);

  const contactKey = "9876511111";
  const lead = await prisma.lead.findUnique({ where: { contactKey } });
  ok("a lead was created from the Graph field_data", !!lead, `no lead with contactKey ${contactKey}`);
  eq("the name came through", lead?.customerName, `${TAG} Meta Lead`);

  // Meta redelivers; the same leadgen_id must not create a second lead.
  await POST(signedMetaRequest("/api/v1/leads/meta/webhook", body));
  eq("a replayed delivery does not duplicate the lead", await prisma.lead.count({ where: { contactKey } }), 1);

  // A forged delivery creates nothing.
  const before = await prisma.lead.count();
  const forgedId = `lg_${randomUUID().slice(0, 10)}`;
  await POST(
    new NextRequest("http://localhost:3000/api/v1/leads/meta/webhook", {
      method: "POST",
      body: JSON.stringify({ object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: forgedId } }] }] }),
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "1".repeat(64) },
    })
  );
  eq("a forged Lead Ads webhook creates no lead", await prisma.lead.count(), before);
});

// ───────────────────────────────── cleanup ───────────────────────────────

async function cleanup() {
  // Child-first so foreign keys never block the delete.
  const leads = await prisma.lead.findMany({ where: { notes: TAG }, select: { id: true } });
  const leadIds = leads.map((l) => l.id);
  const metaLeads = await prisma.lead.findMany({ where: { customerName: { contains: TAG } }, select: { id: true } });
  const allLeadIds = [...new Set([...leadIds, ...metaLeads.map((l) => l.id)])];

  await prisma.waMessage.deleteMany({ where: { OR: [{ leadId: { in: allLeadIds } }, { template: { name: { startsWith: TAG.toLowerCase() } } }] } });
  await prisma.waEnrollment.deleteMany({ where: { OR: [{ leadId: { in: allLeadIds } }, { sequence: { name: { startsWith: TAG } } }] } });
  await prisma.waSequenceStep.deleteMany({ where: { sequence: { name: { startsWith: TAG } } } });
  await prisma.waSequence.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.waTemplate.deleteMany({ where: { name: { startsWith: TAG.toLowerCase() } } });

  await prisma.leadStageHistory.deleteMany({ where: { leadId: { in: allLeadIds } } });
  await prisma.leadImport.deleteMany({ where: { leadId: { in: allLeadIds } } });

  const quotations = await prisma.quotation.findMany({
    where: { OR: [{ leadId: { in: allLeadIds } }, { customerName: { contains: TAG } }] },
    select: { id: true, orderId: true },
  });
  await prisma.quotationItem.deleteMany({ where: { quotationId: { in: quotations.map((q) => q.id) } } });
  await prisma.quotation.deleteMany({ where: { id: { in: quotations.map((q) => q.id) } } });

  const orderIds = quotations.map((q) => q.orderId).filter((x): x is string => !!x);
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });

  await prisma.lead.deleteMany({ where: { id: { in: allLeadIds } } });
  await prisma.client.deleteMany({ where: { notes: { contains: "From quotation RD/Q/E2E-" } } });

  await prisma.zonePrice.deleteMany({ where: { zone: { name: { startsWith: TAG } } } });
  await prisma.zoneBrickRule.deleteMany({ where: { zone: { name: { startsWith: TAG } } } });
  await prisma.deliveryZone.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.brickSize.deleteMany({ where: { label: { startsWith: TAG } } });
  await prisma.quotationCounter.deleteMany({ where: { id: { startsWith: "E2E-" } } });
}

void (async () => {
  try {
    await run("DATABASE FLOW SUITE (features 1-5, real PostgreSQL)", [
      TC_DBQ01,
      TC_DBQ02,
      TC_DBQ03,
      TC_DBQ04,
      TC_DBQ05,
      TC_DBQ06,
      TC_DBQ07,
      TC_DBW01,
      TC_DBW02,
      TC_DBW03,
      TC_DBW04,
      TC_DBW05,
      TC_DBW06,
      TC_DBL01,
      TC_DBW07,
      TC_DBM01,
    ]);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})();
