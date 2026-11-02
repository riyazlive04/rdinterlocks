import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { can } from "@/lib/access";
import { PageHeader, Card, Pill } from "@/components/ui";
import { formatINR } from "@/lib/format";
import { QuoteItemForm } from "../item-form";
import { generateQuotation } from "../actions";

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string; clientId?: string }>;
}) {
  const session = await requireArea("quotations");
  if (!can(session, "revenue")) redirect("/quotations");
  const sp = await searchParams;

  const [sizes, ctypes, prices, lead, leads, clients, zones] = await Promise.all([
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.constructionType.findMany({ orderBy: { order: "asc" } }),
    prisma.brickPrice.findMany(),
    sp.leadId ? prisma.lead.findUnique({ where: { id: sp.leadId } }) : null,
    sp.leadId ? [] : prisma.lead.findMany({ where: { status: "open" }, orderBy: { createdAt: "desc" }, take: 100 }),
    sp.clientId ? [] : prisma.client.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.deliveryZone.findMany({ where: { active: true }, orderBy: { order: "asc" }, include: { rules: true, prices: true } }),
  ]);

  if (sizes.length === 0 || ctypes.length === 0) {
    return (
      <>
        <PageHeader title="New quotation" back="/quotations" />
        <Card>
          <div className="p-6 text-center text-sm text-slate-500">
            Add brick sizes and construction types in Settings before creating quotations.
          </div>
        </Card>
      </>
    );
  }

  const priceMap = Object.fromEntries(prices.map((p) => [`${p.brickSizeId}_${p.constructionTypeId}`, p.sellPrice]));
  const zonePrices: Record<string, number> = {};
  const zoneRules: Record<string, { minBricks: number; transportOnly: number | null }> = {};
  for (const z of zones) {
    for (const p of z.prices) zonePrices[`${z.id}_${p.brickSizeId}_${p.constructionTypeId}`] = p.sellPrice;
    for (const r of z.rules) zoneRules[`${z.id}_${r.brickSizeId}`] = { minBricks: r.minBricks, transportOnly: r.transportOnly };
  }

  // When opened from a lead, pull whatever the call already captured into a
  // ready-to-review draft instead of a blank form — brick size/type/quantity
  // resolve from the SAME best-effort matches leads-import.ts already made
  // (brickSizeId/constructionTypeId), quantity from brickCount. Pricing
  // always comes from the matrix, never the phone-transcribed costPerBrick —
  // that number is shown as a reference check, not trusted for the invoice.
  const missing: string[] = [];
  let initialItems: Array<{
    brickSizeId: string;
    constructionTypeId: string;
    quantity: number;
    unitPrice: number;
    overridden: boolean;
    transportOnly: boolean;
  }> | undefined;
  let priceCheck: { stated: number; matrix: number | null } | null = null;

  if (sp.leadId && lead) {
    if (!lead.customerName) missing.push("Customer name");
    if (!lead.phoneNumber && !lead.phoneMasked) missing.push("Phone number");
    if (!lead.place) missing.push("Site location");
    if (!lead.brickSizeId) missing.push(`Brick size/type${lead.brickType ? ` (heard "${lead.brickType}")` : ""}`);
    if (!lead.constructionTypeId)
      missing.push(`Construction type${lead.constructionType ? ` (heard "${lead.constructionType}")` : ""}`);
    if (!lead.brickCount) missing.push("Quantity");

    if (lead.brickSizeId && lead.constructionTypeId) {
      const comboKey = `${lead.brickSizeId}_${lead.constructionTypeId}`;
      const matrixPrice = priceMap[comboKey] ?? 0;
      // The zone price wins when the lead carries a zone, matching what
      // resolveQuotationItems will do on submit. Seeding the line from the
      // flat matrix while a zone is selected would show the office one rate
      // and then save another the moment anything was edited.
      const zonePrice = lead.zoneId ? zonePrices[`${lead.zoneId}_${comboKey}`] : undefined;
      const openingPrice = zonePrice ?? matrixPrice;
      initialItems = [
        {
          brickSizeId: lead.brickSizeId,
          constructionTypeId: lead.constructionTypeId,
          quantity: lead.brickCount ?? 1000,
          unitPrice: openingPrice,
          overridden: false,
          transportOnly: false,
        },
      ];
      // The reference check compares what the caller said against what we
      // will actually charge them, so it follows the same zone price.
      if (lead.costPerBrick != null) {
        priceCheck = { stated: lead.costPerBrick, matrix: openingPrice || null };
      }
    }
  }

  return (
    <>
      <PageHeader title="New quotation" back={sp.leadId ? `/leads/${sp.leadId}` : "/quotations"} />

      {sp.leadId && lead && missing.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <div className="text-[13px] font-bold text-ink mb-1">Missing from this lead — confirm with the customer</div>
          <ul className="text-[12.5px] text-ink space-y-0.5 list-disc pl-4">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Card>
      )}

      {priceCheck && (
        <Card className="mb-4 border-blue-200 bg-blue-50">
          <div className="text-[12.5px] text-ink">
            Customer was quoted <span className="num font-semibold">{formatINR(priceCheck.stated)}</span>/brick on
            the call
            {priceCheck.matrix != null && (
              <>
                {" "}
                — the price matrix says <span className="num font-semibold">{formatINR(priceCheck.matrix)}</span>
                /brick.{" "}
                {priceCheck.matrix !== priceCheck.stated && (
                  <Pill tone="warning">Doesn&apos;t match — double-check before sending</Pill>
                )}
              </>
            )}
            . The quotation below uses the matrix price; this is shown for reference only.
          </div>
        </Card>
      )}

      <QuoteItemForm
        leadOptions={lead ? [{ id: lead.id, label: `${lead.customerName || "Unnamed"} · ${lead.phoneNumber || lead.phoneMasked || "-"}` }] : leads.map((l) => ({
          id: l.id,
          label: `${l.customerName || "Unnamed"} · ${l.phoneNumber || l.phoneMasked || "-"}`,
        }))}
        clientOptions={clients.map((c) => ({
          id: c.id,
          label: `${c.name}${c.location ? ` · ${c.location}` : ""}`,
        }))}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        ctypes={ctypes.map((c) => ({ id: c.id, name: c.name }))}
        priceMap={priceMap}
        zones={zones.map((z) => ({ id: z.id, name: z.name, distanceLabel: z.distanceLabel }))}
        zonePrices={zonePrices}
        zoneRules={zoneRules}
        leadPlaceHint={sp.leadId && lead?.place ? lead.place : undefined}
        // Carry the lead's delivery zone into the draft. The telecaller
        // established it on the call and recorded it on the lead; making the
        // office re-pick it here is how a quote ends up priced from the flat
        // matrix for a customer 90km away. Still a visible, editable choice —
        // preselected, never silently applied.
        initial={{
          leadId: sp.leadId,
          clientId: sp.clientId,
          zoneId: lead?.zoneId ?? undefined,
          items: initialItems,
        }}
        submitLabel="Generate quotation"
        onSubmit={async (d) => {
          "use server";
          await generateQuotation(d);
        }}
      />
    </>
  );
}
