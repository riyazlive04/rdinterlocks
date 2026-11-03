/**
 * RBAC, duty presence, the payment gate and the security fixes.
 *
 * Covers the features added on feat/lead-intake-quote-review. These were all
 * verified once against the live database by throwaway scripts that were then
 * deleted — this file is that verification made permanent, so a later change
 * that reopens the login bypass or the replay hole fails here instead of in
 * production.
 *
 * SAFETY: this suite WRITES and deletes its own fixtures. Like run-db.ts it
 * refuses to run unless DATABASE_URL is local. Setup is the same (see the
 * header of run-db.ts) plus:
 *   npx tsx prisma/seed-brick-prices.ts --apply
 *   npx tsx prisma/backfill-lead-stages.ts --apply
 *
 * Run: npx tsx scripts/e2e/run-rbac.ts
 */

import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { tc, eq, ok, run } from "./harness";
import { prisma } from "@/lib/db";
import { canAssignTo, assignableRoles, isFullAccess, isOwner } from "@/lib/roles";
import { can, DEFAULT_AREAS_BY_ROLE } from "@/lib/access";
import { verifyLogin, verifyPin } from "@/lib/auth";
import { startDuty, endDuty, listOnDuty, nextOnDutyTelecaller } from "@/lib/duty";
import { resolveQuotationItems, financialYearLabel, nextQuotationNumber } from "@/lib/quote";
import { recordQuotationPayment, approveQuotationPayment, paymentTotals } from "@/lib/quote-payment";
import { replayDelivery } from "@/lib/lead-webhook-replay";

// ───────────────────────────── guard rails ───────────────────────────────

const url = process.env.DATABASE_URL ?? "";
const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);
if (!isLocal && process.env.E2E_ALLOW_REMOTE_DB !== "yes") {
  console.error(
    "REFUSING TO RUN: DATABASE_URL is not local.\n" +
      `  got: ${url.replace(/:[^:@/]*@/, ":***@") || "(unset)"}\n` +
      "This suite writes and deletes rows. Point it at a throwaway database\n" +
      "(see the header of run-db.ts), or set E2E_ALLOW_REMOTE_DB=yes if you\n" +
      "really mean to write to that one."
  );
  process.exit(2);
}

const TAG = "E2E_RBAC";
const uniq = () => `${TAG}_${randomUUID().slice(0, 8)}`;
const PW = "Unique@Pass9";

async function mkUser(role: string, permissions: string[] = DEFAULT_AREAS_BY_ROLE[role] ?? []) {
  return prisma.user.create({
    data: { name: uniq(), pinHash: await bcrypt.hash(PW, 10), role, permissions, active: true },
  });
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  for (const u of users) {
    await prisma.dutySession.deleteMany({ where: { userId: u.id } });
    await prisma.task.deleteMany({ where: { assignedToId: u.id } });
    await prisma.leadActivity.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
  }
  const quotes = await prisma.quotation.findMany({
    where: { customerName: { startsWith: TAG } },
    select: { id: true, orderId: true },
  });
  for (const q of quotes) {
    if (q.orderId) {
      const pays = await prisma.clientPayment.findMany({ where: { orderId: q.orderId }, select: { cashEntryId: true } });
      await prisma.clientPayment.deleteMany({ where: { orderId: q.orderId } });
      // The CashEntry is the parent row — deleting the payment alone strands
      // it in the cashbook. This is the exact mistake the throwaway script
      // made against production, which is why it is spelled out here.
      const cashIds = pays.map((p) => p.cashEntryId).filter((x): x is string => !!x);
      if (cashIds.length) await prisma.cashEntry.deleteMany({ where: { id: { in: cashIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: q.orderId } });
      await prisma.quotation.update({ where: { id: q.id }, data: { orderId: null } });
      await prisma.order.delete({ where: { id: q.orderId } }).catch(() => {});
    }
    await prisma.quotation.delete({ where: { id: q.id } }).catch(() => {});
  }
  await prisma.client.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.leadWebhookDelivery.deleteMany({ where: { requestId: { startsWith: TAG } } });
  await prisma.lead.deleteMany({ where: { customerName: { startsWith: TAG } } });
}

// ───────────────────────────── cases ─────────────────────────────────────

/** AC: tasks travel strictly downward; never sideways, never upward. */
const hierarchy = tc("RBAC-01", "task delegation is strictly downward", () => {
    ok("owner -> manager", canAssignTo("owner", "manager"));
    ok("manager -> supervisor", canAssignTo("manager", "supervisor"));
    ok("supervisor -> telecaller", canAssignTo("supervisor", "telecaller"));
    ok("manager !-> owner", !canAssignTo("manager", "owner"));
    ok("supervisor !-> manager", !canAssignTo("supervisor", "manager"));
    ok("manager !-> manager (no peers)", !canAssignTo("manager", "manager"));
    eq("telecaller delegates to nobody", assignableRoles("telecaller").length, 0);
    ok("manager has full access", isFullAccess("manager"));
    ok("manager is not owner rank", !isOwner("manager"));
  });

/** AC: each role's default areas open its own screens and nothing more. */
const defaultAreas = tc("RBAC-02", "default areas match each role's job", () => {
    const tele = { role: "telecaller", permissions: DEFAULT_AREAS_BY_ROLE.telecaller };
    const sup = { role: "supervisor", permissions: DEFAULT_AREAS_BY_ROLE.supervisor };
    ok("telecaller: leads", can(tele, "leads"));
    ok("telecaller: review queue", can(tele, "quoteReview"));
    ok("telecaller: send list", can(tele, "quoteSend"));
    ok("telecaller: NOT payroll", !can(tele, "payroll"));
    ok("telecaller: NOT revenue", !can(tele, "revenue"));
    ok("telecaller: NOT reports", !can(tele, "reports"));
    ok("supervisor: production", can(sup, "production"));
    // The die register is the supervisor's to keep — the mould goes in, gets
    // flipped and gets retired on the floor, not in the office.
    ok("supervisor: die register", can(sup, "die"));
    ok("telecaller: NOT the die register", !can(tele, "die"));
    ok("supervisor: deliveries", can(sup, "deliveries"));
    ok("supervisor: NOT leads", !can(sup, "leads"));
    ok("supervisor: NOT revenue", !can(sup, "revenue"));
  });

/** AC: a login needs BOTH a name and a password. Regression for the bypass
 *  where an empty name matched the password against every active user. */
const loginBypass = tc("SEC-01", "login requires a username", async () => {
    const u = await mkUser("telecaller");
    ok("correct credentials work", !!(await verifyLogin(u.name, PW)));
    eq("empty name refused", await verifyLogin("", PW), null);
    eq("whitespace name refused", await verifyLogin("   ", PW), null);
    eq("wrong password refused", await verifyLogin(u.name, "nope"), null);
    eq("unknown name refused", await verifyLogin("no-such-user", PW), null);
    eq("verifyPin is retired", await verifyPin(PW), null);
  });

/** AC: deactivating an account takes effect immediately, not in 30 days. */
const revocation = tc("SEC-02", "a deactivated account cannot authenticate", async () => {
    const u = await mkUser("manager");
    ok("active user signs in", !!(await verifyLogin(u.name, PW)));
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    eq("deactivated user refused", await verifyLogin(u.name, PW), null);
  });

/** AC: a delivery that failed signature verification can never be replayed. */
const replayGuard = tc("SEC-03", "signature-rejected deliveries are not replayable", async () => {
    const forgedName = `${TAG}_forged`;
    const d = await prisma.leadWebhookDelivery.create({
      data: {
        channel: "devtest",
        headers: {},
        body: JSON.stringify({ leadId: uniq(), fullName: forgedName, phoneNumber: "+919000000321" }),
        requestId: uniq(),
        status: "rejected",
        statusCode: 401,
        message: "invalid_signature: forged",
      },
    });
    const r = await replayDelivery(d.id, "e2e");
    ok("replay refused", r.ok === false);
    ok("refusal explains why", /signature/i.test(r.message));
    eq("no lead was created", await prisma.lead.count({ where: { customerName: forgedName } }), 0);
  });

/** AC: one open duty session per user; routing only ever picks someone on duty. */
const duty = tc("DUTY-01", "presence drives lead routing", async () => {
    const t = await mkUser("telecaller");
    await startDuty(t.id, "Factory office");
    ok("shift opens", (await listOnDuty()).some((s) => s.userId === t.id));

    await startDuty(t.id, "Home");
    const mine = (await listOnDuty()).filter((s) => s.userId === t.id);
    eq("double clock-in leaves one open session", mine.length, 1);
    eq("the later shift wins", mine[0]?.location, "Home");

    eq("routing picks the on-duty telecaller", (await nextOnDutyTelecaller())?.id, t.id);
    await endDuty(t.id);
    eq("nobody on duty routes to nobody", await nextOnDutyTelecaller(), null);
  });

/** AC: zone pricing applies, and a short load for that zone is refused. */
const zonePricing = tc("QUOTE-01", "zone price and minimum order", async () => {
    const size6 = await prisma.brickSize.findFirst({ where: { label: { startsWith: "6" } } });
    const room = await prisma.constructionType.findFirst({ where: { name: "Room" } });
    const zone = await prisma.deliveryZone.findFirst({ where: { distanceLabel: "60-90 km" } });
    ok("fixtures present (seed zones + prices first)", !!size6 && !!room && !!zone);
    if (!size6 || !room || !zone) return;

    const line = { brickSizeId: size6.id, constructionTypeId: room.id };
    const okItems = await resolveQuotationItems([{ ...line, quantity: 2000 }], zone.id);
    eq("zone rate used", okItems[0].unitPrice, 49);
    eq("line total", okItems[0].total, 98000);

    let refused = false;
    try {
      await resolveQuotationItems([{ ...line, quantity: 500 }], zone.id);
    } catch (e) {
      refused = /minimum/i.test(e instanceof Error ? e.message : "");
    }
    ok("below the zone minimum is refused", refused);

    const overridden = await resolveQuotationItems([{ ...line, quantity: 500, unitPrice: 60 }], zone.id);
    eq("a typed price releases the minimum", overridden[0].unitPrice, 60);
  });

/** AC: approval creates the order and exactly one cashbook entry; a second
 *  approval creates neither. */
const paymentGate = tc("PAY-01", "manager approval is what creates the order", async () => {
    const size6 = await prisma.brickSize.findFirst({ where: { label: { startsWith: "6" } } });
    const room = await prisma.constructionType.findFirst({ where: { name: "Room" } });
    const zone = await prisma.deliveryZone.findFirst({ where: { distanceLabel: "60-90 km" } });
    if (!size6 || !room || !zone) return ok("fixtures present", false);

    const items = await resolveQuotationItems(
      [{ brickSizeId: size6.id, constructionTypeId: room.id, quantity: 2000 }],
      zone.id
    );
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const fy = financialYearLabel(new Date());
    const q = await prisma.$transaction(async (tx) => {
      const number = await nextQuotationNumber(tx, fy);
      return tx.quotation.create({
        data: {
          number,
          financialYear: fy,
          zoneId: zone.id,
          customerName: `${TAG}_customer`,
          customerPhone: "+919000000555",
          place: "Salem",
          subtotal,
          total: subtotal,
          status: "sent",
          items: { create: items },
        },
      });
    });

    const approver = await mkUser("manager");
    const payId = await recordQuotationPayment(q.id, { amount: subtotal, method: "upi" }, approver.id);

    const before = await paymentTotals(q.id);
    eq("payment is pending, not banked", before.pending, subtotal);
    eq("no order yet", (await prisma.quotation.findUnique({ where: { id: q.id } }))?.orderId ?? null, null);

    const approved = await approveQuotationPayment(payId, approver.id, "verified");
    const order = await prisma.order.findUnique({ where: { id: approved.orderId } });
    ok("order created", !!order);
    ok("order records who approved it", !!order?.approvedAt);
    eq("order queued for the supervisor", order?.fulfilmentStage, "queued");

    const cash = await prisma.clientPayment.findMany({ where: { orderId: approved.orderId } });
    eq("exactly one cashbook entry", cash.length, 1);
    eq("for the full amount", cash[0]?.amount, subtotal);

    const after = await paymentTotals(q.id);
    eq("balance settled", after.balance, 0);

    let second = false;
    try {
      await approveQuotationPayment(payId, approver.id, "again");
    } catch {
      second = true;
    }
    ok("a second approval is refused", second);
    eq("and created no second order", await prisma.order.count({ where: { id: approved.orderId } }), 1);
  });

(async () => {
  await cleanup();
  try {
    await run("RBAC / duty / payment gate", [
      hierarchy,
      defaultAreas,
      loginBypass,
      revocation,
      replayGuard,
      duty,
      zonePricing,
      paymentGate,
    ]);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})();
