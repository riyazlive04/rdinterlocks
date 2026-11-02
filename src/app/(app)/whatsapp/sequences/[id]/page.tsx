import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { StepBuilder } from "./builder";
import { setSequenceSteps } from "../../actions";

export default async function WaSequenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const [sequence, templates, activeEnrollments] = await Promise.all([
    prisma.waSequence.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepOrder: "asc" } }, triggerStage: true },
    }),
    prisma.waTemplate.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.waEnrollment.count({ where: { sequenceId: id, status: "active" } }),
  ]);
  if (!sequence) notFound();

  return (
    <>
      <PageHeader
        title={sequence.name}
        sub={
          sequence.triggerStage
            ? `Auto-enrolls when a lead enters "${sequence.triggerStage.name}"`
            : "Manual enrollment only"
        }
        back="/whatsapp/sequences"
      />
      <StepBuilder
        sequenceId={sequence.id}
        steps={sequence.steps.map((s) => ({
          id: s.id,
          stepOrder: s.stepOrder,
          delayMinutes: s.delayMinutes,
          templateId: s.templateId,
        }))}
        templates={templates.map((t) => ({ id: t.id, name: t.name, approved: t.approved }))}
        activeEnrollments={activeEnrollments}
        onSave={setSequenceSteps}
      />
    </>
  );
}
