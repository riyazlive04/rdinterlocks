import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { SequenceList } from "./sequence-list";
import { createWaSequence, updateWaSequence, deleteWaSequence } from "../actions";

export default async function WaSequencesPage() {
  await requireAdmin();

  const [sequences, stages] = await Promise.all([
    prisma.waSequence.findMany({
      orderBy: { name: "asc" },
      include: {
        triggerStage: true,
        _count: { select: { steps: true, enrollments: true } },
        enrollments: { where: { status: "active" }, select: { id: true } },
      },
    }),
    prisma.leadStage.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="WhatsApp sequences"
        sub="Ordered steps of approved templates, optionally auto-triggered when a lead enters a stage"
        back="/whatsapp"
      />
      <SequenceList
        sequences={sequences.map((s) => ({
          id: s.id,
          name: s.name,
          active: s.active,
          triggerStageId: s.triggerStageId,
          triggerStageName: s.triggerStage?.name ?? null,
          stepCount: s._count.steps,
          activeEnrollments: s.enrollments.length,
        }))}
        stages={stages.map((s) => ({ id: s.id, name: s.name }))}
        onCreate={createWaSequence}
        onUpdate={updateWaSequence}
        onDeactivate={deleteWaSequence}
      />
    </>
  );
}
