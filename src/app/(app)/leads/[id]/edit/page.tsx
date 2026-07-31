import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { formatISODate } from "@/lib/format";
import { EditLeadForm } from "./form";

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireArea("leads");
  const { id } = await params;

  const [lead, brickSizes, constructionTypes] = await Promise.all([
    prisma.lead.findUnique({ where: { id } }),
    prisma.brickSize.findMany({ orderBy: { order: "asc" } }),
    prisma.constructionType.findMany({ orderBy: { order: "asc" } }),
  ]);
  if (!lead) notFound();
  // Converted leads are the record of the original enquiry — not editable.
  if (lead.convertedAt) redirect(`/leads/${id}`);

  return (
    <>
      <PageHeader
        title="Edit lead"
        sub={`Call ${lead.callId}`}
        back={`/leads/${id}`}
      />
      <EditLeadForm
        id={lead.id}
        phoneMasked={lead.phoneMasked}
        initial={{
          customerName: lead.customerName,
          phoneNumber: lead.phoneNumber,
          place: lead.place,
          brickType: lead.brickType,
          brickCount: lead.brickCount,
          constructionType: lead.constructionType,
          costPerBrick: lead.costPerBrick,
          totalBudget: lead.totalBudget,
          notes: lead.notes,
          followUpDate: lead.followUpDate ? formatISODate(lead.followUpDate) : "",
          quotationStage: lead.quotationStage,
          brickSizeId: lead.brickSizeId ?? "",
          constructionTypeId: lead.constructionTypeId ?? "",
        }}
        brickSizes={brickSizes.map((b) => ({ id: b.id, label: b.label }))}
        constructionTypes={constructionTypes.map((c) => ({ id: c.id, label: c.name }))}
      />
    </>
  );
}
