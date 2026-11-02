import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Indian financial year: 1 Apr - 31 Mar. A date on/after 1 Apr belongs to the
// FY starting that calendar year — financialYearLabel(2026-04-01) -> "2026-27".
//
// The year/month MUST be read in IST, not in the server's local zone. Vercel
// runs in UTC, where 1 Apr 00:00-05:29 IST is still 31 March: reading
// getMonth() locally there files those quotations under the PREVIOUS financial
// year and draws their number from the old year's QuotationCounter series —
// wrong on a document the office files for tax. Shifting the instant by the
// IST offset and reading it with getUTC* accessors makes the label correct
// regardless of where this runs (matching the nowIST() approach in
// lib/whatsapp-send.ts).
export function financialYearLabel(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const startYear = ist.getUTCMonth() >= 3 ? y : y - 1; // getUTCMonth() 3 = April
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * Item-name text for a quotation line, matching the reference letterhead's
 * "<label> Interlock Bricks(<dimensions>)" pattern. Dimensions are optional
 * admin-configured master data (Settings -> brick sizes) — omitted from the
 * name entirely when blank rather than printing an empty "()". `transportOnly`
 * appends a suffix for lines where the customer supplies their own bricks
 * and this line is delivery only (see ZoneBrickRule.transportOnly).
 */
export function quoteItemName(
  // `dimensions` is nullable at the boundary on purpose: it is optional
  // admin-typed master data, and a null arriving from an older BrickSize row
  // must not take the whole PDF route down with a TypeError on .trim().
  brickSize: { label: string; dimensions: string | null },
  lang: "en" | "ta",
  transportOnly = false
): string {
  const dimensions = (brickSize.dimensions ?? "").trim();
  const suffix = dimensions ? `(${dimensions})` : "";
  const product = lang === "ta" ? "இன்டர்லாக் பிரிக்ஸ்" : "Interlock Bricks";
  const name = `${brickSize.label} ${product}${suffix}`;
  if (!transportOnly) return name;
  return lang === "ta" ? `${name} — போக்குவரத்து மட்டும்` : `${name} — Transport only`;
}

export type QuotationItemInput = {
  brickSizeId: string;
  constructionTypeId: string;
  quantity: number;
  /** Set only when the office typed a price instead of taking the matrix's. */
  unitPrice?: number;
  /** Customer supplies their own bricks; this line is delivery only. */
  transportOnly?: boolean;
};

/**
 * Freeze the price of every quotation line at generation time.
 *
 * Lives here rather than in the quotations Server Action module so it can be
 * exercised directly against a database (scripts/e2e/run-db.ts, TC-DBQ-01..05)
 * — a "use server" module may only export async Server Actions, so this could
 * not be exported for testing from there without also publishing it as a
 * callable endpoint.
 */
export async function resolveQuotationItems(items: QuotationItemInput[], zoneId?: string) {
  const [flatPrices, zonePrices, zoneRules] = await Promise.all([
    prisma.brickPrice.findMany(),
    zoneId ? prisma.zonePrice.findMany({ where: { zoneId } }) : Promise.resolve([]),
    zoneId ? prisma.zoneBrickRule.findMany({ where: { zoneId } }) : Promise.resolve([]),
  ]);
  const flatMap = new Map(flatPrices.map((p) => [`${p.brickSizeId}_${p.constructionTypeId}`, p.sellPrice]));
  const zoneMap = new Map(zonePrices.map((p) => [`${p.brickSizeId}_${p.constructionTypeId}`, p.sellPrice]));
  const transportMap = new Map(zoneRules.map((r) => [r.brickSizeId, r.transportOnly]));

  // A line whose price cannot be resolved must stop the quotation, not quietly
  // print ₹0. `?? 0` on both lookups meant an unconfigured zone price, a
  // missing BrickPrice row, or a zone with no ZoneBrickRule for the chosen
  // size produced a zero-rupee line and a total that silently excluded it —
  // on a document that goes straight to the customer. The office gets a named
  // error instead, which tells them exactly which master-data row to fill in.
  const unpriced: string[] = [];

  const resolved = items.map((it) => {
    const key = `${it.brickSizeId}_${it.constructionTypeId}`;
    // A picked zone's price wins over the flat matrix; transport-only lines
    // never use either — they price from that zone's per-size transport rate.
    // ZoneBrickRule.transportOnly is a nullable Float — a rule row that exists
    // but has no rate typed in is just as unresolved as a missing row, so null
    // is folded into undefined here rather than being read as a price.
    const autoPrice = it.transportOnly
      ? transportMap.get(it.brickSizeId) ?? undefined
      : zoneMap.get(key) ?? flatMap.get(key);
    // An explicitly typed price always wins, including a deliberate 0 (a free
    // line the office is choosing to show); only an UNRESOLVED auto price is
    // an error.
    if (it.unitPrice === undefined && (autoPrice === undefined || autoPrice <= 0)) {
      unpriced.push(
        it.transportOnly
          ? `${it.brickSizeId} (transport-only rate for the selected delivery zone)`
          : `${it.brickSizeId} / ${it.constructionTypeId}`
      );
    }
    const unitPrice = it.unitPrice ?? autoPrice ?? 0;
    return {
      brickSizeId: it.brickSizeId,
      constructionTypeId: it.constructionTypeId,
      quantity: it.quantity,
      unitPrice,
      manualOverride: it.unitPrice !== undefined && it.unitPrice !== autoPrice,
      transportOnly: it.transportOnly ?? false,
      total: it.quantity * unitPrice,
    };
  });

  if (unpriced.length) {
    // Resolve the ids to the labels the office actually recognises, so the
    // message names the row to go and fill in rather than a cuid.
    const [sizes, types] = await Promise.all([
      prisma.brickSize.findMany({ select: { id: true, label: true } }),
      prisma.constructionType.findMany({ select: { id: true, name: true } }),
    ]);
    const sizeLabel = new Map(sizes.map((s) => [s.id, s.label]));
    const typeLabel = new Map(types.map((t) => [t.id, t.name]));
    const described = items
      .filter(
        (it) =>
          it.unitPrice === undefined &&
          (it.transportOnly
            ? (transportMap.get(it.brickSizeId) ?? 0) <= 0
            : (zoneMap.get(`${it.brickSizeId}_${it.constructionTypeId}`) ??
                flatMap.get(`${it.brickSizeId}_${it.constructionTypeId}`) ??
                0) <= 0)
      )
      .map((it) => {
        const size = sizeLabel.get(it.brickSizeId) ?? it.brickSizeId;
        return it.transportOnly
          ? `${size} (transport-only rate for the selected delivery zone)`
          : `${size} / ${typeLabel.get(it.constructionTypeId) ?? it.constructionTypeId}`;
      });
    throw new Error(
      `No price is configured for: ${described.join("; ")}. ` +
        `Set it in Settings (price matrix, or the delivery zone's prices), or type the price on the line.`
    );
  }

  // Minimum order quantity per zone and size.
  //
  // ZoneBrickRule.minBricks comes straight off the owner's rate chart (1000/700
  // from 40km out, 2500/2000 beyond 90km) and exists because a short load does
  // not cover the lorry. It was being seeded and shown in the form, but never
  // enforced on the path that actually creates a quotation — so a 500-brick
  // order to a 60-90km site quoted at the full delivered rate and the factory
  // ate the transport.
  //
  // Checked only for AUTO-priced lines: typing a price on the line is the
  // office deliberately overriding the matrix, and the same override has to
  // release the minimum too, or there is no way to honour a small order at a
  // negotiated rate. Consistent with how an explicit price already wins above.
  if (zoneId && zoneRules.length) {
    const minMap = new Map(zoneRules.map((r) => [r.brickSizeId, r.minBricks]));
    const short = items.filter((it) => {
      if (it.unitPrice !== undefined) return false; // deliberate override
      const min = minMap.get(it.brickSizeId) ?? 0;
      return min > 0 && it.quantity < min;
    });

    if (short.length) {
      const [sizes, zone] = await Promise.all([
        prisma.brickSize.findMany({ select: { id: true, label: true } }),
        prisma.deliveryZone.findUnique({ where: { id: zoneId }, select: { name: true, distanceLabel: true } }),
      ]);
      const sizeLabel = new Map(sizes.map((s) => [s.id, s.label]));
      const described = short.map((it) => {
        const size = sizeLabel.get(it.brickSizeId) ?? it.brickSizeId;
        return `${size}" — ${it.quantity} ordered, ${minMap.get(it.brickSizeId)} minimum`;
      });
      throw new Error(
        `Below the minimum order for ${zone?.name ?? "this zone"}` +
          `${zone?.distanceLabel ? ` (${zone.distanceLabel})` : ""}: ${described.join("; ")}. ` +
          `Increase the quantity, choose a nearer zone, or type an agreed price on the line to override.`
      );
    }
  }

  return resolved;
}

/**
 * A quotation is expired once the validity date it printed for the customer
 * has passed. Nothing ever WROTE `status = "expired"` — both the list and the
 * detail page already had a tone for it, so every stale quotation went on
 * showing "sent" indefinitely — so it is derived here instead of needing a
 * cron to sweep rows.
 *
 * Only a `sent` quotation can expire: a draft was never given to the customer
 * (and is still freely editable), and accepted/rejected are settled outcomes
 * that a date passing must not reopen or relabel.
 */
export function isQuotationExpired(
  q: { status: string; validUntil: Date | null },
  now: Date = new Date()
): boolean {
  if (q.status !== "sent") return false;
  if (!q.validUntil) return false; // no validity printed = no expiry
  return q.validUntil.getTime() < now.getTime();
}

/** The status to SHOW for a quotation, with expiry folded in. */
export function effectiveQuotationStatus(
  q: { status: string; validUntil: Date | null },
  now: Date = new Date()
): string {
  return isQuotationExpired(q, now) ? "expired" : q.status;
}

/**
 * Reserve the next sequential number for a financial year — call inside the
 * SAME transaction as the Quotation create. The counter row IS the lock:
 * `upsert`'s UPDATE branch is a native atomic increment that Postgres
 * row-locks for the transaction's lifetime, so two concurrent requests
 * serialize on this one row instead of racing a count()+1 (which would
 * collide under serverless concurrency — two requests reading the same
 * count before either writes).
 */
export async function nextQuotationNumber(tx: Prisma.TransactionClient, financialYear: string): Promise<string> {
  const counter = await tx.quotationCounter.upsert({
    where: { id: financialYear },
    update: { seq: { increment: 1 } },
    create: { id: financialYear, seq: 1 },
  });
  return `RD/Q/${financialYear}/${String(counter.seq).padStart(4, "0")}`;
}

/**
 * Move a quotation's lead into the won stage and stop its nurture sequence,
 * because the customer has said yes.
 *
 * Lifted out of the conversion body so the pipeline can be updated the moment
 * the customer accepts (acceptQuotation) rather than waiting for a manager to
 * approve the payment — otherwise a customer who has already agreed keeps
 * receiving nurture messages while the money is being checked.
 *
 * IDEMPOTENT on purpose: it runs at acceptance and again when the order is
 * created from the approved payment. The second call sees the lead already
 * sitting in the won stage and writes nothing, so there is no duplicate
 * stage-history row.
 */
export async function syncLeadWonForQuotation(tx: Prisma.TransactionClient, leadId: string): Promise<void> {
  const lead = await tx.lead.findUnique({ where: { id: leadId } });
  const wonStage = await tx.leadStage.findFirst({ where: { isWon: true, isActive: true } });
  if (lead && wonStage && lead.stageId !== wonStage.id) {
    await tx.lead.update({
      where: { id: leadId },
      data: { stageId: wonStage.id, stageEnteredAt: new Date(), quotationStage: "won" },
    });
    await tx.leadStageHistory.create({
      data: {
        leadId,
        fromStageId: lead.stageId,
        toStageId: wonStage.id,
        note: "Quotation accepted",
      },
    });
  }
  // Unconditional but self-filtering: only `active` enrollments are touched,
  // so a repeat call is a no-op.
  await tx.waEnrollment.updateMany({
    where: { leadId, status: "active" },
    data: { status: "stopped", stopReason: "stage" },
  });
}

/**
 * Turn a quotation into a real Order, copying the FROZEN line items verbatim
 * (never re-reading BrickPrice) — the body of convertQuotationToOrder, taking
 * the caller's transaction client.
 *
 * Split out because order creation is no longer triggered by acceptance: a
 * manager approving the customer's payment is what creates the order, and that
 * approval must mark the payment and create the order in ONE transaction (see
 * lib/quote-payment.ts). This function cannot open its own transaction in that
 * case — Prisma has no nested transactions — so the transaction client is a
 * parameter and convertQuotationToOrder below is the thin public wrapper that
 * still opens one for every existing caller.
 *
 * Every read also moved inside the transaction, which is strictly safer than
 * before: the guards below and the claim at the end now see the same snapshot.
 */
export async function convertQuotationToOrderTx(tx: Prisma.TransactionClient, id: string): Promise<string> {
  const quotation = await tx.quotation.findUnique({ where: { id }, include: { items: true } });
  if (!quotation) throw new Error("Quotation not found.");
  // One order per quotation, and `orderId` — not `status` — is what says
  // whether one exists. `accepted` used to imply an order, so testing the
  // status was enough; now `accepted` means "the customer agreed, the payment
  // is waiting for a manager", which is precisely the state this function is
  // normally called IN. Reading the link itself keeps the guard meaningful
  // (and Quotation.orderId is @unique, so the database enforces it too).
  if (quotation.orderId) throw new Error("This quotation has already been accepted — an order exists for it.");
  // Only a quotation the customer actually has can be converted. Checked as
  // an allow-list rather than by excluding `draft`: the review states
  // (in_review, changes_requested, approved) and a swept `expired` row would
  // all otherwise fall straight through to conversion — `expired` most
  // dangerously, since isQuotationExpired() below returns false once the
  // status is no longer `sent`, so the stale-price guard stops firing exactly
  // when the row has been marked stale.
  //
  // `accepted` joins `sent` on the allow-list because of the payment gate:
  // acceptQuotation marks the quotation accepted and creates nothing, and the
  // order is created later, from here, when the payment is approved.
  if (quotation.status !== "sent" && quotation.status !== "accepted") {
    const reason: Record<string, string> = {
      draft: "Mark this quotation as sent before accepting it.",
      in_review: "This quotation is still with the reviewer.",
      changes_requested: "The reviewer asked for changes — fix and resubmit it first.",
      approved: "This quotation is approved but has not been sent to the customer yet.",
      rejected: "This quotation was rejected. Revise it and send the new revision.",
      expired: "This quotation has expired. Revise it to pick up current prices, then accept the new revision.",
    };
    throw new Error(reason[quotation.status] ?? `A ${quotation.status} quotation cannot be accepted.`);
  }
  if (quotation.items.length === 0) throw new Error("This quotation has no line items.");
  // The prices on this document are frozen and were only promised until
  // validUntil. Converting it afterwards would commit the factory to a stale
  // rate, so the office has to revise it (which re-reads today's prices) and
  // send the new revision instead.
  //
  // Only bites on a `sent` quotation (isQuotationExpired says so), which is
  // the right boundary: expiry is about handing the customer a price that has
  // gone stale, and once they have accepted inside the validity window the
  // date passing while a manager checks the money must not void the sale.
  if (isQuotationExpired(quotation)) {
    throw new Error(
      `This quotation expired on ${quotation.validUntil!.toLocaleDateString("en-IN")}. ` +
        `Revise it to pick up current prices, then accept the new revision.`
    );
  }

  let targetClientId = quotation.clientId;
  if (!targetClientId) {
    const created = await tx.client.create({
      data: {
        name: quotation.customerName || "Unnamed",
        location: quotation.place || null,
        phone: quotation.customerPhone || null,
        notes: `From quotation ${quotation.number}`,
      },
    });
    targetClientId = created.id;
  }

  const order = await tx.order.create({
    data: {
      clientId: targetClientId,
      date: new Date(),
      notes: `From quotation ${quotation.number}`,
      items: {
        create: quotation.items.map((it) => ({
          brickSizeId: it.brickSizeId,
          constructionTypeId: it.constructionTypeId,
          quantity: it.quantity,
          pricePerBrick: it.unitPrice,
          total: it.total,
        })),
      },
    },
  });

  // Optimistic claim — same shape as convertLeadCore's, for the same reason:
  // if a concurrent request converted this quotation a moment ago, the claim
  // matches zero rows and the whole transaction (including the Order just
  // created above) rolls back. Predicated on `orderId: null` rather than the
  // status, for the reason given at the top of this function.
  const claimed = await tx.quotation.updateMany({
    where: { id, orderId: null },
    data: { status: "accepted", orderId: order.id },
  });
  if (claimed.count === 0) {
    throw new Error("This quotation was already accepted by someone else a moment ago.");
  }

  if (quotation.leadId) await syncLeadWonForQuotation(tx, quotation.leadId);

  return targetClientId;
}

/**
 * Accept a quotation and turn it into a real Order, in its own transaction.
 *
 * Kept with exactly its original signature and behaviour for the callers that
 * already use it (scripts/e2e/run-db.ts); the payment-approval path calls
 * convertQuotationToOrderTx directly instead, inside its own transaction.
 */
export async function convertQuotationToOrder(id: string): Promise<string> {
  return prisma.$transaction((tx) => convertQuotationToOrderTx(tx, id));
}
