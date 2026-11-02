import { prisma } from "./db";
import { can } from "./access";
import { financialYearLabel, nextQuotationNumber, resolveQuotationItems } from "./quote";

// Scheduled automation for the sales desk: auto-DRAFTING quotations, sweeping
// stale sent quotations to `expired`, and handing unassigned leads an owner.
//
// ─── The line this file does not cross ────────────────────────────────
// Nothing here is ever auto-SENT. autoDraftQuotations() creates a quotation in
// `draft` status and stops. A draft goes to the review queue for a human to
// read, price-check and approve before any customer sees it. A machine may
// prepare a priced offer; only a person may make it a promise.
//
// Every function is resilient by construction: one bad lead must not abort the
// batch, and NOTHING throws to the caller — the cron route reports per-stage
// outcomes and a thrown exception there would lose the other stages' work.
// Each function therefore wraps its whole body and each row's write.

/**
 * Per-invocation caps. A sweep runs on a schedule, so whatever is left over
 * is simply picked up by the next firing — the same "resumable without resume
 * state" story api/v1/whatsapp/tick already relies on. The cap is what keeps
 * one invocation inside a request timeout on a 833-lead table.
 */
const DRAFT_BATCH_SIZE = 25;
const ASSIGN_BATCH_SIZE = 200;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type AutoDraftResult = {
  considered: number;
  drafted: number;
  skipped: Record<string, number>;
  errors: number;
};

/**
 * The delivery zone for a lead, or null when there isn't one that a human has
 * actually chosen.
 *
 * prisma/schema.prisma states the rule plainly on Quotation.zoneId: the zone
 * is an EXPLICITLY picked value and is "never auto-matched from free-text
 * place/lead data" — the same words appear on quoteSchema in the quotations
 * actions. So this does no fuzzy place-to-zone matching, and it never will:
 * `place` is a phone-transcribed town name, DeliveryZone.areas is a reference
 * list of ~30 towns per zone with real overlaps ("Ammapettai" and "Thoppur"
 * each appear in two zones, "Ammapettai (Salem)" in a third), and the zones
 * are 20km price bands. A wrong guess is a ₹4-6/brick error on a document
 * someone is about to approve, which is worse than no document at all.
 *
 * The only zone this will accept is one an upstream system recorded
 * explicitly: `Lead.extra.zoneId` / `extra.deliveryZoneId` (the Json escape
 * hatch leads-import.ts keeps for fields this schema version doesn't model),
 * validated against an ACTIVE DeliveryZone. Lead has no first-class zoneId
 * column, so in practice that is empty today — which is exactly why
 * `autoQuoteRequiresZone` defaults to true and the skip is counted and
 * surfaced rather than silently swallowed. The operator sees
 * "zone-required-but-not-set" climbing and knows the honest answer: pick the
 * zone on the lead, or turn the zone requirement off and accept flat-matrix
 * pricing on a draft a human will read anyway.
 */
/**
 * The lead's delivery zone, only ever when a human recorded one.
 *
 * `Lead.zoneId` is the real source: a first-class column the telecaller sets
 * from the lead screen once they have established where the site is. The
 * `extra` fallback stays because `leads-import.ts` keeps that Json bag as the
 * forward-compatibility escape hatch, so an upstream system may already be
 * sending a zone before anyone sets it by hand.
 *
 * Still no place-text matching, deliberately — see the note on Lead.zoneId in
 * prisma/schema.prisma for why guessing is worse than skipping.
 */
function explicitZoneId(
  lead: { zoneId: string | null; extra: unknown },
  activeZoneIds: Set<string>
): string | null {
  if (lead.zoneId && activeZoneIds.has(lead.zoneId)) return lead.zoneId;

  const extra = lead.extra;
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return null;
  const bag = extra as Record<string, unknown>;
  const candidate = bag.zoneId ?? bag.deliveryZoneId;
  if (typeof candidate !== "string" || !candidate) return null;
  return activeZoneIds.has(candidate) ? candidate : null;
}

/**
 * Auto-draft a quotation for every open lead sitting on the trigger stage
 * with enough data to price honestly.
 *
 * Eligibility — a lead is drafted only when ALL of these hold:
 *   1. Settings.autoQuoteEnabled is true (otherwise this is a no-op).
 *   2. Settings.autoQuoteOnStage names an existing LeadStage.
 *   3. The lead is `status: "open"` and on that stage.
 *   4. It has NO quotation already (one auto-draft per lead, ever — a human
 *      may have revised or rejected the first one, and a cron must not keep
 *      re-proposing).
 *   5. brickSizeId AND constructionTypeId are resolved (the best-effort
 *      master-data matches leads-import.ts writes) and brickCount > 0.
 *   6. A price exists for that size × type: a ZonePrice for the resolved zone,
 *      or a BrickPrice matrix row. Prices come from the matrix/zone ONLY —
 *      never from Lead.costPerBrick, which is what the caller said on the
 *      phone, not what the factory charges.
 *   7. When Settings.autoQuoteRequiresZone is true, a zone was explicitly set
 *      (see explicitZoneId).
 *   8. The lead's brickCount meets that zone's per-size minimum order, if one
 *      is configured.
 *
 * Every rejection is counted in `skipped` by reason. That map is the whole
 * point of this function's return value: the main failure mode of a feature
 * like this is a silent no-op, where automation is "on", nothing is produced,
 * and nothing anywhere says why.
 */
export async function autoDraftQuotations(): Promise<AutoDraftResult> {
  const result: AutoDraftResult = { considered: 0, drafted: 0, skipped: {}, errors: 0 };
  const skip = (reason: string) => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  };

  try {
    const settings = await prisma.settings.findUnique({ where: { id: "default" } });
    if (!settings?.autoQuoteEnabled) {
      skip("auto-quote-disabled");
      return result;
    }

    const stage = await prisma.leadStage.findUnique({
      where: { slug: settings.autoQuoteOnStage },
    });
    if (!stage) {
      // An admin renamed or removed the stage this points at. Counted, not
      // thrown — the operator reads "trigger-stage-missing" and fixes the
      // setting instead of hunting a 500 in a scheduler log.
      skip("trigger-stage-missing");
      return result;
    }

    const leads = await prisma.lead.findMany({
      where: { status: "open", stageId: stage.id, quotations: { none: {} } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: DRAFT_BATCH_SIZE,
      select: {
        id: true,
        customerName: true,
        phoneNumber: true,
        phoneMasked: true,
        place: true,
        brickCount: true,
        brickSizeId: true,
        constructionTypeId: true,
        extra: true,
        zoneId: true,
      },
    });
    if (leads.length === 0) return result;

    const [flatPrices, zones, zonePrices, zoneRules] = await Promise.all([
      prisma.brickPrice.findMany({ select: { brickSizeId: true, constructionTypeId: true, sellPrice: true } }),
      prisma.deliveryZone.findMany({ where: { active: true }, select: { id: true } }),
      prisma.zonePrice.findMany({ select: { zoneId: true, brickSizeId: true, constructionTypeId: true, sellPrice: true } }),
      prisma.zoneBrickRule.findMany({ select: { zoneId: true, brickSizeId: true, minBricks: true } }),
    ]);
    const activeZoneIds = new Set(zones.map((z) => z.id));
    const flatMap = new Map(flatPrices.map((p) => [`${p.brickSizeId}_${p.constructionTypeId}`, p.sellPrice]));
    const zoneMap = new Map(
      zonePrices.map((p) => [`${p.zoneId}_${p.brickSizeId}_${p.constructionTypeId}`, p.sellPrice])
    );
    const minMap = new Map(zoneRules.map((r) => [`${r.zoneId}_${r.brickSizeId}`, r.minBricks]));

    for (const lead of leads) {
      result.considered++;
      try {
        if (!lead.brickSizeId) {
          skip("no-brick-size");
          continue;
        }
        if (!lead.constructionTypeId) {
          skip("no-construction-type");
          continue;
        }
        const quantity = Math.trunc(Number(lead.brickCount ?? 0));
        if (!(quantity > 0)) {
          skip("no-brick-count");
          continue;
        }

        const zoneId = explicitZoneId(lead, activeZoneIds);
        if (settings.autoQuoteRequiresZone && !zoneId) {
          skip("zone-required-but-not-set");
          continue;
        }

        const key = `${lead.brickSizeId}_${lead.constructionTypeId}`;
        const price = (zoneId ? zoneMap.get(`${zoneId}_${key}`) : undefined) ?? flatMap.get(key);
        if (!price || price <= 0) {
          // resolveQuotationItems would throw on this anyway; pre-checking
          // keeps it a counted skip rather than an error, because a missing
          // price row is master data to fill in, not a fault.
          skip("no-price-configured");
          continue;
        }

        const minBricks = zoneId ? minMap.get(`${zoneId}_${lead.brickSizeId}`) ?? 0 : 0;
        if (minBricks > 0 && quantity < minBricks) {
          // The zone won't deliver this little. Quoting it anyway would print
          // a price the factory can't honour.
          skip("below-zone-minimum");
          continue;
        }

        // Prices frozen here, from the matrix/zone, exactly as
        // generateQuotation does it — no unitPrice is passed, so there is no
        // path by which the lead's spoken costPerBrick can reach the document.
        const items = await resolveQuotationItems(
          [{ brickSizeId: lead.brickSizeId, constructionTypeId: lead.constructionTypeId, quantity }],
          zoneId ?? undefined
        );
        const subtotal = items.reduce((s, it) => s + it.total, 0);
        const quoteDate = new Date();
        const financialYear = financialYearLabel(quoteDate);
        // Print the same validity the expiry sweep will later enforce, so the
        // document and sweepExpiredQuotations() agree on one date rather than
        // the customer reading one deadline and the system applying another.
        const validUntil =
          settings.quoteExpiryDays > 0
            ? new Date(quoteDate.getTime() + settings.quoteExpiryDays * MS_PER_DAY)
            : null;

        await prisma.$transaction(async (tx) => {
          const number = await nextQuotationNumber(tx, financialYear);
          await tx.quotation.create({
            data: {
              number,
              financialYear,
              leadId: lead.id,
              zoneId: zoneId ?? null,
              // Snapshotted, independent of later lead edits — same fields
              // generateQuotation's resolveCustomer() copies off a lead.
              customerName: lead.customerName,
              customerPhone: lead.phoneNumber || lead.phoneMasked,
              place: lead.place,
              quoteDate,
              validUntil,
              // DRAFT. Never `sent`, never `approved` — a human reviews it.
              status: "draft",
              subtotal,
              total: subtotal,
              items: { create: items },
            },
          });
          await tx.leadActivity.create({
            data: {
              leadId: lead.id,
              // No human did this, and LeadActivity.userId is nullable for
              // exactly that case — attributing it to anyone would be a lie
              // in the one place the desk goes to ask "who did what".
              userId: null,
              kind: "quote",
              outcome: "auto-draft",
              note: `Auto-drafted quotation ${number} on stage "${stage.name}". Draft only — a human must review and approve it before it can be sent.`,
            },
          });
        });
        result.drafted++;
      } catch (e) {
        console.error(`[auto-quote] lead ${lead.id} failed to auto-draft`, e);
        result.errors++;
      }
    }
  } catch (e) {
    console.error("[auto-quote] autoDraftQuotations failed", e);
    result.errors++;
  }

  return result;
}

/**
 * Mark stale sent quotations `expired`.
 *
 * lib/quote.ts already DERIVES expiry for display (isQuotationExpired, off
 * validUntil) so the list never showed a stale quote as live; what it could
 * not do is make the stored status say so, and nothing has ever written
 * `expired` even though the schema has carried the value all along. This
 * closes that: a status query, a report, or the review queue sees the same
 * thing the screen does.
 *
 * Only `sent` rows are touched. A draft was never given to the customer, and
 * accepted/rejected are settled outcomes that a date passing must not reopen
 * or relabel — `status: "sent"` in the filter is what guarantees that, so no
 * accepted or rejected quotation can be reached by this update.
 */
export async function sweepExpiredQuotations(): Promise<{ expired: number }> {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: "default" } });
    const days = settings?.quoteExpiryDays ?? 0;
    if (days <= 0) return { expired: 0 }; // 0 = expiry disabled
    const now = new Date();
    const cutoff = new Date(now.getTime() - days * MS_PER_DAY);

    // An explicit `validUntil` WINS over the global day count. Two sources of
    // truth for "expired" would otherwise disagree in the worst direction: a
    // quotation the office deliberately gave 60 days' validity, printed on
    // the customer's PDF, would be stamped expired here at 30 — contradicting
    // the document already in the customer's hands. So the global setting
    // only governs quotations that never stated a date of their own.
    const res = await prisma.quotation.updateMany({
      where: {
        status: "sent",
        OR: [
          { validUntil: { not: null, lt: now } },
          { validUntil: null, quoteDate: { lt: cutoff } },
        ],
      },
      data: { status: "expired" },
    });
    return { expired: res.count };
  } catch (e) {
    console.error("[auto-quote] sweepExpiredQuotations failed", e);
    return { expired: 0 };
  }
}

/**
 * Give unassigned open leads an owner, round-robin across the active users who
 * hold the `leads` area (admins count — `can` grants them everything).
 *
 * Why this exists: ~753 of 833 leads are Meta-sourced and not one of them has
 * an owner, so "who is working this?" has no answer for 90% of the pipeline.
 *
 * The rotation has to survive process restarts, so instead of keeping a cursor
 * anywhere it SEEDS each user's counter with how many open leads they already
 * own and then repeatedly hands the next lead to the least-loaded user (ties
 * broken by a stable user order: createdAt, then id). Over any number of
 * invocations that converges on an even split, and a run that crashes halfway
 * resumes correctly on the next firing because the counts are read back from
 * the leads themselves.
 */
export async function autoAssignLeads(): Promise<{ assigned: number }> {
  let assigned = 0;
  try {
    const settings = await prisma.settings.findUnique({ where: { id: "default" } });
    if (!settings?.leadAutoAssign) return { assigned: 0 };

    const users = (
      await prisma.user.findMany({
        where: { active: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, role: true, permissions: true },
      })
    ).filter((u) => can(u, "leads"));
    if (users.length === 0) return { assigned: 0 }; // nobody to assign to

    const openCounts = await prisma.lead.groupBy({
      by: ["ownerUserId"],
      where: { status: "open", ownerUserId: { not: null } },
      _count: { _all: true },
    });
    const load = new Map(users.map((u) => [u.id, 0]));
    for (const row of openCounts) {
      if (row.ownerUserId && load.has(row.ownerUserId)) {
        load.set(row.ownerUserId, row._count._all);
      }
    }

    const leads = await prisma.lead.findMany({
      where: { status: "open", ownerUserId: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: ASSIGN_BATCH_SIZE,
      select: { id: true },
    });

    for (const lead of leads) {
      try {
        let target = users[0].id;
        for (const u of users) {
          if ((load.get(u.id) ?? 0) < (load.get(target) ?? 0)) target = u.id;
        }

        // Optimistic claim, same shape as convertLeadCore's: re-stating
        // `ownerUserId: null` in the filter means two overlapping sweeps (or a
        // human assigning the lead a moment ago) can never both win — the
        // loser matches zero rows and is simply not counted.
        const claimed = await prisma.lead.updateMany({
          where: { id: lead.id, ownerUserId: null },
          data: { ownerUserId: target },
        });
        if (claimed.count === 0) continue;

        load.set(target, (load.get(target) ?? 0) + 1);
        assigned++;
        await prisma.leadActivity.create({
          data: {
            leadId: lead.id,
            userId: null, // assigned by the scheduler, not by a person
            kind: "assign",
            outcome: "auto-assign",
            note: "Assigned automatically (round-robin).",
          },
        });
      } catch (e) {
        console.error(`[auto-quote] lead ${lead.id} failed to auto-assign`, e);
      }
    }
  } catch (e) {
    console.error("[auto-quote] autoAssignLeads failed", e);
  }

  return { assigned };
}
