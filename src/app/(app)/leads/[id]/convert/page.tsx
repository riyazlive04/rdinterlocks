import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { displayPhone } from "@/lib/leads";
import { ConvertLeadForm } from "./form";

export default async function ConvertLeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireArea("leads");
  const { id } = await params;

  const [lead, clients, brickSizes, constructionTypes] = await Promise.all([
    prisma.lead.findUnique({ where: { id } }),
    prisma.client.findMany({
      where: { active: true },
      select: { id: true, name: true, location: true },
      orderBy: { name: "asc" },
    }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.constructionType.findMany({ orderBy: { order: "asc" } }),
  ]);
  if (!lead) notFound();
  if (lead.convertedAt) redirect(`/leads/${id}`);

  // If the caller's name already exists as a client, default to attaching to
  // them rather than creating a duplicate customer record.
  const suggested =
    lead.customerName.trim().length > 0
      ? clients.find(
          (c) => c.name.trim().toLowerCase() === lead.customerName.trim().toLowerCase()
        )
      : undefined;

  return (
    <>
      <PageHeader
        title="Convert lead"
        sub={lead.customerName || `Call ${lead.callId}`}
        back={`/leads/${id}`}
      />
      <ConvertLeadForm
        id={lead.id}
        callId={lead.callId}
        defaults={{
          customerName: lead.customerName,
          phone: displayPhone(lead),
          place: lead.place,
          brickSizeId: lead.brickSizeId ?? "",
          constructionTypeId: lead.constructionTypeId ?? "",
          brickCount: lead.brickCount,
          costPerBrick: lead.costPerBrick,
          suggestedClientId: suggested?.id ?? null,
        }}
        clients={clients}
        brickSizes={brickSizes.map((b) => ({ id: b.id, label: b.label }))}
        constructionTypes={constructionTypes.map((c) => ({ id: c.id, label: c.name }))}
      />
    </>
  );
}
