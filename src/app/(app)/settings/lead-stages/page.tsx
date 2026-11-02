import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { LeadStageManager } from "./manager";
import { createLeadStage, updateLeadStage, deactivateLeadStage, reactivateLeadStage } from "../actions";

export default async function LeadStagesPage() {
  await requireAdmin();

  const [stages, counts] = await Promise.all([
    prisma.leadStage.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.lead.groupBy({ by: ["stageId"], _count: true }),
  ]);
  const countByStage = new Map(
    counts.filter((c) => c.stageId).map((c) => [c.stageId as string, c._count])
  );

  return (
    <>
      <PageHeader
        title="Lead pipeline stages"
        sub="Kanban columns for the Leads pipeline — colour, order, and which stages count as won or lost"
        back="/settings"
      />
      <LeadStageManager
        stages={stages.map((s) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          colour: s.colour,
          isDefault: s.isDefault,
          isWon: s.isWon,
          isLost: s.isLost,
          isActive: s.isActive,
          sortOrder: s.sortOrder,
          leadCount: countByStage.get(s.id) ?? 0,
        }))}
        onCreate={createLeadStage}
        onUpdate={updateLeadStage}
        onDeactivate={deactivateLeadStage}
        onReactivate={reactivateLeadStage}
      />
    </>
  );
}
