import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireArea } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { moveLeadStage } from "../actions";
import { Board } from "./board";

export default async function LeadsBoardPage() {
  await requireArea("leads");

  const [stages, leads] = await Promise.all([
    prisma.leadStage.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.lead.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        customerName: true,
        phoneNumber: true,
        phoneMasked: true,
        place: true,
        brickCount: true,
        costPerBrick: true,
        totalBudget: true,
        stageId: true,
        stageEnteredAt: true,
        callSequence: true,
        source: true,
        // Nested select rather than an include — the two cannot be mixed at
        // the same level, and the board only ever shows the owner's name.
        owner: { select: { name: true } },
      },
    }),
  ]);

  // A lead without a resolved stage (not yet backfilled, or an import whose
  // quotationStage didn't match a configured slug) displays under whichever
  // stage is marked default, purely for the board — nothing is written.
  const defaultStageId = stages.find((s) => s.isDefault)?.id ?? stages[0]?.id ?? null;

  return (
    <>
      <PageHeader
        title="Leads pipeline"
        sub="Drag a card to move it between stages"
        right={
          <Link
            href="/leads"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-ink hover:border-slate-400"
          >
            <Icon.Flag size={16} />
            <span className="hidden sm:inline">List view</span>
          </Link>
        }
      />
      {stages.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No active pipeline stages configured yet. Add some in Settings → Lead pipeline stages.
        </div>
      ) : (
        <Board
          stages={stages.map((s) => ({ id: s.id, name: s.name, colour: s.colour, isWon: s.isWon, isLost: s.isLost }))}
          leads={leads.map(({ owner, ...l }) => ({
            ...l,
            stageId: l.stageId ?? defaultStageId,
            stageEnteredAt: l.stageEnteredAt ? l.stageEnteredAt.toISOString() : null,
            ownerName: owner?.name ?? null,
          }))}
          onMove={moveLeadStage}
        />
      )}
    </>
  );
}
