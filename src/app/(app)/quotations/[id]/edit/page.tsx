import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { can } from "@/lib/access";
import { PageHeader } from "@/components/ui";
import { QuoteItemForm } from "../../item-form";
import { updateQuotation } from "../../actions";

export default async function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireArea("quotations");
  if (!can(session, "revenue")) redirect("/quotations");
  const { id } = await params;

  const [quotation, sizes, ctypes, prices, leads, clients, zones] = await Promise.all([
    prisma.quotation.findUnique({ where: { id }, include: { items: true } }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.constructionType.findMany({ orderBy: { order: "asc" } }),
    prisma.brickPrice.findMany(),
    prisma.lead.findMany({ where: { status: "open" }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.client.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.deliveryZone.findMany({ where: { active: true }, orderBy: { order: "asc" }, include: { rules: true, prices: true } }),
  ]);
  if (!quotation) notFound();
  if (quotation.status !== "draft") redirect(`/quotations/${id}`);

  const priceMap = Object.fromEntries(prices.map((p) => [`${p.brickSizeId}_${p.constructionTypeId}`, p.sellPrice]));
  const zonePrices: Record<string, number> = {};
  const zoneRules: Record<string, { minBricks: number; transportOnly: number | null }> = {};
  for (const z of zones) {
    for (const p of z.prices) zonePrices[`${z.id}_${p.brickSizeId}_${p.constructionTypeId}`] = p.sellPrice;
    for (const r of z.rules) zoneRules[`${z.id}_${r.brickSizeId}`] = { minBricks: r.minBricks, transportOnly: r.transportOnly };
  }

  return (
    <>
      <PageHeader title={`Edit ${quotation.number}`} back={`/quotations/${id}`} />
      <QuoteItemForm
        leadOptions={leads.map((l) => ({
          id: l.id,
          label: `${l.customerName || "Unnamed"} · ${l.phoneNumber || l.phoneMasked || "-"}`,
        }))}
        clientOptions={clients.map((c) => ({ id: c.id, label: `${c.name}${c.location ? ` · ${c.location}` : ""}` }))}
        sizes={sizes.map((s) => ({ id: s.id, label: s.label }))}
        ctypes={ctypes.map((c) => ({ id: c.id, name: c.name }))}
        priceMap={priceMap}
        zones={zones.map((z) => ({ id: z.id, name: z.name, distanceLabel: z.distanceLabel }))}
        zonePrices={zonePrices}
        zoneRules={zoneRules}
        initial={{
          leadId: quotation.leadId ?? undefined,
          clientId: quotation.clientId ?? undefined,
          customerName: !quotation.leadId && !quotation.clientId ? quotation.customerName : undefined,
          customerPhone: !quotation.leadId && !quotation.clientId ? quotation.customerPhone : undefined,
          place: !quotation.leadId && !quotation.clientId ? quotation.place : undefined,
          zoneId: quotation.zoneId ?? undefined,
          validUntil: quotation.validUntil ? quotation.validUntil.toISOString().slice(0, 10) : undefined,
          items: quotation.items.map((it) => ({
            brickSizeId: it.brickSizeId,
            constructionTypeId: it.constructionTypeId,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            overridden: it.manualOverride,
            transportOnly: it.transportOnly,
          })),
        }}
        submitLabel="Save changes"
        onSubmit={async (d) => {
          "use server";
          await updateQuotation(id, d);
          redirect(`/quotations/${id}`);
        }}
      />
    </>
  );
}
